#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

use std::{
    fs,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Arc, Mutex as StdMutex},
    time::Duration,
};

use chrono::Utc;
use dirs::home_dir;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{
    AppHandle, Manager, State,
    menu::{Menu, MenuItem},
    tray::{TrayIcon, TrayIconBuilder},
    Icon,
};
use tauri::async_runtime::Mutex;
use tauri_plugin_shell::ShellExt;
use tokio::{
    fs::OpenOptions,
    io::{AsyncBufReadExt, AsyncRead, AsyncWriteExt, BufReader},
    process::{Child, Command},
    time::sleep,
};

#[derive(Clone)]
struct ProxyState {
    repo_root: Arc<PathBuf>,
    log_path: Arc<PathBuf>,
    child: Arc<Mutex<Option<Child>>>,
    status: Arc<Mutex<AppStatus>>,
    tray: Arc<StdMutex<Option<TrayIcon>>>,
}

#[derive(Clone, Default)]
struct AppStatus {
    running: bool,
    last_error: Option<String>,
    last_update: Option<String>,
    snapshot: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct ProxyEvent {
    event: String,
    phase: Option<String>,
    snapshot: Option<Value>,
    message: Option<String>,
    reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeConfigStatus {
    healthy: bool,
    port: i64,
    settings_path: String,
    expected: Value,
    current: Value,
    #[serde(default)]
    env: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Default)]
struct UiStatus {
    running: bool,
    last_error: Option<String>,
    last_update: Option<String>,
    snapshot: Option<Value>,
    log_path: String,
    config: Option<ClaudeConfigStatus>,
}

impl ProxyState {
    fn new() -> Self {
        let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(Path::parent)
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."));

        let log_path = home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".antigravity-proxy")
            .join("desktop.log");

        if let Some(parent) = log_path.parent() {
            let _ = fs::create_dir_all(parent);
        }

        Self {
            repo_root: Arc::new(repo_root),
            log_path: Arc::new(log_path),
            child: Arc::new(Mutex::new(None)),
            status: Arc::new(Mutex::new(AppStatus::default())),
            tray: Arc::new(StdMutex::new(None)),
        }
    }

    fn repo_root(&self) -> &Path {
        &self.repo_root
    }

    fn log_path(&self) -> &Path {
        &self.log_path
    }

    fn attach_tray(&self, tray: TrayIcon) {
        if let Ok(mut guard) = self.tray.lock() {
            *guard = Some(tray);
        }
    }

