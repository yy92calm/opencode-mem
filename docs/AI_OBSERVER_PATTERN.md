# OpenCode Memory - AI Observer Pattern

## Architecture

OpenCode Memory implements an **AI-driven observation system** inspired by [claude-mem](https://github.com/thedotmack/claude-mem), where Claude AI acts as an intelligent observer of your development session.

### Key Components

#### 1. **Tool Execution Hook** (`tool.execute.after`)

When you use a tool (read, write, edit, bash, etc.), the plugin captures:
- Tool name and parameters
- Execution output/result
- Working directory
- Timestamp

#### 2. **AI Observer** (`src/ai/observer.ts`)

For each tool execution, Claude AI:
- Analyzes what was done
- Extracts key learnings and findings
- Generates a meaningful observation with:
  - **Type**: discovery | feature | bugfix | refactor | change | decision
  - **Title**: "What was learned?" (not "what operation ran?")
  - **Subtitle**: One-sentence summary
  - **Narrative**: Full context and findings
  - **Facts**: Key concrete statements
  - **Concepts**: Domain areas affected (auth, database, api, etc.)
  - **Files**: Files read/modified

#### 3. **Prompt System** (`src/ai/prompts.ts`)

Two main prompts guide Claude:

**Observation Prompt**:
- Instructs AI to analyze tool execution
- Focus on LEARNINGS not ACTIONS
- Returns structured JSON observation

**Session Summary Prompt**:
- Summarizes entire session
- Answers: What was accomplished? What's next?
- Returns request/investigated/learned/completed/nextSteps

#### 4. **Fallback System**

If AI is unavailable or fails:
1. Check if `ANTHROPIC_API_KEY` is set
2. Fall back to rule-based observation generation
3. Generate basic titles/subtitles from tool metadata

### Data Flow

```
Tool Execution
    ↓
tool.execute.after hook
    ↓
Check if trivial (skip)
    ↓
AI Observer (if ANTHROPIC_API_KEY set)
  ├─ Build prompt with tool execution
  ├─ Call Anthropic Claude API
  ├─ Parse JSON response
  └─ Return parsed observation
    ↓
Write to ~/.config/opencode/mem/observations/
    ↓
Update FTS5 search index
    ↓
Log observation ID
```

## Usage

### 1. Setup

Set your Anthropic API key:

```bash
export ANTHROPIC_API_KEY="sk-..."
```

### 2. Enable Memory

OpenCode Memory is enabled by default once the plugin is installed.

Memory files are stored in:
- Global: `~/.config/opencode/mem/`
- Observations: `~/.config/opencode/mem/observations/*.md`
- Sessions: `~/.config/opencode/mem/sessions/*.md`
- Index: `~/.config/opencode/mem/INDEX.md`

### 3. Use MCP Tools

**mem-search**:
```
Query: "authentication implementation"
Type: discovery
Limit: 10
```

**mem-capture**:
Manually capture an observation with custom details.

**mem-context**:
Get relevant memory context for current project.

**mem-summarize**:
Generate summary of current session.

## Example Observation

When you read `src/auth/oauth.ts`:

**With AI**:
```markdown
---
type: discovery
title: "OAuth2 implementation uses PKCE flow"
subtitle: "Found secure OAuth2 implementation with automatic token refresh"
---

# OAuth2 implementation uses PKCE flow

The OAuth2 handler implements PKCE (Proof Key for Code Exchange) for enhanced security.

**Key Findings**:
- Automatic token refresh every 55 minutes
- State parameter validation implemented
- CORS headers properly configured

**Concepts**: authentication, security, oauth2
```

**With Rule-Based Fallback**:
```markdown
---
type: discovery
title: "Explored: oauth.ts"
subtitle: "Read oauth.ts to understand implementation"
---

# Explored: oauth.ts

File exploration completed.
```

## Design Decisions

### Why AI as Observer?

1. **Semantic Understanding**: AI captures the intent and learnings, not just operations
2. **Smart Filtering**: AI decides what's worth recording (trivial operations skipped)
3. **Better Search**: AI-generated titles and summaries are more searchable
4. **Context Awareness**: Claude understands domain concepts (auth, performance, security, etc.)
5. **Consistency**: Same AI model ensures consistent observation quality

### Why Fallback to Rules?

1. **Cost**: AI calls cost money; fallback for cost-conscious users
2. **Privacy**: Users without API key don't send data to Anthropic
3. **Reliability**: Works offline; no API dependency
4. **Speed**: Rule-based is instant, AI has latency

### Why Markdown Files?

1. **Git-Friendly**: Easy to version control memory
2. **Human-Readable**: Browse observations directly
3. **Portable**: No database lock-in
4. **Searchable**: FTS5 indexes markdown content
5. **Extensible**: Easy to add metadata, templates, custom formats

## API Reference

### `generateAIObservation(toolExecution, fallbackGenerator?)`

Generate observation from tool execution using AI.

**Parameters**:
- `toolExecution`: Tool name, input, output, timestamp, workdir
- `fallbackGenerator`: Optional function returning rule-based observation

**Returns**: `ParsedObservation | null`

**Example**:
```typescript
const observation = await generateAIObservation({
  tool: 'read',
  input: { filePath: 'src/auth/oauth.ts' },
  output: '... file contents ...',
  timestamp: '2026-05-12T10:30:00Z',
  workdir: '/home/user/project',
});
```

### `generateAISummary(sessionInfo)`

Generate session summary using AI.

**Parameters**:
- `sessionInfo`: User request, tools used, files touched, observations

**Returns**: `ParsedSummary | null`

## Prompt Engineering

The system uses carefully crafted prompts to ensure quality observations:

1. **Focus on Learnings**: "What did we learn?" not "what operation ran?"
2. **Structured Output**: JSON format ensures parseable responses
3. **Type Guidance**: Valid observation types constrain responses
4. **Fallback Instructions**: Clear skip conditions reduce noise
5. **Example Format**: Shows expected output structure

### Observation Prompt

```
You are an AI observer for a software development session.
Analyze this tool execution and create a meaningful observation record.

[Tool Execution Details]

Your Task:
Generate a structured observation that captures what was learned or discovered.

Output Format:
{
  "type": "discovery",
  "title": "[One-line title, max 60 chars]",
  "subtitle": "[One sentence, max 120 chars]",
  "narrative": "[2-3 sentences with full context]",
  "facts": ["fact 1", "fact 2"],
  "concepts": ["concept1", "concept2"],
  "filesRead": ["file1"],
  "filesModified": ["file2"]
}

Guidelines:
- title should answer "what did we learn?" not "what operation ran?"
- Return { "skip": true } for trivial operations
```

## Troubleshooting

### AI observations not generating

1. Check `ANTHROPIC_API_KEY` is set:
   ```bash
   echo $ANTHROPIC_API_KEY
   ```

2. Check plugin logs:
   ```bash
   tail -f ~/.opencode/logs/plugin.log
   ```

3. Verify API key is valid:
   ```bash
   curl https://api.anthropic.com/v1/models \
     -H "x-api-key: $ANTHROPIC_API_KEY"
   ```

### Too many trivial observations

AI observer automatically skips:
- Empty status checks
- Simple file listings
- Package installations
- Routine operations

If still too many, adjust `isTrivial()` in `src/utils/observer.ts`

### Slow observation generation

AI calls have ~1-3 second latency. This is normal and worth the better quality observations. Async processing prevents blocking.

### Memory storage growing large

Observations are stored in `~/.config/opencode/mem/observations/`.

To clean up:
```bash
# View stats
du -sh ~/.config/opencode/mem/

# Archive old observations (manual)
mkdir -p ~/.config/opencode/mem/archived
find ~/.config/opencode/mem/observations -mtime +30 -exec mv {} ~/.config/opencode/mem/archived \;
```

## Future Improvements

1. **Batch Processing**: Group multiple tool executions before AI analysis
2. **Caching**: Cache similar observations to reduce API calls
3. **Fine-tuning**: Custom prompts per project type
4. **Webhook Integration**: Send observations to external services
5. **Streaming**: Real-time observation updates
6. **Cost Tracking**: Monitor API spending
7. **Model Selection**: Choose between Claude 3.5 Sonnet, Opus, Haiku
8. **Custom Extractors**: Plugin system for domain-specific extractors

## See Also

- [claude-mem Documentation](https://github.com/thedotmack/claude-mem)
- [Anthropic Claude API](https://docs.anthropic.com)
- [OpenCode Plugin System](https://opencode.ai/docs)
