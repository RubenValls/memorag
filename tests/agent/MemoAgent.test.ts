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