    async fn append_log(&self, level: &str, line: &str) {
        if let Ok(mut file) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.log_path())
            .await
        {
            let timestamp = Utc::now().to_rfc3339();
            let entry = format!("[{timestamp}] [{level}] {line}\n");
            let _ = file.write_all(entry.as_bytes()).await;
        }
    }

    async fn apply_event(&self, event: ProxyEvent) {
        {
            let mut status = self.status.lock().await;
            match event.event.as_str() {
                "status" => {
                    if let Some(snapshot) = event.snapshot {
                        status.snapshot = Some(snapshot);
                    }
                    status.running = event.phase.as_deref() != Some("stopped");
                    status.last_error = None;
                    status.last_update = Some(now_string());
                }
                "error" => {
                    status.last_error = event.message.or(event.reason);
                    status.last_update = Some(now_string());
                }
                _ => {}
            }
        }
        let _ = self.update_tray().await;
    }

    async fn current_status(&self) -> UiStatus {
        let status = self.status.lock().await.clone();
        UiStatus {
            running: status.running,
            last_error: status.last_error.clone(),
            last_update: status.last_update.clone(),
            snapshot: status.snapshot.clone(),
            log_path: self.log_path().display().to_string(),
            config: None,
        }
    }

    async fn claude_config_status(&self) -> Option<ClaudeConfigStatus> {
        match self.run_node_script("desktop/claude-config-status.js").await {
            Ok(output) if !output.trim().is_empty() => {
                serde_json::from_str::<ClaudeConfigStatus>(output.trim()).ok()
            }
            _ => None,
        }
    }

    async fn repair_claude_config(&self) -> Result<ClaudeConfigStatus, String> {
        let output = self
            .run_node_script("desktop/claude-config-fix.js")
            .await?;
        serde_json::from_str::<ClaudeConfigStatus>(output.trim())
            .map_err(|err| err.to_string())
    }

    async fn run_node_script(&self, relative: &str) -> Result<String, String> {
        let node_bin = std::env::var("NODE_BINARY").unwrap_or_else(|_| "node".into());
        let script_path = self.repo_root().join(relative);
        if !script_path.exists() {
            return Err(format!("Script not found: {}", script_path.display()));
        }

        let output = Command::new(node_bin)
            .arg(script_path)
            .current_dir(self.repo_root())
            .output()
            .await
            .map_err(|err| err.to_string())?;

        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).to_string())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).to_string())
        }
    }

    async fn mark_stopped(&self, message: Option<&str>) {
        let mut status = self.status.lock().await;
        status.running = false;
        status.last_error = message.map(|m| m.to_string());
        status.last_update = Some(now_string());
        drop(status);
        let _ = self.update_tray().await;
    }

    async fn update_tray(&self) -> tauri::Result<()> {
        let status = self.status.lock().await.clone();
        let has_rate_limit = status
            .snapshot
            .as_ref()
            .and_then(|snapshot| snapshot.get("accounts"))
            .and_then(|accounts| accounts.as_array())
            .map(|accounts| {
                accounts.iter().any(|acc| {
                    acc.get("isRateLimited")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false)
                })
            })
            .unwrap_or(false);

        let visual = if status.running {
            if has_rate_limit {
                TrayVisual::Warning
            } else {
                TrayVisual::Running
            }
        } else if status.last_error.is_some() {
            TrayVisual::Warning
        } else {
            TrayVisual::Stopped
        };

        let tooltip = if status.running {
            if let Some(snapshot) = status.snapshot.as_ref() {
                let port = snapshot
                    .get("port")
                    .and_then(|p| p.as_i64())
                    .unwrap_or(8080);
                let account = snapshot
                    .get("currentAccount")
                    .and_then(|a| a.as_str())
                    .unwrap_or("unknown");
                format!("Proxy running on :{port} · {account}")
            } else {
                "Proxy running".to_string()
            }
        } else if let Some(err) = status.last_error.clone() {
            err
        } else if let Some(wait_ms) = status
            .snapshot
            .as_ref()
            .and_then(shortest_wait_ms)
            .filter(|ms| *ms > 0)
        {
            format!(
                "Rate limited · next slot in {}",
                format_duration(wait_ms as u64)
            )
        } else {
            "Proxy stopped".to_string()
        };

        if let Ok(mut guard) = self.tray.lock() {
            if let Some(tray) = guard.as_ref() {
                tray.set_icon(visual.icon())?;
                tray.set_tooltip(&tooltip)?;
            }
        }
        Ok(())
    }
}

fn shortest_wait_ms(snapshot: &Value) -> Option<i64> {
    let accounts = snapshot.get("accounts")?.as_array()?;
    let now = Utc::now().timestamp_millis();
    accounts
        .iter()
        .filter_map(|acc| acc.get("nextAvailableAt").and_then(|v| v.as_i64()))
        .map(|ts| ts - now)
        .filter(|delta| *delta > 0)
        .min()
}

enum TrayVisual {
    Running,
    Warning,
    Stopped,
}

impl TrayVisual {
    fn icon(&self) -> Icon {
        let color = match self {
            TrayVisual::Running => [16, 185, 129],
            TrayVisual::Warning => [251, 191, 36],
            TrayVisual::Stopped => [239, 68, 68],
        };
        icon_from_color(color)
    }
}

fn icon_from_color(color: [u8; 3]) -> Icon {
    let size = 24usize;
    let mut data = vec![0u8; size * size * 4];
    for px in data.chunks_exact_mut(4) {
        px[0] = color[0];
        px[1] = color[1];
        px[2] = color[2];
        px[3] = 255;
    }
    Icon::Raw(
        tauri::image::Image::from_rgba(size as u32, size as u32, data)
            .expect("failed to build tray icon"),
    )
}

