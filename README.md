# Antigravity Claude Proxy（反重力 Claude 代理）

一个由 **Antigravity Cloud Code** 提供算力、并暴露 **Anthropic 兼容 API** 的代理服务器，让你能在 **Claude Code CLI** 中使用 sonnet、opus 等 Claude 模型。

## 工作原理

```
┌──────────────────┐     ┌─────────────────────┐     ┌────────────────────────────┐
│   Claude Code    │────▶│  This Proxy Server  │────▶│  Antigravity Cloud Code    │
│   (Anthropic     │     │  (Anthropic → Google│     │  (daily-cloudcode-pa.      │
│    API format)   │     │   Generative AI)    │     │   sandbox.googleapis.com)  │
└──────────────────┘     └─────────────────────┘     └────────────────────────────┘
```

1. 以 **Anthropic Messages API** 的请求格式接收来自 Claude Code 的调用
2. 使用添加的 Google 账号 OAuth 令牌（或本地 Antigravity 数据库）完成鉴权
3. 将请求转换为 **Google Generative AI** 的规范，并加上 Cloud Code 所需的包装
4. 将请求转发到 Antigravity Cloud Code API
5. 把响应再转回 **Anthropic** 规范，包含完整的 thinking/streaming 能力

## 前置条件

- **Node.js** 18 及以上
- 单账号模式需要安装 **Antigravity**；多账号模式需要一个或多个 Google 账号

---

## 安装

```bash
# 推荐：直接使用 npx（无需安装）
npx antigravity-claude-proxy start

# 或全局安装
npm install -g antigravity-claude-proxy
antigravity-claude-proxy start

# 或克隆仓库后本地运行
git clone https://github.com/hezhaoqian1/Antigravity-BirdBridge-Claude.git
cd Antigravity-BirdBridge-Claude && npm install && npm start
```

---

## 快速上手

### 1. 添加账号

**单账号模式（自动）**：如果已安装并登录 Antigravity，代理会自动读取令牌，无需配置。

**多账号模式（推荐）**：通过 OAuth 添加 Google 账号，支持负载均衡：

```bash
# 添加账号（会打开浏览器进行 OAuth 授权）
npx antigravity-claude-proxy accounts add

# 账号管理命令
npx antigravity-claude-proxy accounts list    # 列出所有账号
npx antigravity-claude-proxy accounts verify  # 验证账号状态
npx antigravity-claude-proxy accounts         # 交互式管理界面
```

### 2. 启动代理服务

```bash
npx antigravity-claude-proxy start
```

默认监听 `http://localhost:8080`（可通过 `PORT` 环境变量修改）。

### 3. 验证运行状态

```bash
# 健康检查
curl http://localhost:8080/health

# 查看账号状态与配额
curl "http://localhost:8080/account-limits?format=table"
```

---

## 搭配 Claude Code CLI

### 配置 Claude Code

创建或编辑 Claude Code 的设置文件：

**macOS：** `~/.claude/settings.json`
**Linux：** `~/.claude/settings.json`
**Windows：** `%USERPROFILE%\.claude\settings.json`

加入以下配置：

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "test",
    "ANTHROPIC_BASE_URL": "http://localhost:8080",
    "ANTHROPIC_MODEL": "claude-opus-4-5-thinking",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-opus-4-5-thinking",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-sonnet-4-5-thinking",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "claude-sonnet-4-5",
    "CLAUDE_CODE_SUBAGENT_MODEL": "claude-opus-4-5-thinking"
  }
}
```

### 运行 Claude Code

```bash
# 终端 1：启动代理
npx antigravity-claude-proxy start

