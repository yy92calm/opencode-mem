# opencode-mem

**[English](./README.md)**

> 为 [OpenCode](https://opencode.ai) 提供持久化记忆能力，基于集中式 Worker。对话内容自动采集；定时任务将其提炼为用户画像，注入后续会话。

本仓库包含两部分：

| 路径        | 说明                                                   |
|-------------|--------------------------------------------------------|
| [`server/`](./server)  | **Worker** — Hono + SQLite + cron + LLM。单实例部署，随处可运行。 |
| [`src/`](./src)        | **Plugin** — 轻量 OpenCode 钩子客户端。每个 OpenCode 实例运行。 |

## 工作原理

```
┌─────────────────────────┐         ┌─────────────────────────────────┐
│  OpenCode (每台设备)     │  HTTPS  │   Worker (单实例)                │
│  ─────────────────────  │  ─────► │   ────────────────────────────  │
│  • tool.execute.after   │  原始   │   raw_conversations   (90 天)   │
│  • 用户消息              │  ─────► │   hard_memories       (永久)    │
│  • "记住X" → Skill      │  记忆   │             │                   │
│                         │         │             ▼ 定时任务           │
│  • 注入系统提示词        │  ◄───── │   daily_summaries (LLM)         │
│                         │ 用户画像 │   user_profiles   (LLM)         │
└─────────────────────────┘         └─────────────────────────────────┘
```

**两条数据通道，统一 HTTP API：**

1. **原始对话** — 每次工具调用 + 用户消息，由插件批量刷新。低成本，可丢失，90 天后自动清理。
2. **硬记忆** — 通过 `mem-remember` skill 显式创建的"记住 X / remember X"条目。永久存储，支持 FTS5 全文搜索。

**Worker 内部运行三个定时任务：**

| 时间                   | 任务                                                       |
|------------------------|-----------------------------------------------------------|
| 每天 03:00             | LLM 将昨天的原始对话提炼为每日摘要                          |
| 每周日 03:00           | LLM 从最近 7 天摘要构建用户画像（硬记忆单独注入）          |
| 用户新增 ≥10 条硬记忆时 | LLM 立即刷新用户画像                                        |

Worker 是唯一数据源。插件除一个小型 JSONL 离线缓存外无本地存储（仅在 Worker 不可达时使用）。

## 快速开始

### 1. 启动 Worker

```bash
cd server
cp config.example.yaml config.yaml         # 编辑用户配置 + LLM 模型
export LLM_API_KEY=sk-...                  # 你的 OpenAI/OpenRouter/等 API Key
export USER_VINCENT_KEY=$(openssl rand -hex 32)
npm install
npm run dev                                # 或 `docker compose up -d`
```

完整部署和 API 文档见 [`server/README.md`](./server/README.md)。

### 2. 安装插件

```bash
npm install
npm run build:all
npm run install:opencode                   # 复制 bundle + skills 到 ~/.config/opencode/
```

### 3. 配置插件

方式一：设置环境变量

```bash
export MEM_SERVER_URL=http://localhost:3777
export MEM_API_KEY=<步骤1中设置的相同 key>
```

方式二：写入配置文件 `~/.config/opencode/mem/config.json`：

```json
{
  "server_url": "http://localhost:3777",
  "api_key": "<相同的 key>"
}
```

重启 OpenCode，完成。

## 弱网行为

设计为 Worker 不可达时优雅降级：

| 场景 | 行为 |
|---|---|
| Worker 宕机 → 上传原始对话 | 批次写入 `offline.jsonl` 缓存，无数据丢失 |
| Worker 宕机 → 写入硬记忆 | 本地缓存，返回 `null`，不崩溃 |
| Worker 宕机 → 获取画像 | 回退到 `profile.cache.md` 中的最后已知画像 |
| Worker 会话中恢复 | 后台看门狗（默认 5 分钟）自动重放缓存 |
| 进程被终止 (SIGTERM/SIGINT) | 内存缓冲区在退出前刷新到离线缓存 |
| 缓存无限增长 | 达到 10 MB 时轮转为 `.jsonl.bak`（覆盖旧 `.bak`） |
| 缓存含无效条目 | 4xx（服务端拒绝）条目作为死信丢弃；5xx/网络错误重试 |
| 聊天启动时高延迟 | 画像获取限制 2 秒超时，回退到本地缓存 |

所有阈值可在插件配置中调整：

| 配置项                       | 默认值 | 用途 |
|------------------------------|--------|------|
| `raw_buffer_size`            | 20     | 缓冲区达到 N 条时自动刷新 |
| `raw_flush_interval_ms`      | 10 000 | 即使缓冲区未满也定期刷新 |
| `watchdog_interval_ms`       | 300 000 | 重放离线缓存 + 重新检查健康状态 |
| `write_timeout_ms`           | 15 000 | POST 请求超时 |
| `read_timeout_ms`            | 10 000 | GET 请求超时 |
| `profile_fetch_timeout_ms`   | 2 000  | 聊天启动时画像获取的严格超时 |
| `profile_cache_ttl_ms`       | 60 000 | 内存画像缓存 TTL（0 禁用） |
| `memories_cache_ttl_ms`      | 30 000 | 内存硬记忆缓存 TTL（0 禁用） |
| `offline_cache_path`         | `~/.config/opencode/mem/offline.jsonl` | JSONL 追加日志 |
| `offline_cache_max_bytes`    | `10485760` | 轮转阈值 (10 MB) |
| `profile_cache_path`         | `~/.config/opencode/mem/profile.cache.md` | 最后已知画像 |

## Worker 部署位置

Worker 只是一个 HTTP 服务。部署在符合你信任边界的位置：

- **本地** — 单用户，无网络暴露，`127.0.0.1:3777`
- **家庭服务器 / NAS** — 多设备个人使用，通过 LAN/VPN 访问
- **云服务器** — 多设备随处访问；**必须**配置 TLS + 限制 CORS

插件只看到 `server_url`。同一二进制文件，同一配置结构，不同网络位置。

## 插件提供的功能

5 个工具，全部由 Worker HTTP 调用支持：

| 工具           | 用途                                              |
|----------------|--------------------------------------------------|
| `mem-capture`  | 插入硬记忆（由 `mem-remember` skill 调用）         |
| `mem-search`   | 全文搜索硬记忆                                     |
| `mem-list`     | 列出最近的硬记忆                                   |
| `mem-profile`  | 获取最新用户画像                                   |
| `mem-health`   | 检查 Worker 连接 + 排空离线缓存                    |

[`skills/`](./skills/) 中的 4 个 skill 封装插件工具。`mem-remember` 是触发词 skill，路由到 `mem-capture`；其余（`mem-capture`、`mem-search`、`mem-profile`）各自封装同名工具。

## 从 v1 迁移（本地 Markdown）

v1 将 Markdown 文件写入 `~/.config/opencode/mem/`。v2 无本地存储。迁移脚本待开发 — 目前硬记忆可手动重新输入（原始历史不值得迁移）。

## 许可证

MIT
