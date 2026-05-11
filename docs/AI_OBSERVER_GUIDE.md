# AI 观察者原理

## 核心思想

opencode-mem 使用 **AI 作为观察者**，而不是简单的规则提取。

### 传统方式的问题

```markdown
标题: "Read: oauth.ts"
副标题: "读取 oauth.ts 文件"
事实: []
概念: []
```

这只是记录了操作，没有提取意义。

### AI 观察者的优势

```markdown
标题: "OAuth2 使用 PKCE 流程"
副标题: "发现安全的 OAuth2 实现带自动令牌刷新"
事实:
  - "每 55 分钟自动刷新令牌"
  - "state 参数验证已实现"
  - "CORS 头正确配置"
概念: ["authentication", "security", "oauth2"]
```

AI 从工具执行中提取语义，生成有价值的记录。

## 技术实现

### OpenCode SDK 集成

opencode-mem 通过 OpenCode SDK 的 `session.prompt()` API 实现 AI 观察：

```typescript
import { setOpencodeClient } from './sdk/client.js';

// 插件初始化时设置客户端
export const MemPlugin = async ({ client }) => {
  setOpencodeClient(client);
  
  // ...
};
```

### 结构化输出

使用 JSON Schema 确保输出格式一致：

```typescript
const observationSchema = {
  type: "object",
  properties: {
    type: {
      type: "string",
      enum: ["discovery", "feature", "bugfix", "refactor", "change", "decision"],
    },
    title: {
      type: "string",
      maxLength: 200,
      description: "学到了什么？不是做了什么操作"
    },
    facts: {
      type: "array",
      items: { type: "string" },
      maxItems: 10,
    },
    concepts: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: ["type", "title", "facts", "concepts"],
};
```

### Prompt 工程

构建有效的 prompt 是关键：

```typescript
function buildObservationPrompt(toolExecution) {
  return `分析这次工具执行并生成观察记录。

工具: ${toolExecution.tool}
输入: ${JSON.stringify(toolExecution.input)}
输出: ${toolExecution.output.substring(0, 2000)}

要求:
- 标题回答"学到了什么？"而非"执行了什么工具？"
- 事实应该是具体、自包含的陈述
- 概念应该关联领域: auth、database、api、performance、security 等

如果输出是 trivial 操作（空输出、简单 ls 等），返回最小内容。
`;
}
```

### 执行流程

```
tool.execute.after 钩子触发
    ↓
过滤 trivial 操作 (isTrivial)
    ↓
检查 SDK 客户端可用 (isSDKAvailable)
    ↓
构建 prompt + JSON Schema
    ↓
调用 client.session.prompt({
  path: { id: sessionId },
  body: {
    parts: [{ type: "text", text: prompt }],
    outputFormat: { type: "json_schema", schema, retryCount: 2 }
  }
})
    ↓
解析返回的 structured_output
    ↓
写入 Markdown 文件
    ↓
更新 FTS5 索引
```

### 回退机制

如果 SDK 不可用或 AI 调用失败：

```typescript
// 回退到规则生成
const fallback = generateObservation(toolName, input, output, type, sessionId);

// 使用简单标题如 "Explored: filename"
// 提取基本文件路径信息
```

用户仍能获得基本功能，只是标题不那么语义化。

## 设计决策

### 为什么用 OpenCode SDK 而非 Anthropic API？

**优势**：
- 无需额外 API 密钥
- 使用用户选择的模型（Claude、OpenRouter、Gemini 等）
- 集成会话管理
- 统一的模型配置

**对比 claude-mem**：
- claude-mem 启动独立的 Claude SDK 会话作为观察者
- opencode-mem 直接在主会话中调用 prompt，更轻量

### 为什么用 JSON Schema？

**确定性输出**：
- AI 必须返回符合 Schema 的 JSON
- SDK 自动验证结构
- 失败时重试 2 次

**对比 claude-mem 的 XML**：
- claude-mem 用 XML 格式输出观察记录
- opencode-mem 用 JSON Schema，更现代、更易解析
- OpenCode SDK 原生支持 JSON Schema 结构化输出

### 为什么过滤 trivial 操作？

**节省成本和时间**：
- 空输出不值得 AI 分析
- 简单 ls、echo、pwd 不生成观察
- 减少 AI 调用次数，降低延迟

**过滤规则**：
```typescript
function isTrivial(tool, input, output) {
  if (!output || output.trim().length < 50) return true;
  if (tool === 'bash') {
    const cmd = JSON.stringify(input).toLowerCase();
    if (cmd.includes('ls') || cmd.includes('pwd')) return true;
  }
  return false;
}
```

## Prompt 设计原则

### 1. 聚焦语义

```
错误: "Read: oauth.ts 文件"
正确: "OAuth2 使用 PKCE 流程"
```

### 2. 提供上下文

```
工具: read
输入: { filePath: "src/auth/oauth.ts" }
输出: [文件内容]
```

AI 看到完整上下文，能提取更多意义。

### 3. 限制输出

```
maxLength: 200 (标题)
maxLength: 5000 (叙述)
maxItems: 10 (事实)
```

防止 AI 生成过长内容，控制成本。

### 4. 明确要求

```
- 标题回答"学到了什么？"
- 事实必须具体、自包含
- 跳过 trivial 操作
```

明确指令让 AI 更可靠。

## 性能特征

| 操作 | 时间 | 说明 |
|------|------|------|
| 规则生成 | ~10ms | 立即返回 |
| SDK AI 调用 | ~1-3s | 网络延迟 + 模型推理 |
| 回退生成 | ~50ms | SDK 失败后立即回退 |

AI 调用有延迟，但换来更好的观察质量。

## 成本估算

使用用户配置的模型：

- **Claude 3.5 Sonnet**: ~$0.003/观察
- **OpenRouter 模型**: 根据模型定价
- **Gemini**: 根据模型定价

用户可以选择性价比合适的模型。

## 最佳实践

### 1. 选择合适模型

- 开发时用 Claude 3.5 Sonnet（高质量）
- 批量处理用 Haiku（成本低）
- 按需在 OpenCode 中切换

### 2. 监控观察质量

```bash
ls ~/.config/opencode/mem/observations/
cat ~/.config/opencode/mem/observations/0001-*.md
```

检查标题是否语义化。

### 3. 手动补充重要决策

```
mem-capture(
  type="decision",
  title="选择 PostgreSQL 作为主数据库",
  narrative="对比 MySQL 和 PostgreSQL..."
)
```

AI 不可能捕捉所有重要决策，手动记录关键决策。

## 未来改进

1. **批量处理**: 一次 prompt 分析多个工具执行
2. **缓存**: 相似模式避免重复 AI 调用
3. **自定义 Schema**: 项目特定的观察格式
4. **流式输出**: 实时生成观察
5. **质量评分**: AI 自评观察质量

## 参考

- [OpenCode SDK 文档](https://opencode.ai/docs/zh-cn/sdk/) - 结构化输出 API
- [claude-mem Prompt 设计](https://github.com/thedotmack/claude-mem/tree/main/src/sdk/prompts.ts) - XML 输出模式
- [Anthropic Structured Outputs](https://docs.anthropic.com/claude/docs/structured-output) - JSON Schema 最佳实践