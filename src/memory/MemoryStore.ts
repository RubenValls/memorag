import { readFile, writeFile, mkdir, readdir, unlink } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { GlobalMemory, MemoryEntry, ModuleMemory } from './types.js'

export interface MemoryStore {
  saveGlobal(entry: MemoryEntry): Promise<void>
  saveModule(moduleName: string, data: ModuleMemory): Promise<void>
  getGlobal(): Promise<GlobalMemory>
  getModule(moduleName: string): Promise<ModuleMemory | null>
  getAllModules(): Promise<ModuleMemory[]>
  removeModule(moduleName: string): Promise<boolean>
}

export class JsonMemoryStore implements MemoryStore {
  private globalPath: string
  private modulesDir: string
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private basePath: string) {
    this.globalPath = join(basePath, 'global.json')
    this.modulesDir = join(basePath, 'modules')
  }

  private safeModuleName(name: string): string {
    if (!/^[\w\-. ]+$/.test(name)) {
      throw new Error(`Invalid module name: "${name}"`)
    }
    return name
  }

  async saveGlobal(entry: MemoryEntry): Promise<void> {
    this.writeQueue = this.writeQueue.then(() => this._saveGlobal(entry))
    return this.writeQueue
  }

  private async _saveGlobal(entry: MemoryEntry): Promise<void> {
    const memory = await this.getGlobal()
    const idx = memory.entries.findIndex(e => e.id === entry.id)
    if (idx >= 0) {
      memory.entries[idx] = entry
    } else {
      memory.entries.push(entry)
    }
    memory.updatedAt = new Date().toISOString()
    await mkdir(dirname(this.globalPath), { recursive: true })
    await writeFile(this.globalPath, JSON.stringify(memory, null, 2))
  }

  async saveModule(moduleName: string, data: ModuleMemory): Promise<void> {
    await mkdir(this.modulesDir, { recursive: true })
    await writeFile(
      join(this.modulesDir, `${this.safeModuleName(moduleName)}.json`),
      JSON.stringify(data, null, 2)
    )
  }

  async getGlobal(): Promise<GlobalMemory> {
    try {
      return JSON.parse(await readFile(this.globalPath, 'utf-8'))
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { version: 1, updatedAt: new Date().toISOString(), entries: [] }
      }
      throw err
    }
  }

  async getModule(moduleName: string): Promise<ModuleMemory | null> {
    try {
      return JSON.parse(
        await readFile(join(this.modulesDir, `${this.safeModuleName(moduleName)}.json`), 'utf-8')
      )
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      throw err
    }
  }

  async getAllModules(): Promise<ModuleMemory[]> {
    try {
      const files = await readdir(this.modulesDir)
      const results = await Promise.all(
        files
          .filter(f => f.endsWith('.json'))
          .map(f => this.getModule(f.slice(0, -5)))
      )
      return results.filter((m): m is ModuleMemory => m !== null)
    } catch {
      return []
    }
  }

  async removeModule(moduleName: string): Promise<boolean> {
    const filePath = join(this.modulesDir, `${this.safeModuleName(moduleName)}.json`)
    try {
      await unlink(filePath)
      return true
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return false
      }
      throw err
    }
  }
}
