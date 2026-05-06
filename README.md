# memorag

A Node.js/TypeScript library that acts as an intelligent context management layer between your code and any LLM. memorag learns your project incrementally and injects only the relevant context per query — saving tokens and improving response quality.

**No API keys required.** memorag uses static analysis to extract module structure and integrates with AI coding assistants via MCP (Model Context Protocol). The LLM is provided by the host assistant, not by memorag.

## How it works automatically

When you connect memorag as an MCP server, it sends **instructions** to the AI assistant via the MCP protocol — no extra config files or setup needed. Any MCP-compatible client (Claude Code, OpenCode, Codex, etc.) receives these instructions automatically and knows how to use memorag's tools:

1. **Before answering** → the assistant calls `retrieve_context` to load relevant modules
2. **When reading/editing files** → the assistant calls `ingest_file` to update memory
3. **After learning facts** → the assistant calls `save_fact` to persist verified knowledge

This is **built into the MCP protocol** — zero external dependencies, zero config files.

## Features

- **Zero cost** — no external API calls, runs entirely locally
- **MCP server** — plug into any MCP-compatible assistant, instructions delivered automatically
- **Static parsing** — extracts exports, imports, classes, functions, and throws from TS/JS, Python, Go, Rust, Java, Ruby
- **Persistent memory** — stores structured JSON summaries under your project
- **Hash-based refresh** — re-ingests automatically when source files change
- **Confidence scoring** — only persists facts above a configurable threshold
- **Token-efficient retrieval** — keyword matching with scoring and one-level relational expansion
- **CLI** — ingest, inspect, and parse from the terminal

## Installation

```bash
npm install memorag
```

Requires Node.js 18+.

## Quick start — MCP server

Add to your MCP client config (Claude Code, OpenCode, etc.):

```json
{
  "mcpServers": {
    "memorag": {
      "command": "npx",
      "args": ["-y", "memorag", "--memory-path", "./docs/memorag"]
    }
  }
}
```

That's it. The AI assistant will automatically use memorag's tools when connected:

| Tool | Description |
|------|-------------|
| `ingest_file` | Analyze a source file and store a structured summary |
| `retrieve_context` | Get relevant modules and facts for a query |
| `save_fact` | Save a verifiable fact from conversation |
| `register_module` | Manually register or refine a module |
| `get_memory` | Retrieve the full memory state |
| `remove_module` | Remove a module from memory |

Example workflow in Claude Code:

```
> ingest_file ./src/auth/AuthService.ts
→ Module "AuthService" saved: exports login(), verify(), dependencies UserRepository

> retrieve_context how does authentication work?
→ AuthService: Manages JWT tokens. Exposes login(), verify(). Depends on UserRepository.
  UserRepository: Reads and writes user records. Exposes findById(), save().

> save_fact "Tokens expire after 24h" "AuthService" 0.95
→ Fact saved: "Tokens expire after 24h" (AuthService, confidence: 0.95)
```

## Quick start — Programmatic API

```typescript
import { MemoAgent } from 'memorag'

const agent = new MemoAgent({
  memoryPath: './docs/memorag',
  confidenceThreshold: 0.7,
  logLevel: 'info',
})

// Ingest source files — parses statically, no LLM needed
await agent.ingest('./src/auth/AuthService.ts')
await agent.ingest('./src/user/UserRepository.ts')

// Retrieve relevant context for a query
const { global, modules } = await agent.retrieve('authentication flow')

// Save facts discovered during conversation
await agent.saveFact('Tokens expire after 24h', 'AuthService', 0.95)

// Inspect memory
const memory = await agent.getMemory()
console.log(memory.modules)

// List, get, or remove modules
const names = await agent.listModules()
const mod = await agent.getModule('AuthService')
await agent.removeModule('AuthService')
```

## CLI

```bash
# Start MCP server (default)
npx memorag

# Ingest a file
npx memorag ingest ./src/auth/AuthService.ts

# Parse a file without saving (dry run)
npx memorag parse ./src/auth/AuthService.ts

# Inspect current memory
npx memorag inspect
```

