# opencode-mem

> 基于 [claude-mem](https://github.com/thedotmack/claude-mem) 架构理念，为 [OpenCode](https://opencode.ai) 设计的智能记忆插件。

## 核心特点

相比原版 claude-mem 的改进：

| 维度 | claude-mem | opencode-mem |
|------|-----------|-------------|
| **目标平台** | Claude Code | OpenCode |
| **存储方式** | SQLite + ChromaDB | 纯 Markdown 文件 |
| **AI 集成** | Anthropic API 独立调用 | OpenCode SDK（使用已配置模型） |
| **运行模式** | Worker 守护进程 | 插件即插即用 |
| **依赖** | Bun、Python、Express | 仅 Node.js |

## 工作原理

```
用户操作 → tool.execute.after 钩子
           ↓
    判断是否值得记录（过滤 trivial 操作）
           ↓
    创建独立观察会话（避免阻塞用户会话）
           ↓
    调用 OpenCode SDK session.prompt()
    使用 JSON Schema 结构化输出
           ↓
    AI 生成语义化的观察记录：
    - type: discovery/feature/bugfix/refactor/change/decision
    - title: "学到了什么？"
    - facts: 关键发现
    - concepts: 相关领域
           ↓
    写入 ~/.config/opencode/mem/observations/*.md
           ↓
    更新 INDEX.md 索引
```

**关键设计**：
- 使用独立观察会话，AI 分析不阻塞用户会话消息队列
- 日志通过 SDK 发送到日志系统，不干扰对话框
- 记忆存储在全局目录，跨项目共享

## 安装

```bash
git clone https://github.com/yy92calm/opencode-mem.git
cd opencode-mem
npm install
npm run install:opencode
```

安装后重启 OpenCode，插件自动生效。

**无需额外配置 API 密钥** —— 使用您在 OpenCode 中已配置的模型即可。

## 功能

### 自动观察记录

每次工具执行（read、write、edit、bash 等）后：

- **过滤 trivial 操作**：空输出、简单 ls/echo、无意义的操作不记录
- **AI 生成语义化标题**：不是 "Read: oauth.ts"，而是 "OAuth2 使用 PKCE 流程"
- **提取关键事实**：从输出中提取 2-5 条重要发现
- **标记相关概念**：auth、database、api、security 等

### 会话摘要

会话结束时（session.idle）自动生成：

- 用户意图
- 探索了什么
- 学到了什么
- 完成了什么
- 下一步建议

### 搜索历史记忆

通过 MCP 工具搜索：

```
mem-search(query="认证实现", type="discovery", limit=10)
```

### 手动记录决策

```
mem-capture(
  type="decision",
  title="选择 Zod 做 schema 验证",
  narrative="对比 Joi 和 Zod 后选择了 Zod，因为..."
)
```

## 存储结构

```
~/.config/opencode/mem/
├── INDEX.md              # 自动生成的索引
├── observations/         # 观察记录
│   ├── 0001-oauth-pkce.md
│   ├── 0002-api-refactor.md
│   └── 0003-db-index.md
├── sessions/             # 会话摘要
│   ├── 2026-05-11-auth-work.md
│   └── 2026-05-12-api-fix.md
└── concepts/             # 概念文档
```

## 观察记录格式

```markdown
---
id: 1
type: "discovery"
title: "OAuth2 使用 PKCE 流程"
subtitle: "发现安全的 OAuth2 实现带自动令牌刷新"
timestamp: "2026-05-11T14:30:00Z"
facts:
  - "每 55 分钟自动刷新令牌"
  - "实现了 state 参数验证"
  - "CORS 头正确配置"
concepts:
  - "authentication"
  - "security"
  - "oauth2"
files_read:
  - "src/auth/oauth.ts"
---

# OAuth2 使用 PKCE 流程

OAuth2 处理器实现了 PKCE（Proof Key for Code Exchange）以增强安全性...

自动令牌刷新机制确保用户会话保持活跃...
```

## AI 集成原理

### 为什么用 OpenCode SDK？

1. **无需额外 API 密钥** —— 用户已在 OpenCode 配置模型
2. **使用用户选择的模型** —— Claude、OpenRouter、Gemini 都支持
3. **集成会话管理** —— 利用 OpenCode 的模型选择系统
4. **结构化输出验证** —— JSON Schema 确保格式正确

### 如何工作？

调用 `client.session.prompt()` 时传入：

```typescript
{
  parts: [{ type: "text", text: observationPrompt }],
  outputFormat: {
    type: "json_schema",
    schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["discovery", "feature", ...] },
        title: { type: "string", maxLength: 200 },
        facts: { type: "array", items: { type: "string" } },
        ...
      },
      required: ["type", "title", "facts"]
    },
    retryCount: 2
  }
}
```

AI 返回符合 Schema 的 JSON，插件解析后写入 Markdown。

## 开发

```bash
npm install
npm run build:all      # 构建 + 打包
npm run install:opencode  # 安装到 OpenCode
```

插件必须是单文件，因此用 esbuild 打包成 `dist/opencode-mem.bundle.js`。

## 注意事项

- **Fire-and-forget 分析**：规则生成立即保存，AI 分析异步后台运行，不阻塞用户会话
- **独立观察会话**：AI 分析使用独立会话，插件生命周期内复用，重启后自动重建
- **全局记忆目录**：所有项目共享 `~/.config/opencode/mem/` 目录
- **日志系统**：插件日志通过 SDK 发送，不在对话中显示
- **重启生效**：安装或更新后需要重启 OpenCode

## 许可证

MIT

## 参考项目

- [claude-mem](https://github.com/thedotmack/claude-mem) - 原始灵感来源
- [OpenCode](https://opencode.ai) - 目标平台
- [OpenCode SDK 文档](https://opencode.ai/docs/zh-cn/sdk/) - 结构化输出 API