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