fn format_duration(ms: u64) -> String {
    let secs = ms / 1000;
    let minutes = secs / 60;
    let seconds = secs % 60;
    if minutes > 0 {
        format!("{minutes}m {seconds}s")
    } else {
        format!("{seconds}s")
    }
}

fn now_string() -> String {
    Utc::now().to_rfc3339()
}

fn spawn_line_reader<R>(state: ProxyState, reader: R, label: &'static str)
where
    R: AsyncRead + Unpin + Send + 'static,
{
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            state.append_log(label, &line).await;
            if label == "STDOUT" {
                if let Ok(event) = serde_json::from_str::<ProxyEvent>(&line) {
                    state.apply_event(event).await;
                }
            } else {
                state
                    .apply_event(ProxyEvent {
                        event: "error".to_string(),
                        phase: None,
                        snapshot: None,
                        message: Some(line.clone()),
                        reason: None,
                    })
                    .await;
            }
        }
    });
}

fn spawn_watchdog(state: ProxyState) {
    tauri::async_runtime::spawn(async move {
        loop {
            let exited = {
                let mut guard = state.child.lock().await;
                if let Some(child) = guard.as_mut() {
                    match child.try_wait() {
                        Ok(Some(_)) => {
                            *guard = None;
                            true
                        }
                        Ok(None) => false,
                        Err(err) => {
                            state.append_log("ERROR", &format!("watchdog: {err}")).await;
                            false
                        }
                    }
                } else {
                    break;
                }
            };

            if exited {
                state.mark_stopped(Some("Proxy process exited")).await;
                break;
            }

            sleep(Duration::from_secs(3)).await;
        }
    });
}

async fn start_proxy_impl(state: &ProxyState) -> Result<UiStatus, String> {
    let mut guard = state.child.lock().await;
    if guard.is_some() {
        drop(guard);
        let mut ui = state.current_status().await;
        ui.config = state.claude_config_status().await;
        return Ok(ui);
    }

    let script_path = state.repo_root().join("desktop/proxy-daemon.js");
    if !script_path.exists() {
        return Err(format!("Desktop bridge missing: {}", script_path.display()));
    }

    let node_bin = std::env::var("NODE_BINARY").unwrap_or_else(|_| "node".into());
    let mut command = Command::new(node_bin);
    command
        .arg(&script_path)
        .current_dir(state.repo_root())
        .env("ANTIGRAVITY_HOST", "127.0.0.1")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|err| err.to_string())?;

    if let Some(stdout) = child.stdout.take() {
        spawn_line_reader(state.clone(), stdout, "STDOUT");
    }

    if let Some(stderr) = child.stderr.take() {
        spawn_line_reader(state.clone(), stderr, "STDERR");
    }

    *guard = Some(child);
    drop(guard);

    spawn_watchdog(state.clone());

    {
        let mut status = state.status.lock().await;
        status.running = true;
        status.last_error = None;
        status.last_update = Some(now_string());
    }
    let _ = state.update_tray().await;

    let mut ui = state.current_status().await;
    ui.config = state.claude_config_status().await;
    Ok(ui)
}

async fn stop_proxy_impl(state: &ProxyState) -> Result<UiStatus, String> {
    {
        let mut guard = state.child.lock().await;
        if let Some(mut child) = guard.take() {
            #[cfg(not(windows))]
            {
                use nix::sys::signal::{kill, Signal};
                use nix::unistd::Pid;

                if let Some(pid) = child.id() {
                    let _ = kill(Pid::from_raw(pid as i32), Signal::SIGTERM);
                }
            }

            #[cfg(windows)]
            {
                child.kill().await.map_err(|err| err.to_string())?;
            }

            let _ = child.wait().await;
        } else {
            drop(guard);
            let mut ui = state.current_status().await;
            ui.config = state.claude_config_status().await;
            return Ok(ui);
        }
    }

    state.mark_stopped(None).await;
    let mut ui = state.current_status().await;
    ui.config = state.claude_config_status().await;
    Ok(ui)
}