Options:

- `--memory-path <path>` — where memory is persisted (default: `./docs/memorag`)

## How it works

### `ingest(filePath)`

1. Reads the source file and computes a hash
2. Skips if the file hasn't changed since last ingest
3. Parses the file statically (no LLM) — extracts exports, imports, classes, functions, throws, tags
4. Persists a structured summary to `docs/memorag/modules/{name}.json`

### `retrieve(query)`

1. Checks if any ingested source files have changed — re-ingests if so
2. Retrieves relevant modules via keyword matching + relational expansion
3. Returns scored modules and global facts for context injection

### `saveFact(fact, module, confidence)`

Saves a verifiable fact to global memory. Facts below the confidence threshold are discarded.

## Memory structure

```
docs/memorag/
├── global.json          # architecture, conventions, cross-cutting facts
└── modules/
    ├── AuthService.json
    ├── UserRepository.json
    └── ...
```

Each module entry:

```json
{
  "name": "AuthService",
  "responsibility": "Defines AuthService. exposes: login(), verify()",
  "exposes": ["AuthService", "login()", "verify()"],
  "dependencies": ["UserRepository"],
  "usedBy": ["ApiGateway"],
  "classes": ["AuthService"],
  "throws": ["UnauthorizedError"],
  "tags": ["auth", "service"],
  "sourcePath": "src/auth/AuthService.ts",
  "sourceHash": "75a3f9c2d1"
}
```

## API Reference

### `new MemoAgent(config?)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `memoryPath` | `string` | `./docs/memorag` | Where to persist memory |
| `confidenceThreshold` | `number` | `0.7` | Minimum confidence to save facts |
| `logLevel` | `'debug' \| 'info' \| 'warn' \| 'error' \| 'silent'` | `'silent'` | Log verbosity |

### `agent.ingest(sourcePath): Promise<void>`

Parses the file statically and saves a module summary. Skips if unchanged.

### `agent.retrieve(query): Promise<{ global, modules }>`

Returns relevant context (global facts + modules) for a query.

### `agent.saveFact(fact, module, confidence): Promise<void>`

Persists a fact to global memory if confidence is above threshold.

### `agent.saveModule(module): Promise<void>`

Manually register or update a module.

### `agent.getModule(name): Promise<ModuleMemory | null>`

Get a single module by name.

### `agent.listModules(): Promise<string[]>`

List all module names.

### `agent.removeModule(name): Promise<boolean>`

Remove a module from memory.

### `agent.getMemory(): Promise<{ global, modules }>`

Returns the full memory state.

### `StaticParser.parse(filePath, content): ParsedModule | null`

Static method — parses a file and returns extracted metadata. Returns `null` for unsupported file types.

### `KeywordContextRetriever`

Accepts `maxModules` config to limit the number of returned modules.

## Supported languages

| Language | Extensions | Imports | Exports | Classes | Functions | Throws |
|----------|-----------|---------|---------|---------|-----------|--------|
| TypeScript/JS | `.ts` `.tsx` `.js` `.jsx` | Yes | Yes | Yes | Yes | Yes |
| Python | `.py` `.pyi` | Yes | Yes | Yes | Yes | Yes |
| Go | `.go` | — | Yes | Yes | Yes | — |
| Rust | `.rs` | Yes | Yes | Yes | Yes | — |
| Java | `.java` | — | Yes | Yes | Yes | Yes |
| Ruby | `.rb` | Yes | Yes | Yes | Yes | Yes |

## Architecture

```
memorag
├── MCP Server          — tools for AI assistants (automatic instructions via protocol)
├── MemoAgent           — programmatic API
├── StaticParser        — language-aware static analysis (no LLM)
├── MemoryStore         — persists/reads JSON from disk
├── ContextRetriever    — keyword scoring + relational expansion
└── PromptBuilder       — formats context for injection (utility)
```

Every layer is an interface — swap any implementation without touching the rest.

## License

MIT