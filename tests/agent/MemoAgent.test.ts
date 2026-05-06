import { mkdtemp, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { MemoAgent } from '../../src/agent/MemoAgent'
import { ModuleMemory } from '../../src/memory/types'

const makeModule = (overrides: Partial<ModuleMemory> = {}): ModuleMemory => ({
  name: 'AuthService',
  responsibility: 'Manages JWT tokens.',
  exposes: ['login()', 'verify()'],
  dependencies: ['UserRepository'],
  usedBy: [],
  throws: ['UnauthorizedError'],
  tags: ['auth', 'jwt'],
  sourcePath: '',
  sourceHash: '',
  ...overrides,
})

describe('MemoAgent.saveModule()', () => {
  let tmpDir: string
  let agent: MemoAgent

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'memorag-test-'))
    agent = new MemoAgent({ memoryPath: join(tmpDir, 'docs/memorag') })
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('saves a module to memory', async () => {
    await agent.saveModule(makeModule())
    const memory = await agent.getMemory()
    expect(memory.modules).toHaveLength(1)
    expect(memory.modules[0].name).toBe('AuthService')
  })

  it('preserves usedBy when not provided', async () => {
    await agent.saveModule({ ...makeModule(), usedBy: ['ApiGateway'] })
    const memory = await agent.getMemory()
    expect(memory.modules[0].usedBy).toEqual(['ApiGateway'])
  })

  it('overwrites existing module with same name', async () => {
    await agent.saveModule(makeModule())
    await agent.saveModule(makeModule({ responsibility: 'Updated.' }))
    const memory = await agent.getMemory()
    expect(memory.modules).toHaveLength(1)
    expect(memory.modules[0].responsibility).toBe('Updated.')
  })
})

describe('MemoAgent.ingest()', () => {
  let tmpDir: string
  let agent: MemoAgent

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'memorag-test-'))
    agent = new MemoAgent({ memoryPath: join(tmpDir, 'docs/memorag') })
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('does not throw when file does not exist', async () => {
    await expect(agent.ingest('/nonexistent/file.ts')).resolves.not.toThrow()
  })

  it('parses and saves a TypeScript file', async () => {
    const srcFile = join(tmpDir, 'AuthService.ts')
    await writeFile(srcFile, `
import { UserRepository } from './UserRepository'

export class AuthService {
  async login(email: string, password: string) {
    throw new UnauthorizedError('bad')
  }
}
`)
    await agent.ingest(srcFile)
    const memory = await agent.getMemory()
    expect(memory.modules).toHaveLength(1)
    expect(memory.modules[0].name).toBe('AuthService')
    expect(memory.modules[0].exposes).toContain('AuthService')
    expect(memory.modules[0].dependencies).toContain('UserRepository')
    expect(memory.modules[0].throws).toContain('UnauthorizedError')
  })

  it('skips ingest if file hash unchanged', async () => {
    const srcFile = join(tmpDir, 'AuthService.ts')
    await writeFile(srcFile, 'export class AuthService {}')

    await agent.ingest(srcFile)
    const firstMemory = await agent.getMemory()

    await agent.ingest(srcFile)
    const secondMemory = await agent.getMemory()

    expect(firstMemory.modules[0].sourceHash).toBe(secondMemory.modules[0].sourceHash)
  })

  it('re-ingests when file content changes', async () => {
    const srcFile = join(tmpDir, 'AuthService.ts')
    await writeFile(srcFile, 'export class AuthService {}')
    await agent.ingest(srcFile)

    await writeFile(srcFile, 'export class AuthService { login() {} }')
    await agent.ingest(srcFile)

    const memory = await agent.getMemory()
    expect(memory.modules).toHaveLength(1)
  })

  it('returns null for unsupported file types and logs warning', async () => {
    const srcFile = join(tmpDir, 'data.csv')
    await writeFile(srcFile, 'a,b,c')
    await agent.ingest(srcFile)

    const memory = await agent.getMemory()
    expect(memory.modules).toHaveLength(0)
  })

  it('updates usedBy on dependency modules', async () => {
    const depFile = join(tmpDir, 'UserRepository.ts')
    await writeFile(depFile, 'export class UserRepository {}')
    await agent.ingest(depFile)

    const srcFile = join(tmpDir, 'AuthService.ts')
    await writeFile(srcFile, `
import { UserRepository } from './UserRepository'
export class AuthService {}
`)
    await agent.ingest(srcFile)

    const memory = await agent.getMemory()
    const userRepo = memory.modules.find(m => m.name === 'UserRepository')
    expect(userRepo?.usedBy).toContain('AuthService')
  })
})

