import { ModuleMemory, RelevantContext, ScoredModule } from '../memory/types.js'
import { MemoryStore } from '../memory/MemoryStore.js'

export interface ContextRetriever {
  retrieve(query: string): Promise<RelevantContext>
}

export interface ContextRetrieverConfig {
  maxModules?: number
}

export class KeywordContextRetriever implements ContextRetriever {
  private maxModules: number

  constructor(private store: MemoryStore, config?: ContextRetrieverConfig) {
    this.maxModules = config?.maxModules ?? 10
  }

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

    const scored: ScoredModule[] = allModules
      .map(m => ({ ...m, score: this.scoreModule(m, terms) }))
      .filter(m => m.score > 0)
      .sort((a, b) => b.score - a.score)

    const directMatchNames = new Set(scored.map(m => m.name))

    for (const m of scored) {
      for (const dep of m.dependencies) {
        directMatchNames.add(dep)
      }
    }

    const expandedModules = allModules.filter(m => directMatchNames.has(m.name))
    const limitedScored = scored.slice(0, this.maxModules)

    return { globalEntries, modules: expandedModules, scoredModules: limitedScored }
  }

  private scoreModule(module: ModuleMemory, terms: string[]): number {
    const fields: string[] = [
      module.name,
      module.responsibility,
      module.notes ?? '',
      ...module.tags,
      ...module.exposes,
    ]
    const text = fields.join(' ').toLowerCase()
    let score = 0
    for (const term of terms) {
      const idx = text.indexOf(term)
      if (idx >= 0) {
        score += 1
        if (module.name.toLowerCase().includes(term)) score += 2
        if (module.tags.some(t => t.toLowerCase() === term)) score += 1
      }
    }
    return score
  }
}