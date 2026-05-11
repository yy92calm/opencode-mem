# opencode-mem

> 从 [claude-mem](https://github.com/thedotmack/claude-mem) 改造而来，专为 [OpenCode](https://opencode.ai) 设计的持久化记忆插件。

[OpenCode](https://opencode.ai) 的持久化记忆 **插件** — 通过 Markdown 文件实现跨会话上下文保持。

## 改造说明

本项目基于 [claude-mem](https://github.com/thedotmack/claude-mem) 的架构理念进行重构，主要改动：

| 维度 | claude-mem | opencode-mem |
|------|-----------|-------------|
| **目标平台** | Claude Code | OpenCode |
| **存储方式** | SQLite + ChromaDB 向量数据库 | 纯 Markdown 文件 |
| **运行模式** | 常驻 Worker 守护进程 | 无守护进程，插件即插即用 |
| **集成方式** | Claude Code Hooks + MCP 服务器 | OpenCode Plugin + Lifecycle Hooks |
| **搜索方式** | FTS5 + 向量语义搜索 | 文件内容匹配 + 关键词搜索 |
| **依赖** | Bun、uv、Python、Express | 仅 Node.js 内置模块 |
| **复杂度** | 重型系统，需要多个外部依赖 | 轻量级，零运行时依赖 |

核心设计理念保持一致：
- 跨会话保持上下文
- 自动捕获工具使用观察
- 渐进式上下文注入
- 隐私控制（`<private>` 标签）

## 架构

```
┌─────────────────────────────────────────────────────────┐
│                    OpenCode Server                       │
│  ┌───────────────────────────────────────────────────┐  │
│  │              opencode-mem Plugin                   │  │
│  │                                                    │  │
│  │  session.created ──→ 注入记忆上下文到系统提示       │  │
│  │  tool.execute.after ──→ 自动捕获工具使用观察        │  │
│  │  message.updated ──→ 追踪用户提示词                 │  │
│  │  session.idle ──→ 写入会话摘要                     │  │
│  │                                                    │  │
│  │  自定义工具:                                        │  │
│  │    mem-search   — 搜索历史观察                     │  │
│  │    mem-capture  — 手动捕获观察                     │  │
│  │    mem-context  — 获取完整记忆上下文                │  │
│  └──────────────────────┬────────────────────────────┘  │
│                         │                                │
│                         ▼                                │
│              .opencode/mem/ (纯 Markdown)                │
│              ├── INDEX.md                                │
│              ├── observations/0001-xxx.md                │
│              ├── sessions/2026-05-11-xxx.md              │
│              └── concepts/                               │
└─────────────────────────────────────────────────────────┘
```

## 特性

- **OpenCode 原生插件** — 通过 `opencode.json` 或 `.opencode/plugins/` 加载
- **生命周期钩子** — `session.created`、`tool.execute.after`、`message.updated`、`session.idle`
- **自定义工具** — `mem-search`、`mem-capture`、`mem-context`
- **纯 Markdown 存储** — 所有记忆都是 `.md` 文件，存储在 `.opencode/mem/`
- **Git 友好** — 可将记忆文件与项目一起提交
- **零运行时依赖** — 无数据库、无守护进程、无外部服务

## 安装

### 前置要求

- Node.js >= 20.0.0
- npm 或 bun

### 方式一：一键安装（推荐）

```bash
# 克隆项目
git clone https://github.com/yy92calm/opencode-mem.git
cd opencode-mem

# 安装依赖并打包
npm install

# 一键安装到 OpenCode
npm run install:opencode
```

这会自动：
1. 安装依赖
2. 使用 esbuild 打包成单文件
3. 复制插件到 `~/.config/opencode/plugins/`
4. 复制技能到 `~/.config/opencode/skills/`

### 方式二：手动安装

```bash
# 1. 安装依赖
npm install

# 2. 构建并打包
npm run build:all

# 3. 安装插件（全局）
mkdir -p ~/.config/opencode/plugins
cp dist/opencode-mem.bundle.js ~/.config/opencode/plugins/opencode-mem.js

# 4. 安装技能（可选）
mkdir -p ~/.config/opencode/skills
cp -r skills/mem-* ~/.config/opencode/skills/
```

### 方式三：项目级插件

将打包后的插件放在项目的 `.opencode/plugins/` 目录：

```bash
mkdir -p .opencode/plugins
cp dist/opencode-mem.bundle.js .opencode/plugins/opencode-mem.js
```

## 钩子（Hooks）

| 钩子 | 触发时机 | 动作 |
|------|---------|------|
| `session.created` | 新会话启动 | 将记忆上下文注入系统提示 |
| `tool.execute.after` | 工具执行完成 | 捕获重要观察记录 |
| `message.updated` | 消息更新 | 追踪用户提示词用于会话摘要 |
| `session.idle` | 会话结束/空闲 | 写入会话摘要 |

## 自定义工具

### mem-search

搜索历史观察：

```
mem_search(query="认证 bug", type="bugfix", limit=10)
```

### mem-capture

手动捕获观察：

```
mem_capture(
  type="decision",
  title="使用 Zod 进行验证",
  narrative="比较 Zod 和 Joi 后，我们选择了 Zod 因为..."
)
```

### mem-context

获取完整记忆上下文：

```
mem_context(maxObservations=15, maxSessions=3)
```

## 记忆结构

```
.opencode/mem/
├── INDEX.md              # 自动生成的索引
├── observations/         # 独立观察记录
│   ├── 0001-auth-bug-fix.md
│   ├── 0002-api-refactor.md
│   └── 0003-decision-use-zod.md
├── sessions/             # 会话摘要
│   ├── 2026-05-11-refactor-api.md
│   └── 2026-05-12-add-auth.md
└── concepts/             # 概念文档
```

## 观察记录格式

```markdown
---
id: 1
type: "bugfix"
title: "JWT 过期 Bug"
subtitle: "修复 API 路由上的令牌验证"
session: "session-abc123"
timestamp: "2026-05-11T14:30:00.000Z"
facts:
  - "令牌验证缺少 exp 声明检查"
concepts:
  - "authentication"
  - "jwt"
files_read:
  - "packages/auth/jwt.ts"
files_modified:
  - "packages/auth/jwt.ts"
---

# JWT 过期 Bug

> 修复 API 路由上的令牌验证

## 详细描述

JWT 中间件没有检查传入令牌中的 `exp` 声明...
```

## 观察类型

| 类型 | 说明 |
|------|------|
| `bugfix` | 修复的 Bug 及方法 |
| `feature` | 实现的功能 |
| `refactor` | 重构决策及理由 |
| `decision` | 架构/设计决策 |
| `discovery` | 代码库的重要发现 |
| `config` | 配置变更及原因 |
| `error` | 遇到的错误及解决方案 |

## 开发

```bash
# 安装依赖
npm install

# 类型检查
npm run typecheck

# 构建 TypeScript
npm run build

# 打包成单文件（必须）
npm run bundle

# 构建 + 打包
npm run build:all

# 安装到 OpenCode
npm run install:opencode

# 运行测试
npm run test
```

### 重要说明

OpenCode 插件系统要求插件必须是**单文件**，因此需要使用 esbuild 打包：

```bash
npm run bundle
```

生成的 `dist/opencode-mem.bundle.js` 才是实际加载的文件。

## 验证安装

重启 OpenCode 后，检查日志确认插件加载：

```bash
# 查看最新日志
ls -t ~/.local/share/opencode/log/*.log | head -1 | xargs grep -i "opencode-mem\|mem-search\|mem-capture\|mem-context"
```

成功加载的标志：
```
INFO  service=plugin path=.../opencode-mem.js loading plugin
INFO  service=tool.registry status=completed mem-search
INFO  service=tool.registry status=completed mem-capture
INFO  service=tool.registry status=completed mem-context
```

## 记忆存储

记忆文件存储在项目根目录的 `.opencode/mem/` 下：

```
<项目>/.opencode/mem/
├── INDEX.md              # 自动生成的索引
├── observations/         # 观察记录
├── sessions/             # 会话摘要
└── concepts/             # 概念文档
```

首次使用时目录会自动创建。

## 隐私

在提示词中使用 `<private>` 标签排除敏感内容：

```
<private>
这里包含 API 密钥 — 不要捕获。
</private>
```

## 许可证

MIT
