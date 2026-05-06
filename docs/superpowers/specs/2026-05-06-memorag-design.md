# MemoRag — Design Spec

**Date:** 2026-05-06
**Status:** Approved

---

## Overview

MemoRag is a Node.js/TypeScript library that acts as an intelligent context management layer between a developer and an LLM. Its primary goals are token efficiency and coherence in long software project conversations.

The system persists knowledge generated during interactions, divides it into global and module-level memory, and automatically retrieves only the relevant fragments for each query. It is initially focused on Claude (Anthropic) but designed to support any LLM via an adapter interface.

---

## Architecture

### Layered with clear interfaces

Four isolated layers orchestrated by the `MemoAgent`:

1. **MemoryStore** — persists and reads JSON files. No LLM knowledge.
2. **ContextRetriever** — receives a query, returns relevant memory fragments (keyword-based MVP).
3. **PromptBuilder** — builds an optimized prompt with filtered context for the target model.
4. **LLMAdapter** — generic interface. Claude implementation first.

Changing LLM = new `LLMAdapter` implementation. Adding embeddings = new `ContextRetriever` implementation. No other layer changes.

### Directory structure

```
src/
├── agent/
│   └── MemoAgent.ts
├── memory/
│   ├── MemoryStore.ts
│   └── types.ts
├── retrieval/
│   └── ContextRetriever.ts
├── prompt/
│   └── PromptBuilder.ts
├── adapters/
│   ├── LLMAdapter.ts
│   └── ClaudeAdapter.ts
└── index.ts
```

### Memory storage

```
docs/memorag/
├── global.json
└── modules/
    ├── AuthService.json
    ├── PaymentWorker.json
    └── ...
```

Default path is `./docs/memorag`, configurable via `MemoAgentConfig.memoryPath`.

---

## Data Model

### `global.json`

```json
{
  "version": 1,
  "updatedAt": "ISO timestamp",
  "entries": [
    {
      "id": "uuid",
      "topic": "architecture",
      "content": "Monorepo with 3 services: auth, api, worker. Share types via @shared.",
      "confidence": 0.9,
      "source": "ingest | conversation",
      "createdAt": "ISO timestamp"
    }
  ]
}
```

### `modules/{name}.json`

```json
{
  "name": "AuthService",
  "responsibility": "Manages JWT. Exposes login/logout/verify.",
  "exposes": ["login()", "logout()", "verify()"],
  "dependencies": ["UserRepository", "RedisCache"],
  "usedBy": ["ApiGateway", "UserController"],
  "throws": ["UnauthorizedError"],
  "tags": ["auth", "jwt", "session", "token"],
  "notes": "verify() throws if token expired even if signature is valid.",
  "patterns": ["singleton"],
  "sourceHash": "a3f9c2..."
}
```

**Field rules:**
- `notes` — only if behavior is non-obvious or critical
- `patterns` — only if the pattern affects how the module is consumed
- Both fields are optional; omit if nothing relevant

**Principle:** module memory is a fixed flat object, not an unbounded array of facts. The extraction prompt is explicitly restrictive: 3-5 lines max, no implementation details, no obvious context.

---

## Public Interfaces

```ts
interface LLMAdapter {
  complete(prompt: string): Promise<string>
}

interface MemoryStore {
  saveGlobal(entry: MemoryEntry): Promise<void>
  saveModule(moduleName: string, data: ModuleMemory): Promise<void>
  getGlobal(): Promise<GlobalMemory>
  getModule(moduleName: string): Promise<ModuleMemory | null>
  getAllModules(): Promise<ModuleMemory[]>
}

interface ContextRetriever {
  retrieve(query: string): Promise<RelevantContext>
}

interface PromptBuilder {
  build(query: string, context: RelevantContext): string
}

class MemoAgent {
  constructor(config: MemoAgentConfig)
  ingest(sourcePath: string): Promise<void>
  query(text: string): Promise<string>
  getMemory(): Promise<{ global: GlobalMemory; modules: ModuleMemory[] }>
}

interface MemoAgentConfig {
  adapter: LLMAdapter
  memoryPath?: string           // default: './docs/memorag'
  confidenceThreshold?: number  // default: 0.7
  logLevel?: 'debug' | 'info' | 'warn' | 'error' | 'silent'
}
```

