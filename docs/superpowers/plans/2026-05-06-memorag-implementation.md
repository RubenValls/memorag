# MemoRag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Node.js/TypeScript library that manages LLM context via persistent module and global memory, with token-efficient retrieval and anti-hallucination guards.

**Architecture:** Four isolated layers (MemoryStore, ContextRetriever, PromptBuilder, LLMAdapter) orchestrated by MemoAgent. Each layer is a typed interface with one concrete implementation. Swapping LLM or retrieval strategy means replacing one implementation only.

**Tech Stack:** Node.js 20+, TypeScript 5, Jest + ts-jest, @anthropic-ai/sdk, crypto (built-in), fs/promises (built-in)

---

## File Map

| File | Responsibility |
|---|---|
| `src/memory/types.ts` | Shared data types (MemoryEntry, GlobalMemory, ModuleMemory, RelevantContext) |
| `src/memory/MemoryStore.ts` | MemoryStore interface + JsonMemoryStore (JSON on disk) |
| `src/retrieval/ContextRetriever.ts` | ContextRetriever interface + KeywordContextRetriever |
| `src/prompt/PromptBuilder.ts` | PromptBuilder interface + DefaultPromptBuilder |
| `src/adapters/LLMAdapter.ts` | LLMAdapter interface |
| `src/adapters/ClaudeAdapter.ts` | Anthropic SDK implementation |
| `src/agent/Logger.ts` | Internal logger, no external deps |
| `src/agent/MemoAgent.ts` | Orchestrator: ingest(), query(), getMemory() + MemoAgentConfig |
| `src/index.ts` | Public exports |
| `tests/memory/MemoryStore.test.ts` | MemoryStore unit tests |
| `tests/retrieval/ContextRetriever.test.ts` | Retriever unit tests |
| `tests/prompt/PromptBuilder.test.ts` | PromptBuilder unit tests |
| `tests/agent/MemoAgent.test.ts` | MemoAgent integration tests (mocked adapter) |

---

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `jest.config.ts`
- Create: `.gitignore`

- [ ] **Step 1: Initialize npm project**

```bash
cd /Users/rnvi/Desktop/memorag
npm init -y
```

- [ ] **Step 2: Install dependencies**

```bash
npm install @anthropic-ai/sdk
npm install --save-dev typescript ts-jest jest @types/jest @types/node
```

- [ ] **Step 3: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 4: Write jest.config.ts**

```typescript
import type { Config } from 'jest'

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts'],
}

export default config
```

- [ ] **Step 5: Update package.json scripts**

Replace the `scripts` block in `package.json` with:

```json
"scripts": {
  "build": "tsc",
  "test": "jest",
  "test:watch": "jest --watch",
  "test:coverage": "jest --coverage"
}
```

- [ ] **Step 6: Write .gitignore**

```
node_modules/
dist/
.env
coverage/
```

- [ ] **Step 7: Create directory structure**

```bash
mkdir -p src/memory src/retrieval src/prompt src/adapters src/agent
mkdir -p tests/memory tests/retrieval tests/prompt tests/agent
```

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json jest.config.ts .gitignore
git commit -m "chore: project scaffolding"
```

---

### Task 2: Core types

**Files:**
- Create: `src/memory/types.ts`

- [ ] **Step 1: Write types.ts**

```typescript
// src/memory/types.ts

export interface MemoryEntry {
  id: string
  topic: string
  content: string
  confidence: number
  source: 'ingest' | 'conversation'
  createdAt: string
}

export interface GlobalMemory {
  version: number
  updatedAt: string
  entries: MemoryEntry[]
}

export interface ModuleMemory {
  name: string
  responsibility: string
  exposes: string[]
  dependencies: string[]
  usedBy: string[]
  throws: string[]
  tags: string[]
  notes?: string
  patterns?: string[]
  sourcePath: string
  sourceHash: string
}

