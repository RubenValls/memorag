import { RelevantContext } from '../memory/types'

export interface PromptBuilder {
  build(query: string, context: RelevantContext): string
}

export class DefaultPromptBuilder implements PromptBuilder {
  build(query: string, context: RelevantContext): string {
    const parts: string[] = [
      'You are a software assistant with knowledge of this codebase. Answer concisely.',
    ]

    if (context.globalEntries.length > 0) {
      parts.push('\n## Project context')
      for (const e of context.globalEntries) {
        parts.push(`- [${e.topic}] ${e.content}`)
      }
    }

    if (context.modules.length > 0) {
      parts.push('\n## Relevant modules')
      for (const m of context.modules) {
        const lines = [`### ${m.name}`, m.responsibility]
        if (m.exposes.length) lines.push(`Exposes: ${m.exposes.join(', ')}`)
        if (m.dependencies.length) lines.push(`Depends on: ${m.dependencies.join(', ')}`)
        if (m.throws.length) lines.push(`Throws: ${m.throws.join(', ')}`)
        if (m.notes) lines.push(`Note: ${m.notes}`)
        parts.push(lines.join('\n'))
      }
    }

    parts.push(`\n## Question\n${query}`)

    return parts.join('\n')
  }
}
