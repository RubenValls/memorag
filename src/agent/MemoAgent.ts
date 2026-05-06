import { createHash } from 'crypto'
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

    // Update usedBy on dependency modules (one level)
    for (const depName of module.dependencies) {
      const dep = await this.store.getModule(depName)
      if (dep && !dep.usedBy.includes(module.name)) {
        dep.usedBy.push(module.name)
        await this.store.saveModule(depName, dep)
      }
    }
  }

  async query(_text: string): Promise<string> {
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