export interface RelevantContext {
  globalEntries: MemoryEntry[]
  modules: ModuleMemory[]
}
```

- [ ] **Step 2: Verify TypeScript is happy**

```bash
npx tsc --noEmit
```

Expected: no errors (only types, no implementation yet — may warn about empty project, that's fine)

- [ ] **Step 3: Commit**

```bash
git add src/memory/types.ts
git commit -m "feat: add core data types"
```

---

### Task 3: MemoryStore

**Files:**
- Create: `src/memory/MemoryStore.ts`
- Create: `tests/memory/MemoryStore.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/memory/MemoryStore.test.ts
import { mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { JsonMemoryStore } from '../../src/memory/MemoryStore'
import { MemoryEntry, ModuleMemory } from '../../src/memory/types'

const makeEntry = (overrides: Partial<MemoryEntry> = {}): MemoryEntry => ({
  id: 'test-id',
  topic: 'architecture',
  content: 'Monorepo with 3 services.',
  confidence: 0.9,
  source: 'ingest',
  createdAt: new Date().toISOString(),
  ...overrides,
})

const makeModule = (overrides: Partial<ModuleMemory> = {}): ModuleMemory => ({
  name: 'AuthService',
  responsibility: 'Manages JWT tokens.',
  exposes: ['login()', 'verify()'],
  dependencies: ['UserRepository'],
  usedBy: [],
  throws: ['UnauthorizedError'],
  tags: ['auth', 'jwt'],
  sourcePath: '/src/auth/AuthService.ts',
  sourceHash: 'abc123',
  ...overrides,
})

describe('JsonMemoryStore', () => {
  let store: JsonMemoryStore
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'memorag-test-'))
    store = new JsonMemoryStore(tmpDir)
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  describe('global memory', () => {
    it('returns empty global memory when file does not exist', async () => {
      const memory = await store.getGlobal()
      expect(memory.version).toBe(1)
      expect(memory.entries).toEqual([])
    })

    it('saves and retrieves a global entry', async () => {
      await store.saveGlobal(makeEntry())
      const memory = await store.getGlobal()
      expect(memory.entries).toHaveLength(1)
      expect(memory.entries[0].id).toBe('test-id')
    })

    it('updates existing entry with same id', async () => {
      await store.saveGlobal(makeEntry({ content: 'original' }))
      await store.saveGlobal(makeEntry({ content: 'updated' }))
      const memory = await store.getGlobal()
      expect(memory.entries).toHaveLength(1)
      expect(memory.entries[0].content).toBe('updated')
    })

    it('accumulates entries with different ids', async () => {
      await store.saveGlobal(makeEntry({ id: 'a' }))
      await store.saveGlobal(makeEntry({ id: 'b' }))
      const memory = await store.getGlobal()
      expect(memory.entries).toHaveLength(2)
    })
  })

  describe('module memory', () => {
    it('returns null for unknown module', async () => {
      expect(await store.getModule('Unknown')).toBeNull()
    })

    it('saves and retrieves a module', async () => {
      await store.saveModule('AuthService', makeModule())
      const result = await store.getModule('AuthService')
      expect(result?.name).toBe('AuthService')
      expect(result?.responsibility).toBe('Manages JWT tokens.')
    })

    it('overwrites existing module on save', async () => {
      await store.saveModule('AuthService', makeModule({ responsibility: 'old' }))
      await store.saveModule('AuthService', makeModule({ responsibility: 'new' }))
      const result = await store.getModule('AuthService')
      expect(result?.responsibility).toBe('new')
    })

    it('returns all saved modules', async () => {
      await store.saveModule('AuthService', makeModule({ name: 'AuthService' }))
      await store.saveModule('UserRepo', makeModule({ name: 'UserRepo' }))
      const all = await store.getAllModules()
      expect(all).toHaveLength(2)
      expect(all.map(m => m.name).sort()).toEqual(['AuthService', 'UserRepo'])
    })

    it('returns empty array when no modules exist', async () => {
      expect(await store.getAllModules()).toEqual([])
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest tests/memory/MemoryStore.test.ts
```

Expected: FAIL — `Cannot find module '../../src/memory/MemoryStore'`

- [ ] **Step 3: Implement MemoryStore**

```typescript
// src/memory/MemoryStore.ts
import { readFile, writeFile, mkdir, readdir } from 'fs/promises'
import { join, dirname } from 'path'
import { GlobalMemory, MemoryEntry, ModuleMemory } from './types'

export interface MemoryStore {
  saveGlobal(entry: MemoryEntry): Promise<void>
  saveModule(moduleName: string, data: ModuleMemory): Promise<void>
  getGlobal(): Promise<GlobalMemory>
  getModule(moduleName: string): Promise<ModuleMemory | null>
  getAllModules(): Promise<ModuleMemory[]>
}

export class JsonMemoryStore implements MemoryStore {
  private globalPath: string
  private modulesDir: string

  constructor(private basePath: string) {
    this.globalPath = join(basePath, 'global.json')
    this.modulesDir = join(basePath, 'modules')
  }

  async saveGlobal(entry: MemoryEntry): Promise<void> {
    const memory = await this.getGlobal()
    const idx = memory.entries.findIndex(e => e.id === entry.id)
    if (idx >= 0) {
      memory.entries[idx] = entry
    } else {
      memory.entries.push(entry)
    }
    memory.updatedAt = new Date().toISOString()
    await mkdir(dirname(this.globalPath), { recursive: true })
    await writeFile(this.globalPath, JSON.stringify(memory, null, 2))
  }

  async saveModule(moduleName: string, data: ModuleMemory): Promise<void> {
    await mkdir(this.modulesDir, { recursive: true })
    await writeFile(
      join(this.modulesDir, `${moduleName}.json`),
      JSON.stringify(data, null, 2)
    )
  }

  async getGlobal(): Promise<GlobalMemory> {
    try {
      return JSON.parse(await readFile(this.globalPath, 'utf-8'))
    } catch {
      return { version: 1, updatedAt: new Date().toISOString(), entries: [] }
    }
  }

  async getModule(moduleName: string): Promise<ModuleMemory | null> {
    try {
      return JSON.parse(
        await readFile(join(this.modulesDir, `${moduleName}.json`), 'utf-8')
      )
    } catch {
      return null
    }
  }

  async getAllModules(): Promise<ModuleMemory[]> {
    try {
      const files = await readdir(this.modulesDir)
      const results = await Promise.all(
        files
          .filter(f => f.endsWith('.json'))
          .map(f => this.getModule(f.slice(0, -5)))
      )
      return results.filter((m): m is ModuleMemory => m !== null)
    } catch {
      return []
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest tests/memory/MemoryStore.test.ts
```

Expected: PASS (all 9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/memory/MemoryStore.ts tests/memory/MemoryStore.test.ts
git commit -m "feat: add JsonMemoryStore with JSON persistence"
```

---

### Task 4: ContextRetriever

**Files:**
- Create: `src/retrieval/ContextRetriever.ts`
- Create: `tests/retrieval/ContextRetriever.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/retrieval/ContextRetriever.test.ts
import { mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { JsonMemoryStore } from '../../src/memory/MemoryStore'
import { KeywordContextRetriever } from '../../src/retrieval/ContextRetriever'
import { ModuleMemory } from '../../src/memory/types'

const authModule: ModuleMemory = {
  name: 'AuthService',
  responsibility: 'Manages JWT tokens and sessions.',
  exposes: ['login()', 'verify()'],
  dependencies: ['UserRepository'],
  usedBy: [],
  throws: ['UnauthorizedError'],
  tags: ['auth', 'jwt', 'session'],
  sourcePath: '/src/auth.ts',
  sourceHash: 'abc',
}

const userModule: ModuleMemory = {
  name: 'UserRepository',
  responsibility: 'Reads and writes user records to database.',
  exposes: ['findById()', 'save()'],
  dependencies: [],
  usedBy: [],
  throws: [],
  tags: ['user', 'database', 'repository'],
  sourcePath: '/src/user.ts',
  sourceHash: 'def',
}

describe('KeywordContextRetriever', () => {
  let store: JsonMemoryStore
  let retriever: KeywordContextRetriever
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'memorag-test-'))
    store = new JsonMemoryStore(tmpDir)
    retriever = new KeywordContextRetriever(store)
    await store.saveModule('AuthService', authModule)
    await store.saveModule('UserRepository', userModule)
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('matches module by tag', async () => {
    const ctx = await retriever.retrieve('how does jwt work?')
    expect(ctx.modules.map(m => m.name)).toContain('AuthService')
  })

  it('matches module by responsibility text', async () => {
    const ctx = await retriever.retrieve('session management')
    expect(ctx.modules.map(m => m.name)).toContain('AuthService')
  })

  it('matches module by name', async () => {
    const ctx = await retriever.retrieve('AuthService')
    expect(ctx.modules.map(m => m.name)).toContain('AuthService')
  })

  it('expands to dependencies of matched module — one level deep', async () => {
    const ctx = await retriever.retrieve('jwt authentication')
    const names = ctx.modules.map(m => m.name)
    expect(names).toContain('AuthService')
    expect(names).toContain('UserRepository')
  })

  it('returns empty when no match', async () => {
    const ctx = await retriever.retrieve('payment processing stripe')
    expect(ctx.modules).toHaveLength(0)
    expect(ctx.globalEntries).toHaveLength(0)
  })

  it('matches global entries by topic', async () => {
    await store.saveGlobal({
      id: '1',
      topic: 'architecture',
      content: 'Monorepo with 3 services.',
      confidence: 0.9,
      source: 'ingest',
      createdAt: new Date().toISOString(),
    })
    const ctx = await retriever.retrieve('architecture overview')
    expect(ctx.globalEntries).toHaveLength(1)
  })

  it('relational expansion does not go beyond one level', async () => {
    // UserRepository.dependencies is [] so nothing further added
    const ctx = await retriever.retrieve('jwt')
    const names = ctx.modules.map(m => m.name)
    expect(names).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest tests/retrieval/ContextRetriever.test.ts
```

Expected: FAIL — `Cannot find module '../../src/retrieval/ContextRetriever'`

- [ ] **Step 3: Implement ContextRetriever**

```typescript
// src/retrieval/ContextRetriever.ts
import { ModuleMemory, RelevantContext } from '../memory/types'
import { MemoryStore } from '../memory/MemoryStore'

export interface ContextRetriever {
  retrieve(query: string): Promise<RelevantContext>
}

export class KeywordContextRetriever implements ContextRetriever {
  constructor(private store: MemoryStore) {}

  async retrieve(query: string): Promise<RelevantContext> {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    const [global, allModules] = await Promise.all([
      this.store.getGlobal(),
      this.store.getAllModules(),
    ])

    const globalEntries = global.entries.filter(e =>
      terms.some(t =>
        e.topic.toLowerCase().includes(t) || e.content.toLowerCase().includes(t)
      )
    )

    const directMatches = allModules.filter(m => this.matches(m, terms))
    const expandedNames = new Set(directMatches.map(m => m.name))

    for (const m of directMatches) {
      for (const dep of m.dependencies) {
        expandedNames.add(dep)
      }
    }

    const modules = allModules.filter(m => expandedNames.has(m.name))

    return { globalEntries, modules }
  }

  private matches(module: ModuleMemory, terms: string[]): boolean {
    const text = [
      module.name,
      module.responsibility,
      module.notes ?? '',
      ...module.tags,
    ].join(' ').toLowerCase()
    return terms.some(t => text.includes(t))
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest tests/retrieval/ContextRetriever.test.ts
```

Expected: PASS (all 7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/retrieval/ContextRetriever.ts tests/retrieval/ContextRetriever.test.ts
git commit -m "feat: add KeywordContextRetriever with one-level relational expansion"
```

---

### Task 5: PromptBuilder

**Files:**
- Create: `src/prompt/PromptBuilder.ts`
- Create: `tests/prompt/PromptBuilder.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/prompt/PromptBuilder.test.ts
import { DefaultPromptBuilder } from '../../src/prompt/PromptBuilder'
import { RelevantContext, ModuleMemory } from '../../src/memory/types'

const emptyContext: RelevantContext = { globalEntries: [], modules: [] }

const makeContextModule = (overrides: Partial<ModuleMemory> = {}): ModuleMemory => ({
  name: 'AuthService',
  responsibility: 'Manages JWT tokens.',
  exposes: ['login()'],
  dependencies: [],
  usedBy: [],
  throws: [],
  tags: [],
  sourcePath: '/src/auth.ts',
  sourceHash: 'abc',
  ...overrides,
})

describe('DefaultPromptBuilder', () => {
  const builder = new DefaultPromptBuilder()

  it('includes the query in the output', () => {
    const prompt = builder.build('What does AuthService do?', emptyContext)
    expect(prompt).toContain('What does AuthService do?')
  })

  it('omits context sections when context is empty', () => {
    const prompt = builder.build('simple query', emptyContext)
    expect(prompt).not.toContain('Project context')
    expect(prompt).not.toContain('Relevant modules')
  })

  it('includes global entries when present', () => {
    const ctx: RelevantContext = {
      globalEntries: [{
        id: '1',
        topic: 'architecture',
        content: 'Monorepo with 3 services.',
        confidence: 0.9,
        source: 'ingest',
        createdAt: '',
      }],
      modules: [],
    }
    const prompt = builder.build('overview', ctx)
    expect(prompt).toContain('Monorepo with 3 services.')
    expect(prompt).toContain('architecture')
  })

  it('includes module name and responsibility', () => {
    const ctx: RelevantContext = { globalEntries: [], modules: [makeContextModule()] }
    const prompt = builder.build('auth', ctx)
    expect(prompt).toContain('AuthService')
    expect(prompt).toContain('Manages JWT tokens.')
  })

  it('includes exposes when non-empty', () => {
    const ctx: RelevantContext = {
      globalEntries: [],
      modules: [makeContextModule({ exposes: ['login()', 'verify()'] })],
    }
    const prompt = builder.build('auth', ctx)
    expect(prompt).toContain('login()')
    expect(prompt).toContain('verify()')
  })

  it('includes notes when present', () => {
    const ctx: RelevantContext = {
      globalEntries: [],
      modules: [makeContextModule({ notes: 'Throws even if signature valid.' })],
    }
    const prompt = builder.build('auth', ctx)
    expect(prompt).toContain('Throws even if signature valid.')
  })

  it('omits empty exposes and dependencies sections', () => {
    const ctx: RelevantContext = {
      globalEntries: [],
      modules: [makeContextModule({ exposes: [], dependencies: [] })],
    }
    const prompt = builder.build('auth', ctx)
    expect(prompt).not.toContain('Exposes:')
    expect(prompt).not.toContain('Depends on:')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest tests/prompt/PromptBuilder.test.ts
```

Expected: FAIL — `Cannot find module '../../src/prompt/PromptBuilder'`

- [ ] **Step 3: Implement PromptBuilder**

```typescript
// src/prompt/PromptBuilder.ts
import { RelevantContext } from '../memory/types'

export interface PromptBuilder {
  build(query: string, context: RelevantContext): string
}

export class DefaultPromptBuilder implements PromptBuilder {
  build(query: string, context: RelevantContext): string {
    const parts: string[] = [
      'You are a software assistant with knowledge of this codebase. Answer concisely.',
    ]

    if (context.globalEntries.length > 0) {
      parts.push('\n## Project context')
      for (const e of context.globalEntries) {
        parts.push(`- [${e.topic}] ${e.content}`)
      }
    }

    if (context.modules.length > 0) {
      parts.push('\n## Relevant modules')
      for (const m of context.modules) {
        const lines = [`### ${m.name}`, m.responsibility]
        if (m.exposes.length) lines.push(`Exposes: ${m.exposes.join(', ')}`)
        if (m.dependencies.length) lines.push(`Depends on: ${m.dependencies.join(', ')}`)
        if (m.throws.length) lines.push(`Throws: ${m.throws.join(', ')}`)
        if (m.notes) lines.push(`Note: ${m.notes}`)
        parts.push(lines.join('\n'))
      }
    }

    parts.push(`\n## Question\n${query}`)

    return parts.join('\n')
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest tests/prompt/PromptBuilder.test.ts
```

Expected: PASS (all 7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/prompt/PromptBuilder.ts tests/prompt/PromptBuilder.test.ts
git commit -m "feat: add DefaultPromptBuilder"
```

---

### Task 6: LLMAdapter + ClaudeAdapter

**Files:**
- Create: `src/adapters/LLMAdapter.ts`
- Create: `src/adapters/ClaudeAdapter.ts`

No unit tests — ClaudeAdapter wraps a third-party SDK. It will be mocked in MemoAgent tests. Verified manually / e2e only.

- [ ] **Step 1: Write LLMAdapter interface**

```typescript
// src/adapters/LLMAdapter.ts
export interface LLMAdapter {
  complete(prompt: string): Promise<string>
}
```

- [ ] **Step 2: Write ClaudeAdapter**

```typescript
// src/adapters/ClaudeAdapter.ts
import Anthropic from '@anthropic-ai/sdk'
import { LLMAdapter } from './LLMAdapter'

export class ClaudeAdapter implements LLMAdapter {
  private client: Anthropic
  private model: string

  constructor(apiKey: string, model = 'claude-sonnet-4-6') {
    this.client = new Anthropic({ apiKey })
    this.model = model
  }

  async complete(prompt: string): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    })
    const block = response.content[0]
    if (block.type !== 'text') {
      throw new Error(`Unexpected content block type: ${block.type}`)
    }
    return block.text
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/adapters/LLMAdapter.ts src/adapters/ClaudeAdapter.ts
git commit -m "feat: add LLMAdapter interface and ClaudeAdapter"
```

---

### Task 7: Logger

**Files:**
- Create: `src/agent/Logger.ts`

- [ ] **Step 1: Write Logger**

```typescript
// src/agent/Logger.ts
type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

const LEVELS: Record<LogLevel, number> = {
  debug: 0, info: 1, warn: 2, error: 3, silent: 4,
}

export class Logger {
  constructor(private level: LogLevel = 'silent') {}

  debug(msg: string): void { this.log('debug', msg) }
  info(msg: string): void { this.log('info', msg) }
  warn(msg: string): void { this.log('warn', msg) }
  error(msg: string): void { this.log('error', msg) }

  private log(level: Exclude<LogLevel, 'silent'>, msg: string): void {
    if (LEVELS[level] >= LEVELS[this.level]) {
      const method = level === 'debug' ? 'log' : level
      console[method](`[memorag:${level}] ${msg}`)
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/agent/Logger.ts
git commit -m "feat: add internal Logger"
```

---

### Task 8: MemoAgent — ingest()

**Files:**
- Create: `src/agent/MemoAgent.ts`
- Create: `tests/agent/MemoAgent.test.ts`

- [ ] **Step 1: Write failing ingest tests**

```typescript
// tests/agent/MemoAgent.test.ts
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { MemoAgent } from '../../src/agent/MemoAgent'
import { LLMAdapter } from '../../src/adapters/LLMAdapter'
import { ModuleMemory } from '../../src/memory/types'

class MockAdapter implements LLMAdapter {
  responses: string[] = []
  calls: string[] = []

  async complete(prompt: string): Promise<string> {
    this.calls.push(prompt)
    return this.responses.shift() ?? 'NO_NEW_FACTS'
  }
}

const makeModuleJson = (overrides: Partial<ModuleMemory> = {}): string =>
  JSON.stringify({
    name: 'AuthService',
    responsibility: 'Manages JWT tokens.',
    exposes: ['login()', 'verify()'],
    dependencies: ['UserRepository'],
    throws: ['UnauthorizedError'],
    tags: ['auth', 'jwt'],
    ...overrides,
  })

describe('MemoAgent.ingest()', () => {
  let tmpDir: string
  let srcFile: string
  let adapter: MockAdapter
  let agent: MemoAgent

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'memorag-test-'))
    srcFile = join(tmpDir, 'AuthService.ts')
    await writeFile(srcFile, 'export class AuthService {}')
    adapter = new MockAdapter()
    agent = new MemoAgent({ adapter, memoryPath: join(tmpDir, 'docs/memorag') })
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('calls LLM with filename and file content', async () => {
    adapter.responses = [makeModuleJson()]
    await agent.ingest(srcFile)
    expect(adapter.calls[0]).toContain('AuthService.ts')
    expect(adapter.calls[0]).toContain('export class AuthService {}')
  })

  it('saves extracted module to memory', async () => {
    adapter.responses = [makeModuleJson()]
    await agent.ingest(srcFile)
    const memory = await agent.getMemory()
    expect(memory.modules).toHaveLength(1)
    expect(memory.modules[0].name).toBe('AuthService')
  })

  it('skips ingest if file hash has not changed', async () => {
    adapter.responses = [makeModuleJson()]
    await agent.ingest(srcFile)
    adapter.calls = []
    await agent.ingest(srcFile)
    expect(adapter.calls).toHaveLength(0)
  })

  it('re-ingests if file content changed', async () => {
    adapter.responses = [makeModuleJson(), makeModuleJson({ responsibility: 'Updated.' })]
    await agent.ingest(srcFile)
    await writeFile(srcFile, 'export class AuthService { login() {} }')
    await agent.ingest(srcFile)
    expect(adapter.calls).toHaveLength(2)
  })

  it('discards LLM response if not valid JSON', async () => {
    adapter.responses = ['not json at all']
    await agent.ingest(srcFile)
    const memory = await agent.getMemory()
    expect(memory.modules).toHaveLength(0)
  })

  it('discards LLM response if required fields missing', async () => {
    adapter.responses = [JSON.stringify({ name: 'AuthService' })]
    await agent.ingest(srcFile)
    const memory = await agent.getMemory()
    expect(memory.modules).toHaveLength(0)
  })

  it('does not throw when file does not exist', async () => {
    await expect(agent.ingest('/nonexistent/file.ts')).resolves.not.toThrow()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest tests/agent/MemoAgent.test.ts --testNamePattern="ingest"
```

Expected: FAIL — `Cannot find module '../../src/agent/MemoAgent'`

- [ ] **Step 3: Implement MemoAgent with ingest()**

```typescript
// src/agent/MemoAgent.ts
import { createHash, randomUUID } from 'crypto'
import { readFile } from 'fs/promises'
import { basename, extname } from 'path'
import { LLMAdapter } from '../adapters/LLMAdapter'
import { JsonMemoryStore, MemoryStore } from '../memory/MemoryStore'
import { KeywordContextRetriever, ContextRetriever } from '../retrieval/ContextRetriever'
import { DefaultPromptBuilder, PromptBuilder } from '../prompt/PromptBuilder'
import { GlobalMemory, ModuleMemory } from '../memory/types'
import { Logger } from './Logger'

export interface MemoAgentConfig {
  adapter: LLMAdapter
  memoryPath?: string
  confidenceThreshold?: number
  logLevel?: 'debug' | 'info' | 'warn' | 'error' | 'silent'
}

const REQUIRED_MODULE_FIELDS = ['name', 'responsibility', 'exposes', 'dependencies', 'throws', 'tags'] as const

function isValidModuleResponse(obj: unknown): obj is Record<string, unknown> {
  if (typeof obj !== 'object' || obj === null) return false
  return REQUIRED_MODULE_FIELDS.every(f => f in (obj as Record<string, unknown>))
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

function ingestPrompt(filename: string, content: string): string {
  return `Analyze this TypeScript/JavaScript file and return ONLY valid JSON with this exact schema:
{
  "name": "module name from main export or filename",
  "responsibility": "1-2 sentences: what it does and what it exposes",
  "exposes": ["public functions, classes, or constants"],
  "dependencies": ["local imports only (starting with ./ or ../), no node_modules"],
  "throws": ["error class names thrown by this module"],
  "tags": ["2-5 lowercase keywords for search"],
  "notes": "non-obvious behavior only — omit this field if nothing surprising",
  "patterns": ["design patterns relevant to usage — omit if none"]
}

File: ${filename}
\`\`\`
${content}
\`\`\`
Return ONLY the JSON object. No explanation, no markdown fences.`
}

export class MemoAgent {
  private store: MemoryStore
  private retriever: ContextRetriever
  private promptBuilder: PromptBuilder
  private adapter: LLMAdapter
  private confidenceThreshold: number
  private logger: Logger

  constructor(config: MemoAgentConfig) {
    const memoryPath = config.memoryPath ?? './docs/memorag'
    this.store = new JsonMemoryStore(memoryPath)
    this.retriever = new KeywordContextRetriever(this.store)
    this.promptBuilder = new DefaultPromptBuilder()
    this.adapter = config.adapter
    this.confidenceThreshold = config.confidenceThreshold ?? 0.7
    this.logger = new Logger(config.logLevel ?? 'silent')
  }

  async ingest(sourcePath: string): Promise<void> {
    let content: string
    try {
      content = await readFile(sourcePath, 'utf-8')
    } catch {
      this.logger.warn(`ingest: cannot read file ${sourcePath}`)
      return
    }

    const hash = hashContent(content)
    const moduleName = basename(sourcePath, extname(sourcePath))
    const existing = await this.store.getModule(moduleName)

    if (existing?.sourceHash === hash) {
      this.logger.debug(`ingest: ${moduleName} unchanged, skipping`)
      return
    }

    let raw: string
    try {
      raw = await this.adapter.complete(ingestPrompt(basename(sourcePath), content))
    } catch {
      this.logger.error(`ingest: LLM call failed for ${basename(sourcePath)}`)
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      this.logger.warn(`ingest: LLM returned non-JSON for ${basename(sourcePath)}, discarding`)
      return
    }

    if (!isValidModuleResponse(parsed)) {
      this.logger.warn(`ingest: LLM response missing required fields for ${basename(sourcePath)}, discarding`)
      return
    }

    const p = parsed as Record<string, unknown>
    const module: ModuleMemory = {
      name: typeof p.name === 'string' ? p.name : moduleName,
      responsibility: typeof p.responsibility === 'string' ? p.responsibility : '',
      exposes: Array.isArray(p.exposes) ? p.exposes.map(String) : [],
      dependencies: Array.isArray(p.dependencies) ? p.dependencies.map(String) : [],
      usedBy: existing?.usedBy ?? [],
      throws: Array.isArray(p.throws) ? p.throws.map(String) : [],
      tags: Array.isArray(p.tags) ? p.tags.map(String) : [],
      notes: typeof p.notes === 'string' ? p.notes : undefined,
      patterns: Array.isArray(p.patterns) ? p.patterns.map(String) : undefined,
      sourcePath,
      sourceHash: hash,
    }

    await this.store.saveModule(module.name, module)
    this.logger.info(`ingest: saved ${module.name}`)

    for (const depName of module.dependencies) {
      const dep = await this.store.getModule(depName)
      if (dep && !dep.usedBy.includes(module.name)) {
        dep.usedBy.push(module.name)
        await this.store.saveModule(depName, dep)
      }
    }
  }

  async query(text: string): Promise<string> {
    throw new Error('Not implemented yet')
  }

  async getMemory(): Promise<{ global: GlobalMemory; modules: ModuleMemory[] }> {
    const [global, modules] = await Promise.all([
      this.store.getGlobal(),
      this.store.getAllModules(),
    ])
    return { global, modules }
  }
}
```

- [ ] **Step 4: Run ingest tests to verify they pass**

```bash
npx jest tests/agent/MemoAgent.test.ts --testNamePattern="ingest"
```

Expected: PASS (all 7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/agent/MemoAgent.ts tests/agent/MemoAgent.test.ts
git commit -m "feat: add MemoAgent with ingest() flow and hash-based deduplication"
```

---

### Task 9: MemoAgent — query()

**Files:**
- Modify: `src/agent/MemoAgent.ts`
- Modify: `tests/agent/MemoAgent.test.ts`

- [ ] **Step 1: Add failing query tests** (append to existing test file)

```typescript
// Append to tests/agent/MemoAgent.test.ts

describe('MemoAgent.query()', () => {
  let tmpDir: string
  let adapter: MockAdapter
  let agent: MemoAgent

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'memorag-test-'))
    adapter = new MockAdapter()
    agent = new MemoAgent({ adapter, memoryPath: join(tmpDir, 'docs/memorag') })
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('returns LLM response for a query', async () => {
    adapter.responses = ['JWT is a token format.', 'NO_NEW_FACTS']
    const result = await agent.query('What is JWT?')
    expect(result).toBe('JWT is a token format.')
  })

  it('sends two LLM calls: one for answer, one for extraction', async () => {
    adapter.responses = ['The answer.', 'NO_NEW_FACTS']
    await agent.query('any question?')
    expect(adapter.calls).toHaveLength(2)
  })

  it('re-ingests a changed module before answering', async () => {
    const srcFile = join(tmpDir, 'AuthService.ts')
    await writeFile(srcFile, 'export class AuthService {}')

    adapter.responses = [makeModuleJson()]
    await agent.ingest(srcFile)

    await writeFile(srcFile, 'export class AuthService { login() {} }')

    adapter.responses = [
      makeModuleJson({ responsibility: 'Updated.' }),
      'Updated answer.',
      'NO_NEW_FACTS',
    ]
    const result = await agent.query('auth login')
    expect(result).toBe('Updated answer.')
    const memory = await agent.getMemory()
    expect(memory.modules[0].responsibility).toBe('Updated.')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest tests/agent/MemoAgent.test.ts --testNamePattern="query"
```

Expected: FAIL — `Not implemented yet`

- [ ] **Step 3: Replace query() stub and add checkAndRefreshModules() in MemoAgent.ts**

Replace the `query` stub:

```typescript
async query(text: string): Promise<string> {
  await this.checkAndRefreshModules()

  const context = await this.retriever.retrieve(text)
  const prompt = this.promptBuilder.build(text, context)

  let response: string
  try {
    response = await this.adapter.complete(prompt)
  } catch (err) {
    throw new Error(`MemoAgent: LLM call failed — ${err}`)
  }

  await this.extractAndSaveFromConversation(text, response)

  return response
}

private async checkAndRefreshModules(): Promise<void> {
  const modules = await this.store.getAllModules()
  for (const module of modules) {
    if (!module.sourcePath) continue
    try {
      const content = await readFile(module.sourcePath, 'utf-8')
      const hash = hashContent(content)
      if (hash !== module.sourceHash) {
        this.logger.info(`query: ${module.name} changed, re-ingesting`)
        await this.ingest(module.sourcePath)
      }
    } catch {
      this.logger.warn(`query: cannot read ${module.sourcePath}, skipping hash check`)
    }
  }
}

private async extractAndSaveFromConversation(_query: string, _response: string): Promise<void> {
  // implemented in Task 10
}
```

- [ ] **Step 4: Run query tests to verify they pass**

```bash
npx jest tests/agent/MemoAgent.test.ts --testNamePattern="query"
```

Expected: PASS (all 3 tests)

- [ ] **Step 5: Run full suite**

```bash
npx jest
```

Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/agent/MemoAgent.ts tests/agent/MemoAgent.test.ts
git commit -m "feat: add query() with hash-check refresh and context injection"
```

---

### Task 10: MemoAgent — post-conversation extraction

**Files:**
- Modify: `src/agent/MemoAgent.ts`
- Modify: `tests/agent/MemoAgent.test.ts`

- [ ] **Step 1: Add failing extraction tests** (append to test file)

```typescript
// Append to tests/agent/MemoAgent.test.ts

describe('MemoAgent post-conversation extraction', () => {
  let tmpDir: string
  let adapter: MockAdapter
  let agent: MemoAgent

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'memorag-test-'))
    adapter = new MockAdapter()
    agent = new MemoAgent({ adapter, memoryPath: join(tmpDir, 'docs/memorag') })
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('saves new global fact from conversation', async () => {
    adapter.responses = [
      'The answer is Redis.',
      JSON.stringify({ fact: 'Uses Redis for caching.', module: 'global', confidence: 0.9 }),
    ]
    await agent.query('what caching do we use?')
    const memory = await agent.getMemory()
    expect(memory.global.entries.some(e => e.content.includes('Redis'))).toBe(true)
  })

  it('discards facts below confidence threshold', async () => {
    adapter.responses = [
      'Maybe Redis.',
      JSON.stringify({ fact: 'Uses Redis.', module: 'global', confidence: 0.5 }),
    ]
    await agent.query('caching?')
    const memory = await agent.getMemory()
    expect(memory.global.entries).toHaveLength(0)
  })

  it('does not save anything when NO_NEW_FACTS', async () => {
    adapter.responses = ['Standard answer.', 'NO_NEW_FACTS']
    await agent.query('hello?')
    const memory = await agent.getMemory()
    expect(memory.global.entries).toHaveLength(0)
  })

  it('does not throw when extraction response is not parseable', async () => {
    adapter.responses = ['Answer.', 'some garbage response']
    await expect(agent.query('hello?')).resolves.not.toThrow()
    const memory = await agent.getMemory()
    expect(memory.global.entries).toHaveLength(0)
  })

  it('uses configurable confidence threshold', async () => {
    const strictAgent = new MemoAgent({
      adapter,
      memoryPath: join(tmpDir, 'docs/memorag-strict'),
      confidenceThreshold: 0.95,
    })
    adapter.responses = [
      'Answer.',
      JSON.stringify({ fact: 'Uses Redis.', module: 'global', confidence: 0.9 }),
    ]
    await strictAgent.query('caching?')
    const memory = await strictAgent.getMemory()
    expect(memory.global.entries).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest tests/agent/MemoAgent.test.ts --testNamePattern="post-conversation"
```

Expected: FAIL — extraction stub does nothing, facts never saved

- [ ] **Step 3: Add helpers and implement extractAndSaveFromConversation() in MemoAgent.ts**

Add these after `ingestPrompt` function:

```typescript
function postConversationPrompt(query: string, response: string): string {
  return `From this conversation extract ONLY verifiable facts about the codebase.
If no concrete new facts exist, respond exactly: NO_NEW_FACTS
Otherwise respond with valid JSON only (single object, no explanation):
{ "fact": "the fact", "module": "ModuleName or global", "confidence": 0.0 }

User: ${query}
Assistant: ${response}`
}

interface ExtractedFact {
  fact: string
  module: string
  confidence: number
}

function isValidFact(obj: unknown): obj is ExtractedFact {
  if (typeof obj !== 'object' || obj === null) return false
  const o = obj as Record<string, unknown>
  return typeof o.fact === 'string' && typeof o.module === 'string' && typeof o.confidence === 'number'
}
```

Replace the `extractAndSaveFromConversation` stub:

```typescript
private async extractAndSaveFromConversation(query: string, response: string): Promise<void> {
  let raw: string
  try {
    raw = await this.adapter.complete(postConversationPrompt(query, response))
  } catch {
    this.logger.warn('post-extraction: LLM call failed, skipping')
    return
  }

  if (raw.trim() === 'NO_NEW_FACTS') return

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    this.logger.debug('post-extraction: response not JSON, discarding')
    return
  }

  if (!isValidFact(parsed)) {
    this.logger.debug('post-extraction: invalid fact shape, discarding')
    return
  }

  if (parsed.confidence < this.confidenceThreshold) {
    this.logger.debug(`post-extraction: confidence ${parsed.confidence} below threshold, discarding`)
    return
  }

  await this.store.saveGlobal({
    id: randomUUID(),
    topic: parsed.module === 'global' ? 'conversation' : parsed.module,
    content: parsed.fact,
    confidence: parsed.confidence,
    source: 'conversation',
    createdAt: new Date().toISOString(),
  })
  this.logger.info(`post-extraction: saved fact "${parsed.fact.slice(0, 60)}"`)
}
```

- [ ] **Step 4: Run extraction tests to verify they pass**

```bash
npx jest tests/agent/MemoAgent.test.ts --testNamePattern="post-conversation"
```

Expected: PASS (all 5 tests)

- [ ] **Step 5: Run full test suite**

```bash
npx jest
```

Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/agent/MemoAgent.ts tests/agent/MemoAgent.test.ts
git commit -m "feat: add anti-hallucination post-conversation extraction"
```

---

### Task 11: Public exports + build verification

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Write index.ts**

```typescript
// src/index.ts
export { MemoAgent } from './agent/MemoAgent'
export type { MemoAgentConfig } from './agent/MemoAgent'
export { ClaudeAdapter } from './adapters/ClaudeAdapter'
export type { LLMAdapter } from './adapters/LLMAdapter'
export { JsonMemoryStore } from './memory/MemoryStore'
export type { MemoryStore } from './memory/MemoryStore'
export { KeywordContextRetriever } from './retrieval/ContextRetriever'
export type { ContextRetriever } from './retrieval/ContextRetriever'
export { DefaultPromptBuilder } from './prompt/PromptBuilder'
export type { PromptBuilder } from './prompt/PromptBuilder'
export type {
  ModuleMemory,
  GlobalMemory,
  MemoryEntry,
  RelevantContext,
} from './memory/types'
```

- [ ] **Step 2: Run full test suite with coverage**

```bash
npx jest --coverage
```

Expected: all tests PASS

- [ ] **Step 3: Verify TypeScript build**

```bash
npx tsc
```

Expected: `dist/` created, no errors

- [ ] **Step 4: Commit**

```bash
git add src/index.ts dist/
git commit -m "feat: public exports and initial build"
```

---

## Usage Example

```typescript
import { MemoAgent, ClaudeAdapter } from './src'

const agent = new MemoAgent({
  adapter: new ClaudeAdapter(process.env.ANTHROPIC_API_KEY!),
  memoryPath: './docs/memorag',
  logLevel: 'info',
})

await agent.ingest('./src/auth/AuthService.ts')
await agent.ingest('./src/user/UserRepository.ts')

const answer = await agent.query('How does authentication work?')
console.log(answer)

const { global: globalMem, modules } = await agent.getMemory()
console.log(modules)
```
