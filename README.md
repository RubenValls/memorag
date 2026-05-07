# memorag-mcp

Zero-config persistent memory for AI coding assistants. memorag learns your codebase incrementally and injects relevant context into every conversation — automatically, with no API keys and no manual steps.

## How it works

You add **one JSON snippet** to your assistant's config. That's it. memorag:

1. Connects as an MCP server and sends instructions to the assistant automatically
2. The assistant calls `ingest_file` when it reads or edits source files → memorag parses them statically (no LLM needed, zero cost)
3. The assistant calls `retrieve_context` before answering code questions → gets relevant modules and facts
4. The assistant calls `save_fact` after learning verified facts → memorag persists them

You never trigger these tools manually. The assistant uses them because memorag tells it to via the MCP protocol.

## Setup

Add this to your MCP client config:

**Claude Code** — in `.claude/settings.json`:
```json
{
  "mcpServers": {
    "memorag": {
      "command": "npx",
      "args": ["-y", "memorag-mcp"]
    }
  }
}
```

**OpenCode** — in `.opencode.json`:
```json
{
  "mcpServers": {
    "memorag": {
      "command": "npx",
      "args": ["-y", "memorag-mcp"]
    }
  }
}
```

**Any MCP-compatible client** — same pattern: `command: "npx", args: ["-y", "memorag-mcp"]`.

That's the full setup. No `npm install`, no API keys, no config files. `npx` downloads and runs memorag automatically.

**Requires Node.js v18 or higher.** memorag will print a clear error if your Node version is too old.

## What happens after setup

When you ask your assistant a question, it will:

1. Call `retrieve_context("your question")` — loads relevant modules and facts from memory
2. Use that context to answer (instead of re-reading the entire codebase)
3. Call `ingest_file("/path/to/file.ts")` on files it reads or edits — updates memory
4. Call `save_fact("something it learned", "ModuleName", 0.95)` — saves verified knowledge

This all happens automatically. You just have normal conversations.

## Tools memorag provides

| Tool | When the assistant uses it | What it does |
|------|---------------------------|-------------|
| `ingest_file` | Reading or editing a source file | Parses statically, saves structured summary |
| `retrieve_context` | Before answering a code question | Returns relevant modules and global facts |
| `save_fact` | After discovering a verified fact | Persists fact with confidence score |
| `register_module` | When the static parser misses details | Manually define or correct a module |
| `get_memory` | Inspecting memory state | Returns all modules and facts |
| `remove_module` | When a module is deleted or renamed | Removes it from memory |

## What memorag parses automatically

No LLM involved. Pure static analysis:

| Language | Exports | Imports | Classes | Functions | Throws |
|----------|---------|----------|---------|-----------|--------|
| TypeScript/JS | Yes | Yes | Yes | Yes | Yes |
| Python | Yes | Yes | Yes | Yes | Yes |
| Go | Yes | — | Yes | Yes | — |
| Rust | Yes | Yes | Yes | Yes | — |
| Java | Yes | — | Yes | Yes | Yes |
| Ruby | Yes | Yes | Yes | Yes | Yes |

## Memory structure

Stored as human-readable JSON files. Default location: `~/.memorag` (your home directory, shared across projects). Override with `--memory-path`:

```
~/.memorag/
├── global.json          # project-wide facts
└── modules/
    ├── AuthService.json # per-module summaries
    └── UserRepository.json
```

Each module:
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

When source files change, memorag detects it by hash and re-ingests automatically.

## Programmatic API

For custom integrations:

```bash
npm install memorag-mcp
```

```typescript
import { MemoAgent } from 'memorag-mcp'

const agent = new MemoAgent({ memoryPath: './docs/memorag' })

await agent.ingest('./src/auth/AuthService.ts')
const { modules } = await agent.retrieve('authentication flow')
await agent.saveFact('Tokens expire after 24h', 'AuthService', 0.95)

const memory = await agent.getMemory()
const mod = await agent.getModule('AuthService')
const names = await agent.listModules()
await agent.removeModule('OldModule')
```

## CLI commands

The CLI runs automatically via MCP. These are available for manual use:

```bash
npx memorag-mcp              # start MCP server (default)
npx memorag-mcp ingest <file>  # parse and save a file
npx memorag-mcp parse <file>   # parse without saving (dry run)
npx memorag-mcp inspect         # show current memory
```

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `--memory-path` | `~/.memorag` | Where memory JSON files are stored |
| `confidenceThreshold` | `0.7` | Minimum confidence to save facts |

## Architecture

```
memorag-mcp
├── MCP Server          — automatic instructions via protocol
├── MemoAgent           — programmatic API
├── StaticParser        — zero-cost static analysis (6 languages)
├── MemoryStore         — JSON persistence on disk
├── ContextRetriever    — keyword scoring + relational expansion
└── PromptBuilder       — context formatting (utility)
```

## License

MIT