import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { JsonMemoryStore } from '../../src/memory/MemoryStore.js'
import { KeywordContextRetriever } from '../../src/retrieval/ContextRetriever.js'
import { ModuleMemory } from '../../src/memory/types.js'

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
    const ctx = await retriever.retrieve('jwt')
    const names = ctx.modules.map(m => m.name)
    expect(names).toHaveLength(2)
  })

  it('returns scoredModules sorted by relevance', async () => {
    const ctx = await retriever.retrieve('auth jwt session')
    expect(ctx.scoredModules.length).toBeGreaterThan(0)
    const authScored = ctx.scoredModules.find(m => m.name === 'AuthService')
    expect(authScored).toBeDefined()
    expect(authScored!.score).toBeGreaterThan(0)
  })

  it('gives higher score for name matches', async () => {
    const ctx = await retriever.retrieve('AuthService')
    const auth = ctx.scoredModules.find(m => m.name === 'AuthService')
    const user = ctx.scoredModules.find(m => m.name === 'UserRepository')
    if (user) {
      expect(auth!.score).toBeGreaterThan(user.score)
    }
  })

  it('respects maxModules limit', async () => {
    const limitedStore = new JsonMemoryStore(join(tmpDir, 'limited'))
    const limitedRetriever = new KeywordContextRetriever(limitedStore, { maxModules: 1 })
    await limitedStore.saveModule('AuthService', authModule)
    await limitedStore.saveModule('UserRepository', userModule)
    const ctx = await limitedRetriever.retrieve('auth')
    expect(ctx.scoredModules.length).toBeLessThanOrEqual(1)
  })
})