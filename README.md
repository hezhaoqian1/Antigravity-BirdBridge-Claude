# Antigravity Claude Proxy（反重力 Claude 代理）

一个由 **Antigravity Cloud Code** 提供算力、并暴露 **Anthropic 兼容 API** 的代理服务器，让你能在 **Claude Code CLI** 中使用 sonnet、opus 等 Claude 模型。

## 快速开始

```bash
# 终端 1：一键配置并启动代理
npx antigravity-claude-proxy run

# 或者在克隆/开发模式下
git clone https://github.com/hezhaoqian1/Antigravity-BirdBridge-Claude.git
cd Antigravity-BirdBridge-Claude && npm install
npm start   # 直接启动 Express 服务（不修改 Claude Code 配置）

# 终端 2：使用 Claude Code
claude
```

就这么简单！`run` 命令（或 `npm run run`）会先检查本地环境、自动配置 Claude Code 的 `settings.json`，然后再启动代理；`npm start` 则是最轻量的“只启动服务”方式，便于本地开发或自定义部署流程。

> **前置条件**：需要安装并登录 [Antigravity](https://antigravity.so)，代理会自动读取令牌。

---

## 工作原理

```
┌──────────────────┐     ┌─────────────────────┐     ┌────────────────────────────┐
│   Claude Code    │────▶│  This Proxy Server  │────▶│  Antigravity Cloud Code    │
│   (Anthropic     │     │  (Anthropic → Google│     │  (daily-cloudcode-pa.      │
│    API format)   │     │   Generative AI)    │     │   sandbox.googleapis.com)  │
└──────────────────┘     └─────────────────────┘     └────────────────────────────┘
```

1. 以 **Anthropic Messages API** 的请求格式接收来自 Claude Code 的调用
2. 使用 Antigravity 令牌（或多账号 OAuth）完成鉴权
3. 将请求转换为 **Google Generative AI** 规范，转发到 Antigravity Cloud Code API
4. 把响应转回 **Anthropic** 规范，支持完整的 thinking/streaming 能力

---

## 安装方式

```bash
# 推荐：直接使用 npx（无需安装）
npx antigravity-claude-proxy run

# 或全局安装
npm install -g antigravity-claude-proxy
antigravity-claude-proxy run

# 或克隆仓库后本地运行
git clone https://github.com/hezhaoqian1/Antigravity-BirdBridge-Claude.git
cd Antigravity-BirdBridge-Claude && npm install && npm run run
```

---

## 命令说明

| 命令 | 说明 |
|------|------|
| `run` / `npm run run` | **推荐**：一键配置 Claude CLI 并启动代理 |
| `start` | 仅启动 `src/index.js`（不触碰配置，适合守护进程 / PM2） |
| `dashboard` | 在默认浏览器中打开 `http://localhost:8080/dashboard` |
| `accounts add/list/remove/verify/clear` | 多账号管理 |
| `accounts status` | 以表格显示账号健康评分、限流倒计时、是否推荐 |
| `flows export [--days N] [--output file.json]` | 将最近 N 天的 Flow 日志导出为 JSON |
| `config show` | 打印当前代理配置（含监听 IP、防火墙状态） |
| `config lan on/off` | 切换 LAN 访问（需重启） |
| `config backup <label>` | 手动创建配置/账号备份（自动保留最近 5 份） |
| `config list` | 列出可用备份 |
| `config restore <name>` | 从指定备份恢复（恢复后需重启） |
| `backup [label]` | 兼容旧版的备份命令（内部调用 `config backup`） |

---

## 多账号模式（可选）

如需负载均衡以减少限流等待，可添加多个 Google 账号。

### 添加账号

```bash
# 添加第一个账号（会打开浏览器进行 Google OAuth 授权）
npx antigravity-claude-proxy accounts add

# 继续添加更多账号（重复执行，最多支持 10 个）
npx antigravity-claude-proxy accounts add
```

### 账号管理

```bash
npx antigravity-claude-proxy accounts list    # 查看所有账号
npx antigravity-claude-proxy accounts verify  # 验证账号有效性
npx antigravity-claude-proxy accounts remove  # 删除账号
npx antigravity-claude-proxy accounts         # 交互式管理
```

### 常见问题

**需要每次重新登录吗？**
不需要。账号信息（refresh token）保存在 `~/.config/antigravity-proxy/accounts.json`，只需添加一次即可永久使用。

**添加账号后如何启动？**
启动命令不变，仍然是 `npx antigravity-claude-proxy run`。代理会自动使用所有已添加的账号。

### 多账号特性

- **智能等待/切换策略**：≤10秒自动等待，10-60秒切换账号，>60秒报错
- **时间窗口锁定**：60秒内复用同一账号，提高缓存命中率
- **Token Saver**：后台任务（标题、摘要等）自动降级到 `claude-opus-4-5-thinking`，节省高阶算力
- **503 + Retry-After**：限流时返回标准响应头，客户端可智能重试
- **自动冷却**：限流账号在重置时间后自动恢复

### 查看账号状态

```bash
# 命令行查看
curl "http://localhost:8080/account-limits?format=table"

# 或打开 Web Dashboard
open http://localhost:8080/dashboard
```

---

## Web Dashboard

代理服务器内置了一个可视化 Dashboard，用于监控账号状态和配额使用情况。

### 访问方式

启动代理后，访问 `http://localhost:8080/dashboard`

### Dashboard 功能

- **实时状态**：显示代理状态、活跃账号数、当前使用账号
- **账号卡片**：每个账号的状态、配额进度条、重置时间
- **自动刷新**：健康状态每 5 秒更新一次、配额信息每 30 秒刷新一次

### 技术栈

- React 18 + TypeScript
- TanStack Query（数据获取和缓存）
- TailwindCSS（样式）
- Vite（构建工具）

### 新增 · 管理控制 & Flow Monitor

- **OpenAI Chat 兼容层**：新增 `/v1/chat/completions`，可直接在 Cursor、LiteLLM 等依赖 OpenAI 协议的客户端中复用 Antigravity 账号。
- **Service Controls 面板**：Dashboard 内即可粘贴 `X-Admin-Key`、切换 LAN 访问、查看当前监听 IP，并一键触发配置/账号备份。
- **Flow Monitor**：后端 `/api/flows` + 前端表格实时记录最近 50 条请求（耗时、账号、错误、stream chunk 体积），方便排查限流与指令问题。
- **可写配置 API**：新增 `/api/admin/config` 与 `/api/admin/backup`，配合 CLI `config`/`backup` 子命令，可脚本化维护代理。

---

## 桌面 App（Tauri）

仓库根目录下新增 `tauri/`，提供一个 Tauri 打包的桌面控制台，可一键启动/停止代理，并监听日志、托盘状态。

### 功能一览

- **Start / Stop**：通过 Rust → Node IPC 启动 `desktop/proxy-daemon.js`，与 CLI 共用 `startProxy/stopProxy`。
- **Dashboard / Logs / Reconfigure**：主界面按钮可打开 Dashboard、`~/.antigravity-proxy/desktop.log`，或一键修复 `.claude/settings.json`。
- **状态面板**：展示当前账号、端口、LAN、限流倒计时，若检测到 Claude CLI 配置被修改会弹出修复提示。
- **托盘菜单**：Start、Stop、Open Dashboard、View Logs、Quit；图标颜色会根据状态切换（绿=运行、黄=限流、红=停止）。
- **打包**：`npm run tauri:build` 会生成 `.dmg`（macOS）与 `.msi`（Windows）。

### 开发/构建

```bash
cd tauri
npm install
npm run tauri:dev    # 调试
npm run tauri:build  # 产出安装包
```

---

## Flow 日志与导出

- 所有请求会持久化到 `~/.antigravity-proxy/flows/YYYY-MM-DD.ndjson`，保留 7 天自动清理。
- Dashboard `Recent Requests` 区新增 “导出 JSON / 下载 NDJSON” 按钮。
- REST API：
  - `GET /api/flows?export=json&days=3&limit=200` → 返回最近 N 天的合并数据。
  - `GET /api/flows?export=file&day=2025-12-28` → 直接下载对应日期的 `.ndjson`。
- CLI：
  ```bash
  antigravity-claude-proxy flows export --days 2 --output flows.json
  ```

---

## 限流可见性 & 账号健康评分

- `src/account-manager.js` 现在会记录每个账号的 `success/error count`、`lastSuccess/Failure`、`rateLimitResetTime`，并计算 `healthScore`。
- CLI `accounts status` 将表格输出状态、下一次可用时间、成功率以及 ⭐ 推荐账号。
- Dashboard 卡片新增倒计时、健康值标签、推荐徽章。
- `/account-limits` 响应包含 `recommendedAccount` 以及 `meta` 字段（限流状态、统计信息），供外部系统复用。
- 托盘图标会在检测到所有账号限流时自动变黄，并在提示中显示最近的解封时间。

---

## 备份策略（config + accounts）

- 自动备份：启动时以及每次 `config lan` / Dashboard 写配置都会生成一份备份，最多保留 5 个最近版本。
- 存放路径：`~/.config/antigravity-proxy/backups/<timestamp>-<label>/config.json + accounts.json`
- CLI：

  ```bash
  antigravity-claude-proxy config backup nightly
  antigravity-claude-proxy config list
  antigravity-claude-proxy config restore 2025-01-02T12-00-00-nightly
  ```

- Dashboard 的 “One-click backup” 按钮会以 `dashboard` 标签落盘，方便手工留档。

---

## `.claude/settings.json` 冲突检测

- `src/index.js` 启动后会轮询 `~/.claude/settings.json`。若用户手动改写导致 `ANTHROPIC_BASE_URL` 等字段偏离代理配置，会在 CLI 与桌面 App 中显示告警。
- CLI `accounts status` 输出会提示冲突，并指导使用 `antigravity-claude-proxy run` 或桌面端的 “Reconfigure Claude CLI” 修复。
- Tauri UI 中同样会展示黄色告警条，可一键重写 `.claude/settings.json`。

---

## 可用模型

| 模型 ID | 说明 |
|---------|------|
| `claude-opus-4-5-thinking` | Claude Opus 4.5，支持扩展 thinking |
| `claude-sonnet-4-5-thinking` | Claude Sonnet 4.5，支持扩展 thinking |
| `claude-sonnet-4-5` | Claude Sonnet 4.5，标准模式 |

---

## API 端点

| 路径 | Method | 描述 |
|------|--------|------|
| `/health` | GET | 健康检查 |
| `/account-limits` | GET | 账号状态（加 `?format=table` 输出表格） |
| `/v1/messages` | POST | Anthropic Messages API |
| `/v1/chat/completions` | POST | OpenAI Chat API（非 Streaming） |
| `/v1/models` | GET | 列出可用模型 |
| `/refresh-token` | POST | 强制刷新令牌 |
| `/dashboard` | GET | Web Dashboard UI |
| `/api/flows` | GET | Flow Monitor 最近请求列表 |
| `/api/admin/config` | GET/POST | 读取或更新代理配置（写操作需 `X-Admin-Key`） |
| `/api/admin/backup` | POST | 立即创建配置/账号备份 |

---

## 故障排查

| 问题 | 解决方案 |
|------|----------|
| **"Could not extract token"** | 确认 Antigravity 已安装并登录 |
| **401 认证失败** | `curl -X POST http://localhost:8080/refresh-token` |
| **429 限流** | 等待或添加多账号 |

---

## 安全与风险提示

### 适用场景
- 仅供个人或内部开发测试
- 请遵守相关服务条款与数据处理政策

### 警告（风险自担）
- 该方案可能违反 AI 服务提供方的服务条款
- 服务方可能采取账号封禁等措施
- 一切风险由使用者自行承担

---

## 致谢

- [opencode-antigravity-auth](https://github.com/NoeFabris/opencode-antigravity-auth)
- [claude-code-proxy](https://github.com/1rgs/claude-code-proxy)

## 许可协议

MIT
