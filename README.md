# Antigravity Claude Proxy（反重力 Claude 代理）

一个由 **Antigravity Cloud Code** 提供算力、并暴露 **Anthropic 兼容 API** 的代理服务器，让你能在 **Claude Code CLI** 中使用 sonnet、opus 等 Claude 模型。

## 快速开始

```bash
# 终端 1：一键配置并启动代理
npx antigravity-claude-proxy run

# 终端 2：使用 Claude Code
claude
```

就这么简单！`run` 命令会自动配置 Claude Code 的 settings.json 并启动代理。

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
| `run` | **推荐** - 自动配置 Claude Code 并启动代理 |
| `start` | 仅启动代理（不修改配置） |
| `accounts add` | 添加 Google 账号（OAuth 多账号模式） |
| `accounts list` | 列出所有账号 |
| `accounts verify` | 验证账号状态 |

---

## 多账号模式（可选）

如需负载均衡，可添加多个 Google 账号：

```bash
npx antigravity-claude-proxy accounts add
```

多账号特性：
- **粘性账号选择**：尽量保持使用同一账号，提高缓存命中率
- **智能限流处理**：短限流等待，长限流自动切换账号
- **自动冷却**：限流账号在重置时间后自动恢复

查看账号状态：
```bash
curl "http://localhost:8080/account-limits?format=table"
```

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
| `/v1/models` | GET | 列出可用模型 |
| `/refresh-token` | POST | 强制刷新令牌 |

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
