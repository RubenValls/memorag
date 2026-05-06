import { basename, extname } from 'node:path'
import { createHash } from 'node:crypto'
import { languages, LanguageConfig } from './languages.js'

export interface ParsedModule {
  name: string
  responsibility: string
  exposes: string[]
  dependencies: string[]
  classes: string[]
  throws: string[]
  tags: string[]
  notes?: string
  patterns?: string[]
  sourcePath: string
  sourceHash: string
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

function pathToModuleName(importPath: string): string {
  const segments = importPath.replace(/\\/g, '/').split('/')
  const last = segments[segments.length - 1] || segments[segments.length - 2]
  return last.replace(/\.\w+$/, '') || last
}

function extractAll(content: string, patterns: RegExp[]): string[] {
  const results: string[] = []
  for (const pattern of patterns) {
    const regex = new RegExp(pattern.source, 'g')
    let match: RegExpExecArray | null
    while ((match = regex.exec(content)) !== null) {
      if (match[1]) {
        results.push(match[1].trim())
      }
    }
  }
  return results
}

function extractExportList(content: string, pattern: RegExp): string[] {
  const results: string[] = []
  const regex = new RegExp(pattern.source, 'g')
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    if (match[1]) {
      const names = match[1].split(',').map(s => {
        const trimmed = s.trim()
        const asMatch = trimmed.match(/^(\w+)\s+as\s+\w+/)
        return asMatch ? asMatch[1] : trimmed
      }).filter(s => s.length > 0 && /^\w+$/.test(s))
      results.push(...names)
    }
  }
  return results
}

function splitCamelCase(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

function generateTags(moduleName: string, classes: string[], functions: string[]): string[] {
  const words = new Set<string>()
  for (const word of splitCamelCase(moduleName)) {
    words.add(word.toLowerCase())
  }
  for (const cls of classes) {
    for (const word of splitCamelCase(cls)) {
      words.add(word.toLowerCase())
    }
  }
  for (const fn of functions.slice(0, 5)) {
    for (const word of splitCamelCase(fn)) {
      words.add(word.toLowerCase())
    }
  }
  if (words.size > 8) {
    return [...words].slice(0, 8)
  }
  return [...words]
}

function generateResponsibility(
  moduleName: string,
  classes: string[],
  functions: string[],
  exports: string[],
): string {
  const parts: string[] = []
  if (classes.length > 0) {
    parts.push(`Defines ${classes.join(', ')}`)
  }
  const publicApi = exports.filter(e => !classes.includes(e))
  if (publicApi.length > 0) {
    const listed = publicApi.length <= 5 ? publicApi.join(', ') : publicApi.slice(0, 5).join(', ') + '...'
    parts.push(`exposes: ${listed}`)
  }
  if (parts.length === 0) {
    return `Module ${moduleName}`
  }
  return parts.join('. ')
}

function detectLanguage(filePath: string): LanguageConfig | null {
  const ext = extname(filePath).toLowerCase()
  return languages.find(l => l.extensions.includes(ext)) ?? null
}

export class StaticParser {
  static parse(filePath: string, content: string): ParsedModule | null {
    const config = detectLanguage(filePath)
    if (!config) return null

    const moduleName = basename(filePath, extname(filePath))
    const sourceHash = hashContent(content)

    const rawImports = extractAll(content, config.localImports)
    const dependencies = [...new Set(rawImports.map(p => pathToModuleName(p)))]

    let exports = extractAll(content, config.exports)
    const exportListNames = config.exportList
      ? extractExportList(content, config.exportList)
      : []
    exports = [...new Set([...exports, ...exportListNames])]

    const classes = [...new Set(extractAll(content, config.classes))]
    const functions = [...new Set(extractAll(content, config.functions))]
      .filter(fn => !classes.includes(fn))

    const throws = [...new Set(extractAll(content, config.throws))]

    const allExposes = [...new Set([...classes, ...functions, ...exports])]
    const tags = generateTags(moduleName, classes, functions)
    const responsibility = generateResponsibility(moduleName, classes, functions, allExposes)

    return {
      name: moduleName,
      responsibility,
      exposes: allExposes,
      dependencies,
      classes,
      throws,
      tags,
      sourcePath: filePath,
      sourceHash,
    }
  }
}