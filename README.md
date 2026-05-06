# memorag

A Node.js/TypeScript library that acts as an intelligent context management layer between your code and any LLM. Instead of sending your entire codebase on every request, memorag learns your project incrementally and injects only the relevant context per query — saving tokens and improving response quality.

## Features

- **Persistent module memory** — analyzes source files and stores concise, structured summaries
- **Global project memory** — captures architecture, conventions, and cross-cutting facts
- **Automatic hash-based refresh** — re-ingests modules automatically when source files change
- **Anti-hallucination guards** — only persists verifiable facts with confidence scoring
- **Token-efficient retrieval** — keyword matching with one-level relational expansion
- **LLM-agnostic design** — ships with a Claude adapter, extensible to any model

## Installation

```bash
npm install memorag
```

Requires Node.js 18+ and an Anthropic API key for the default Claude adapter.

## Quick start

```typescript
import { MemoAgent, ClaudeAdapter } from 'memorag'

const agent = new MemoAgent({
  adapter: new ClaudeAdapter(process.env.ANTHROPIC_API_KEY!),
  memoryPath: './docs/memorag',   // where memory is persisted
  logLevel: 'info',
})

// Ingest your codebase — run once, or on CI after changes
await agent.ingest('./src/auth/AuthService.ts')
await agent.ingest('./src/user/UserRepository.ts')

// Query with automatic context injection
const answer = await agent.query('How does authentication work in this project?')
console.log(answer)

// Inspect what was learned
const { global: globalMem, modules } = await agent.getMemory()
console.log(modules)
```

## How it works

On each `ingest(filePath)` call, memorag:
1. Reads the source file and computes a hash
2. Skips if the file hasn't changed since last ingest
3. Sends the file to the LLM with a structured extraction prompt
4. Validates the response (required fields, JSON schema)
5. Persists a concise module summary to `docs/memorag/modules/{name}.json`

On each `query(text)` call, memorag:
1. Checks if any ingested source files have changed — re-ingests automatically if so
2. Retrieves relevant modules via keyword matching + relational expansion
3. Builds an optimized prompt with only the relevant context
4. Calls the LLM and returns the response
5. Extracts any new verifiable facts from the conversation and saves them

## Memory structure

Memory is stored as human-readable JSON under your project:

```
docs/memorag/
├── global.json          # architecture, conventions, cross-cutting facts
└── modules/
    ├── AuthService.json
    ├── UserRepository.json
    └── ...
```

Each module entry looks like:

```json
{
  "name": "AuthService",
  "responsibility": "Manages JWT tokens. Exposes login/logout/verify.",
  "exposes": ["login()", "logout()", "verify()"],
  "dependencies": ["UserRepository"],
  "usedBy": ["ApiGateway"],
  "throws": ["UnauthorizedError"],
  "tags": ["auth", "jwt", "session"],
  "notes": "verify() throws even if token signature is valid but expired.",
  "sourcePath": "src/auth/AuthService.ts",
  "sourceHash": "a3f9c2d1"
}
```

## API

### `new MemoAgent(config)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `adapter` | `LLMAdapter` | required | LLM adapter to use |
| `memoryPath` | `string` | `./docs/memorag` | Where to persist memory |
| `confidenceThreshold` | `number` | `0.7` | Minimum confidence to save post-conversation facts |
| `logLevel` | `'debug' \| 'info' \| 'warn' \| 'error' \| 'silent'` | `'silent'` | Log verbosity |

### `agent.ingest(sourcePath: string): Promise<void>`

Analyzes a source file and stores a structured summary. Skips if the file is unchanged since last ingest. Safe to call repeatedly.

### `agent.query(text: string): Promise<string>`

Retrieves relevant context, builds an optimized prompt, and returns the LLM response. Automatically re-ingests any changed source files before answering.

### `agent.getMemory(): Promise<{ global: GlobalMemory, modules: ModuleMemory[] }>`

Returns the full current memory state.

## Using a custom LLM adapter

Implement the `LLMAdapter` interface to support any model:

```typescript
import { LLMAdapter, MemoAgent } from 'memorag'

class OpenAIAdapter implements LLMAdapter {
  async complete(prompt: string): Promise<string> {
    const res = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
    })
    return res.choices[0].message.content ?? ''
  }
}

const agent = new MemoAgent({ adapter: new OpenAIAdapter() })
```

## Architecture

```
MemoAgent
├── MemoryStore        — persists/reads JSON from disk
├── ContextRetriever   — selects relevant memory fragments per query
├── PromptBuilder      — assembles optimized prompt with context
└── LLMAdapter         — calls the model (Claude, OpenAI, etc.)
```

Each layer is an interface — swap any implementation without touching the rest.

## License

MIT