---

## Flows

### `ingest(sourcePath)`

1. Read source files (TS/JS)
2. Compute hash of file contents
3. Compare hash against stored `sourceHash` — skip if unchanged
4. Send file content to LLM with restrictive extraction prompt
5. Parse structured JSON response — discard if parse fails
6. Classify: global architecture info or module-specific
7. Persist to `global.json` or `modules/{name}.json` overwriting existing data

### `query(text)`

1. `ContextRetriever` matches query against `tags`, `responsibility`, `topic` fields (keyword MVP)
2. Relational expansion: for each matched module, include modules in its `usedBy` and `dependencies`
3. `PromptBuilder` builds prompt: system + filtered context + user query
4. `ClaudeAdapter.complete()` calls the model
5. Post-response: second extraction prompt to detect new verifiable facts
6. Apply anti-hallucination rules and persist if valid

---

## Anti-Hallucination Strategy

**Level 1 — Ingest (high confidence):**
LLM receives actual source code and must return a fixed JSON schema. If response does not parse or any required field is missing, the entry is discarded. `confidence: 1.0` by default.

**Level 2 — Post-conversation (variable confidence):**

Extraction prompt after each `query()`:
```
"From this conversation, extract ONLY verifiable facts about the code.
If there are no new concrete facts, respond: NO_NEW_FACTS.
Required format: { fact: string, module: string | 'global', confidence: number }"
```

Persistence rules:
- `NO_NEW_FACTS` → nothing persisted
- `confidence < 0.7` → discarded
- Fact already in memory → update only if new confidence is higher
- Fact about module not found in source → discarded

---

## Reactivity to Code Changes

Module memory tracks a `sourceHash` of the source file. Two mechanisms keep memory synchronized:

1. **Explicit re-ingest:** calling `agent.ingest(path)` on a known module overwrites its memory with the current code state.
2. **Automatic hash check:** before each `query()`, the agent checks if any tracked module file has changed. If changed, it re-ingests that module before responding.

Memory always reflects current code without requiring manual intervention.

---

## Retrieval Strategy (MVP)

Keyword matching against `tags`, `responsibility`, `topic`, and `content` fields. Deterministic, zero extra tokens.

Relational expansion: if module A matches, automatically include modules that A depends on or that depend on A (via `dependencies` and `usedBy`).

**Future (v2):** replace or augment with embedding-based semantic retrieval by swapping `ContextRetriever` implementation — no other layer changes.

---

## Testing

| Layer | Strategy |
|---|---|
| `MemoryStore` | Read/write JSON with temp paths |
| `ContextRetriever` | Keyword retrieval with known memory fixtures |
| `PromptBuilder` | String output assertions, no LLM |
| `ClaudeAdapter` | Mocked in unit tests, real in e2e |
| `MemoAgent` | Integration tests with mocked adapter |

---

## Error Handling

| Scenario | Behavior |
|---|---|
| `ingest()` fails on one file | Log + continue. Partial memory beats crash. |
| `query()` LLM error | Propagate to caller. No silent swallow. |
| Post-conversation response unparseable | Discard silently. No memory contamination. |
| Source file not found on hash check | Warning log. Skip re-ingest. |
| LLM unavailable | Clear error with actionable message. |

---

## Logging

Internal logger, no external dependency. Levels: `debug | info | warn | error | silent`. Silent by default. Configurable via `MemoAgentConfig.logLevel`.

---

## Out of Scope (MVP)

- Embedding-based retrieval
- Multi-language support beyond TS/JS
- HTTP/MCP server interface
- Memory versioning / history
- UI or CLI tool
