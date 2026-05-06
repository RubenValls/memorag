// src/memory/types.ts

export interface MemoryEntry {
  id: string
  topic: string
  content: string
  confidence: number
  source: 'ingest' | 'conversation'
  createdAt: string
}

export interface GlobalMemory {
  version: number
  updatedAt: string
  entries: MemoryEntry[]
}

export interface ModuleMemory {
  name: string
  responsibility: string
  exposes: string[]
  dependencies: string[]
  usedBy: string[]
  throws: string[]
  tags: string[]
  notes?: string
  patterns?: string[]
  sourcePath: string
  sourceHash: string
}

export interface ScoredModule extends ModuleMemory {
  score: number
}

export interface RelevantContext {
  globalEntries: MemoryEntry[]
  modules: ModuleMemory[]
  scoredModules: ScoredModule[]
}