async fn open_dashboard_impl(app: &AppHandle, state: &ProxyState) -> Result<(), String> {
    let status = state.status.lock().await.clone();
    let port = status
        .snapshot
        .as_ref()
        .and_then(|s| s.get("port").and_then(|p| p.as_i64()))
        .unwrap_or(8080);
    drop(status);
    let url = format!("http://localhost:{port}/dashboard");
    app.shell().open(&url, None).map_err(|err: tauri_plugin_shell::Error| err.to_string())
}

async fn view_logs_impl(app: &AppHandle, state: &ProxyState) -> Result<(), String> {
    let path = state.log_path().to_path_buf();
    if !path.exists() {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        fs::File::create(&path).map_err(|err| err.to_string())?;
    }
    let path_str = path.to_string_lossy().to_string();
    app.shell()
        .open(&path_str, None)
        .map_err(|err: tauri_plugin_shell::Error| err.to_string())
}

#[tauri::command]
async fn start_proxy(state: State<'_, ProxyState>) -> Result<UiStatus, String> {
    start_proxy_impl(&state).await
}

#[tauri::command]
async fn stop_proxy(state: State<'_, ProxyState>) -> Result<UiStatus, String> {
    stop_proxy_impl(&state).await
}

#[tauri::command]
async fn fetch_status(state: State<'_, ProxyState>) -> Result<UiStatus, String> {
    let mut ui = state.current_status().await;
    ui.config = state.claude_config_status().await;
    Ok(ui)
}

#[tauri::command]
async fn open_dashboard(app: AppHandle, state: State<'_, ProxyState>) -> Result<(), String> {
    open_dashboard_impl(&app, &state).await
}

#[tauri::command]
async fn view_logs(app: AppHandle, state: State<'_, ProxyState>) -> Result<(), String> {
    view_logs_impl(&app, &state).await
}

#[tauri::command]
async fn repair_claude_config(state: State<'_, ProxyState>) -> Result<ClaudeConfigStatus, String> {
    state.repair_claude_config().await
}

#[tauri::command]
async fn check_claude_config(state: State<'_, ProxyState>) -> Result<ClaudeConfigStatus, String> {
    state
        .claude_config_status()
        .await
        .ok_or_else(|| "Unable to read Claude settings".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(ProxyState::new())
        .invoke_handler(tauri::generate_handler![
            start_proxy,
            stop_proxy,
            fetch_status,
            open_dashboard,
            view_logs,
            repair_claude_config,
            check_claude_config
        ])
        .setup(|app| {
            let state = app.state::<ProxyState>().inner().clone();
            let handle = app.handle().clone();

            // Create tray menu
            let start_i = MenuItem::with_id(app, "start-proxy", "Start Proxy", true, None::<&str>)?;
            let stop_i = MenuItem::with_id(app, "stop-proxy", "Stop Proxy", true, None::<&str>)?;
            let dashboard_i = MenuItem::with_id(app, "open-dashboard", "Open Dashboard", true, None::<&str>)?;
            let logs_i = MenuItem::with_id(app, "view-logs", "View Logs", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit-app", "Quit", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&start_i, &stop_i, &dashboard_i, &logs_i, &quit_i])?;

            let tray = TrayIconBuilder::new()
                .menu(&menu)
                .on_menu_event(move |app, event| {
                    let state_clone = state.clone();
                    let handle_clone = app.clone();
                    match event.id.as_ref() {
                        "start-proxy" => {
                            tauri::async_runtime::spawn(async move {
                                let _ = start_proxy_impl(&state_clone).await;
                            });
                        }
                        "stop-proxy" => {
                            tauri::async_runtime::spawn(async move {
                                let _ = stop_proxy_impl(&state_clone).await;
                            });
                        }
                        "open-dashboard" => {
                            tauri::async_runtime::spawn(async move {
                                let _ = open_dashboard_impl(&handle_clone, &state_clone).await;
                            });
                        }
                        "view-logs" => {
                            tauri::async_runtime::spawn(async move {
                                let _ = view_logs_impl(&handle_clone, &state_clone).await;
                            });
                        }
                        "quit-app" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .build(app)?;
            state.attach_tray(tray);

            let state_for_tray = state.clone();
            tauri::async_runtime::spawn(async move {
                let _ = state_for_tray.update_tray().await;
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn main() {
    run();
}
