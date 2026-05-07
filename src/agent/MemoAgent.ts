import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { JsonMemoryStore, MemoryStore } from '../memory/MemoryStore.js'
import { KeywordContextRetriever, ContextRetriever } from '../retrieval/ContextRetriever.js'
import { GlobalMemory, ModuleMemory } from '../memory/types.js'
import { Logger } from './Logger.js'
import { StaticParser } from '../static/StaticParser.js'

export interface MemoAgentConfig {
  memoryPath?: string
  confidenceThreshold?: number
  logLevel?: 'debug' | 'info' | 'warn' | 'error' | 'silent'
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

export class MemoAgent {
  private store: MemoryStore
  private retriever: ContextRetriever
  private confidenceThreshold: number
  private logger: Logger

  constructor(config: MemoAgentConfig = {}) {
    const memoryPath = config.memoryPath ?? './docs/memorag'
    this.store = new JsonMemoryStore(memoryPath)
    this.retriever = new KeywordContextRetriever(this.store)
    this.confidenceThreshold = config.confidenceThreshold ?? 0.7
    this.logger = new Logger(config.logLevel ?? 'silent')
  }

  async saveModule(module: Omit<ModuleMemory, 'usedBy'> & { usedBy?: string[] }): Promise<void> {
    const existing = await this.store.getModule(module.name)
    const fullModule: ModuleMemory = {
      ...module,
      usedBy: module.usedBy ?? existing?.usedBy ?? [],
    }
    await this.store.saveModule(module.name, fullModule)
    this.logger.info(`saveModule: saved ${module.name}`)
  }

  async ingest(sourcePath: string): Promise<'ok' | 'unchanged' | 'unsupported' | 'unreadable'> {
    let content: string
    try {
      content = await readFile(sourcePath, 'utf-8')
    } catch {
      this.logger.warn(`ingest: cannot read file ${sourcePath}`)
      return 'unreadable'
    }

    const hash = hashContent(content)
    const moduleName = basename(sourcePath, extname(sourcePath))
    const existing = await this.store.getModule(moduleName)

    if (existing?.sourceHash === hash) {
      this.logger.debug(`ingest: ${moduleName} unchanged, skipping`)
      return 'unchanged'
    }

    const parsed = StaticParser.parse(sourcePath, content)
    if (!parsed) {
      this.logger.warn(`ingest: unsupported file type for ${sourcePath}`)
      return 'unsupported'
    }

    const module: ModuleMemory = {
      ...parsed,
      usedBy: existing?.usedBy ?? [],
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

    return 'ok'
  }

  async retrieve(text: string): Promise<{ global: GlobalMemory; modules: ModuleMemory[] }> {
    await this.checkAndRefreshModules()
    const context = await this.retriever.retrieve(text)
    const global = await this.store.getGlobal()
    return { global, modules: context.modules }
  }

  async saveFact(fact: string, module: string, confidence: number): Promise<void> {
    if (confidence < this.confidenceThreshold) {
      this.logger.debug(`saveFact: confidence ${confidence} below threshold, discarding`)
      return
    }
    await this.store.saveGlobal({
      id: createHash('sha256').update(fact + module).digest('hex').slice(0, 16),
      topic: module === 'global' ? 'conversation' : module,
      content: fact,
      confidence,
      source: 'conversation',
      createdAt: new Date().toISOString(),
    })
    this.logger.info(`saveFact: saved "${fact.slice(0, 60)}"`)
  }

  async getMemory(): Promise<{ global: GlobalMemory; modules: ModuleMemory[] }> {
    const [global, modules] = await Promise.all([
      this.store.getGlobal(),
      this.store.getAllModules(),
    ])
    return { global, modules }
  }

  async getModule(name: string): Promise<ModuleMemory | null> {
    return this.store.getModule(name)
  }

  async listModules(): Promise<string[]> {
    const modules = await this.store.getAllModules()
    return modules.map(m => m.name)
  }

  async removeModule(name: string): Promise<boolean> {
    const removed = await this.store.removeModule(name)
    if (removed) {
      this.logger.info(`removeModule: removed ${name}`)
    } else {
      this.logger.warn(`removeModule: ${name} not found`)
    }
    return removed
  }

  private async checkAndRefreshModules(): Promise<void> {
    const modules = await this.store.getAllModules()
    for (const module of modules) {
      if (!module.sourcePath) continue
      try {
        const content = await readFile(module.sourcePath, 'utf-8')
        const hash = hashContent(content)
        if (hash !== module.sourceHash) {
          this.logger.info(`retrieve: ${module.name} changed, re-ingesting`)
          await this.ingest(module.sourcePath)
        }
      } catch {
        this.logger.warn(`retrieve: cannot read ${module.sourcePath}, skipping hash check`)
      }
    }
  }
}