# 终端 2：启动 Claude Code
claude
```

---

## 可用模型

| 模型 ID                        | 说明                                 |
| ------------------------------ | ------------------------------------ |
| `claude-sonnet-4-5-thinking` | Claude Sonnet 4.5，支持扩展 thinking |
| `claude-opus-4-5-thinking`   | Claude Opus 4.5，支持扩展 thinking   |
| `claude-sonnet-4-5`          | Claude Sonnet 4.5，标准模式          |

标准 Anthropic 模型名会自动映射：

- `claude-sonnet-4-5-20250514` → `claude-sonnet-4-5-thinking`
- `claude-opus-4-5-20250514` → `claude-opus-4-5-thinking`

---

## 多账号负载均衡

添加多个账号后，代理会自动：

- **粘性账号选择**：尽量保持使用同一账号，以提高提示词缓存命中率
- **智能限流处理**：短限流（≤2 分钟）等待解封，长限流自动切换账号
- **自动冷却**：限流账号在重置时间到达后自动恢复
- **无效账号检测**：需要重新验证的账号会被标记并跳过
- **提示词缓存**：稳定的 Session ID 让多轮会话也能命中缓存

随时查看账号状态：

```bash
curl "http://localhost:8080/account-limits?format=table"
```

---

## API 端点

| 路径                | Method | 描述                                                       |
| ------------------- | ------ | ---------------------------------------------------------- |
| `/health`         | GET    | 健康检查                                                   |
| `/account-limits` | GET    | 查看账号状态与配额（加 `?format=table` 输出 ASCII 表格） |
| `/v1/messages`    | POST   | Anthropic Messages API                                     |
| `/v1/models`      | GET    | 列出可用模型                                               |
| `/refresh-token`  | POST   | 强制刷新令牌                                               |

---

## 测试

```bash
# 终端 1：启动服务器
npm start

# 终端 2：运行测试
npm test                    # 全部测试
npm run test:signatures     # Thinking signatures
npm run test:multiturn      # Multi-turn with tools
npm run test:streaming      # Streaming SSE events
npm run test:interleaved    # Interleaved thinking
npm run test:images         # Image processing
npm run test:caching        # Prompt caching
```

---

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| **"Could not extract token from Antigravity"** | 确认 Antigravity 已安装并登录，或改用 OAuth：`npx antigravity-claude-proxy accounts add` |
| **401 认证失败** | 刷新令牌：`curl -X POST http://localhost:8080/refresh-token` 或重新验证：`npx antigravity-claude-proxy accounts` |
| **429 限流** | 多账号模式自动切换，单账号模式需等待限流窗口 |
| **账号显示 "Invalid"** | 运行 `npx antigravity-claude-proxy accounts` 重新验证 |

---

## 安全、用途与风险提示

### 适用场景

- 仅供个人或内部开发测试
- 请遵守内部配额与数据处理政策
- 不应用于生产环境或规避官方限制

### 不适用场景

- 生产级别业务流量
- 大规模自动化数据抓取
- 任意违反可接受使用政策（AUP）的行为

### 警告（风险自担）

使用本软件即表示你理解并接受以下内容：

- **服务条款风险**：该方案可能违反 AI 服务提供方（如 Anthropic、Google 等）的服务条款，需自行确保合规。
- **账号风险**：服务方可能识别此类行为并采取惩罚措施，包括封禁账号、终止订阅等。
- **无可用性保证**：服务方可随时更改 API、鉴权或策略，可能导致本项目失效且不另行通知。
- **风险自担**：一切法律、经济与技术风险由使用者自行承担，项目作者与贡献者不承担任何责任。

**请在充分理解并接受上述风险后再继续使用。**

---

## 法律声明

- **与 Google、Anthropic 无任何从属或合作关系。** 本项目是独立的开源项目，未获两家公司背书或授权。
- "Antigravity""Gemini""Google Cloud""Google" 为 Google LLC 的商标。
- "Claude""Anthropic" 为 Anthropic PBC 的商标。
- 软件按 "现状" 提供，不附带任何明示或暗示担保。用户需自行遵守所有适用的服务条款与可接受使用政策。

---

## 致谢

本项目参考或借鉴了以下开源贡献：

- [opencode-antigravity-auth](https://github.com/NoeFabris/opencode-antigravity-auth) - Antigravity OAuth plugin for OpenCode
- [claude-code-proxy](https://github.com/1rgs/claude-code-proxy) - Anthropic API proxy using LiteLLM

---

## 许可协议

MIT
