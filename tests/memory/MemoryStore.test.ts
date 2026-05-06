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
