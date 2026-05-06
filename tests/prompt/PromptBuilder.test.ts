import { DefaultPromptBuilder } from '../../src/prompt/PromptBuilder.js'
import { RelevantContext, ModuleMemory } from '../../src/memory/types.js'

const emptyContext: RelevantContext = { globalEntries: [], modules: [], scoredModules: [] }

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
      scoredModules: [],
    }
    const prompt = builder.build('overview', ctx)
    expect(prompt).toContain('Monorepo with 3 services.')
    expect(prompt).toContain('architecture')
  })

  it('includes module name and responsibility', () => {
    const ctx: RelevantContext = {
      globalEntries: [],
      modules: [makeContextModule()],
      scoredModules: [],
    }
    const prompt = builder.build('auth', ctx)
    expect(prompt).toContain('AuthService')
    expect(prompt).toContain('Manages JWT tokens.')
  })

  it('includes exposes when non-empty', () => {
    const ctx: RelevantContext = {
      globalEntries: [],
      modules: [makeContextModule({ exposes: ['login()', 'verify()'] })],
      scoredModules: [],
    }
    const prompt = builder.build('auth', ctx)
    expect(prompt).toContain('login()')
    expect(prompt).toContain('verify()')
  })

  it('includes notes when present', () => {
    const ctx: RelevantContext = {
      globalEntries: [],
      modules: [makeContextModule({ notes: 'Throws even if signature valid.' })],
      scoredModules: [],
    }
    const prompt = builder.build('auth', ctx)
    expect(prompt).toContain('Throws even if signature valid.')
  })

  it('omits empty exposes and dependencies sections', () => {
    const ctx: RelevantContext = {
      globalEntries: [],
      modules: [makeContextModule({ exposes: [], dependencies: [] })],
      scoredModules: [],
    }
    const prompt = builder.build('auth', ctx)
    expect(prompt).not.toContain('Exposes:')
    expect(prompt).not.toContain('Depends on:')
  })
})

describe('DefaultPromptBuilder.formatContext()', () => {
  const builder = new DefaultPromptBuilder()

  it('returns empty string for empty context', () => {
    const result = builder.formatContext(emptyContext)
    expect(result).toBe('')
  })

  it('returns formatted modules and global entries without system prompt', () => {
    const ctx: RelevantContext = {
      globalEntries: [{
        id: '1',
        topic: 'architecture',
        content: 'Monorepo.',
        confidence: 0.9,
        source: 'ingest',
        createdAt: '',
      }],
      modules: [makeContextModule()],
      scoredModules: [],
    }
    const result = builder.formatContext(ctx)
    expect(result).toContain('Monorepo.')
    expect(result).toContain('AuthService')
    expect(result).not.toContain('You are a software assistant')
    expect(result).not.toContain('Question')
  })
})