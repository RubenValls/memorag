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

  async getMemory(): Promise<{ global: GlobalMemory; modules: ModuleMemory[] }> {
    const [global, modules] = await Promise.all([
      this.store.getGlobal(),
      this.store.getAllModules(),
    ])
    return { global, modules }
  }
}