describe('MemoAgent.saveFact()', () => {
  let tmpDir: string
  let agent: MemoAgent

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'memorag-test-'))
    agent = new MemoAgent({ memoryPath: join(tmpDir, 'docs/memorag') })
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('saves a fact above confidence threshold', async () => {
    await agent.saveFact('Uses Redis for caching.', 'global', 0.9)
    const memory = await agent.getMemory()
    expect(memory.global.entries.some(e => e.content.includes('Redis'))).toBe(true)
  })

  it('discards facts below confidence threshold', async () => {
    await agent.saveFact('Uses Redis.', 'global', 0.5)
    const memory = await agent.getMemory()
    expect(memory.global.entries).toHaveLength(0)
  })

  it('uses configurable confidence threshold', async () => {
    const strictAgent = new MemoAgent({
      memoryPath: join(tmpDir, 'docs/memorag-strict'),
      confidenceThreshold: 0.95,
    })
    await strictAgent.saveFact('Uses Redis.', 'global', 0.9)
    const memory = await strictAgent.getMemory()
    expect(memory.global.entries).toHaveLength(0)
  })
})

describe('MemoAgent.retrieve()', () => {
  let tmpDir: string
  let agent: MemoAgent

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'memorag-test-'))
    agent = new MemoAgent({ memoryPath: join(tmpDir, 'docs/memorag') })
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('returns relevant modules based on keyword match', async () => {
    await agent.saveModule(makeModule())
    const result = await agent.retrieve('auth login')
    expect(result.modules.length).toBeGreaterThanOrEqual(1)
    expect(result.modules[0].name).toBe('AuthService')
  })

  it('includes global entries in result', async () => {
    await agent.saveFact('Uses Redis for caching.', 'global', 0.9)
    const result = await agent.retrieve('Redis')
    expect(result.global.entries.some(e => e.content.includes('Redis'))).toBe(true)
  })
})

describe('MemoAgent.getModule()', () => {
  let tmpDir: string
  let agent: MemoAgent

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'memorag-test-'))
    agent = new MemoAgent({ memoryPath: join(tmpDir, 'docs/memorag') })
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('returns a saved module by name', async () => {
    await agent.saveModule(makeModule())
    const mod = await agent.getModule('AuthService')
    expect(mod).not.toBeNull()
    expect(mod!.name).toBe('AuthService')
  })

  it('returns null for unknown module', async () => {
    const mod = await agent.getModule('DoesNotExist')
    expect(mod).toBeNull()
  })
})

describe('MemoAgent.listModules()', () => {
  let tmpDir: string
  let agent: MemoAgent

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'memorag-test-'))
    agent = new MemoAgent({ memoryPath: join(tmpDir, 'docs/memorag') })
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('returns empty list when no modules saved', async () => {
    const names = await agent.listModules()
    expect(names).toEqual([])
  })

  it('returns names of saved modules', async () => {
    await agent.saveModule(makeModule({ name: 'AuthService' }))
    await agent.saveModule(makeModule({ name: 'UserRepo', dependencies: [] }))
    const names = await agent.listModules()
    expect(names.sort()).toEqual(['AuthService', 'UserRepo'])
  })
})

describe('MemoAgent.removeModule()', () => {
  let tmpDir: string
  let agent: MemoAgent

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'memorag-test-'))
    agent = new MemoAgent({ memoryPath: join(tmpDir, 'docs/memorag') })
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('removes an existing module', async () => {
    await agent.saveModule(makeModule())
    const removed = await agent.removeModule('AuthService')
    expect(removed).toBe(true)
    const memory = await agent.getMemory()
    expect(memory.modules).toHaveLength(0)
  })

  it('returns false for non-existent module', async () => {
    const removed = await agent.removeModule('DoesNotExist')
    expect(removed).toBe(false)
  })
})