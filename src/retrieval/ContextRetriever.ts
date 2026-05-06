import { ModuleMemory, RelevantContext } from '../memory/types'
import { MemoryStore } from '../memory/MemoryStore'

export interface ContextRetriever {
  retrieve(query: string): Promise<RelevantContext>
}

export class KeywordContextRetriever implements ContextRetriever {
  constructor(private store: MemoryStore) {}

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

    const directMatches = allModules.filter(m => this.matches(m, terms))
    const expandedNames = new Set(directMatches.map(m => m.name))

    // One level deep: include direct dependencies of matched modules
    for (const m of directMatches) {
      for (const dep of m.dependencies) {
        expandedNames.add(dep)
      }
    }

    const modules = allModules.filter(m => expandedNames.has(m.name))

    return { globalEntries, modules }
  }

  private matches(module: ModuleMemory, terms: string[]): boolean {
    const text = [
      module.name,
      module.responsibility,
      module.notes ?? '',
      ...module.tags,
    ].join(' ').toLowerCase()
    return terms.some(t => text.includes(t))
  }
}
