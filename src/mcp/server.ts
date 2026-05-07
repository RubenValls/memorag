import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { createRequire } from 'node:module'
import { basename, extname } from 'node:path'
import { MemoAgent } from '../agent/MemoAgent.js'

const require = createRequire(import.meta.url)
const { version: PKG_VERSION } = require('../../package.json') as { version: string }

export interface McpServerConfig {
  memoryPath?: string
  confidenceThreshold?: number
  logLevel?: 'debug' | 'info' | 'warn' | 'error' | 'silent'
}

const INSTRUCTIONS = `memorag is a persistent memory system for this codebase. These are mandatory rules, not suggestions. Do not skip them even for small or simple tasks.

## MANDATORY: Before answering any code question

ALWAYS call \`retrieve_context\` first with the user's topic — no exceptions, regardless of how simple the task seems. Memory may contain facts that change your answer. Skipping this means operating blind on a codebase you may not fully know.

## MANDATORY: After reading or modifying any source file

ALWAYS call \`ingest_file\` with the absolute path immediately after touching a file. This keeps memory current. If you modify a file and do not ingest it, the next conversation will have stale context.

These two rules apply even if:
- The task feels small or surgical
- You think you already know the answer
- The file was just briefly referenced

## After learning new facts about the codebase

Call \`save_fact\` with the fact, the related module name (or "global"), and confidence (0–1). Only save verified observations — confidence below 0.7 is discarded.

## Other tools

- \`register_module\` — manually correct or enrich what the static parser extracted
- \`get_memory\` — inspect full memory state
- \`remove_module\` — remove a deleted or renamed module

## Notes

- Use the module name (e.g., "AuthService") not the file path for the \`module\` parameter in \`save_fact\`
- \`ingest_file\` requires an absolute path`

export function createMcpServer(config: McpServerConfig = {}): McpServer {
  const agent = new MemoAgent({
    memoryPath: config.memoryPath,
    confidenceThreshold: config.confidenceThreshold,
    logLevel: config.logLevel,
  })

  const server = new McpServer(
    { name: 'memorag', version: PKG_VERSION },
    { instructions: INSTRUCTIONS },
  )

  server.tool(
    'ingest_file',
    'Analyze a source file and store a structured summary in memory. Automatically detects the programming language and extracts exports, dependencies, classes, functions, and thrown errors.',
    {
      path: z.string().describe('Absolute path to the source file to analyze'),
    },
    async ({ path }) => {
      try {
        const result = await agent.ingest(path)
        if (result === 'unreadable') {
          return { content: [{ type: 'text' as const, text: `Cannot read file: ${path}` }], isError: true }
        }
        if (result === 'unsupported') {
          return { content: [{ type: 'text' as const, text: `Unsupported file type: ${extname(path) || '(no extension)'}. Supported: .ts .tsx .js .jsx .mjs .cjs .py .go .rs .java .rb` }], isError: true }
        }
        if (result === 'unchanged') {
          return { content: [{ type: 'text' as const, text: `File unchanged, memory already up to date: ${path}` }] }
        }
        const mod = await agent.getModule(basename(path, extname(path)))
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(mod, null, 2),
          }],
        }
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error ingesting file: ${err}` }], isError: true }
      }
    },
  )

  server.tool(
    'retrieve_context',
    'Retrieve relevant context from memory for a given query. Returns matching modules and global facts based on keyword matching.',
    {
      query: z.string().describe('The query to find relevant context for'),
    },
    async ({ query }) => {
      try {
        const result = await agent.retrieve(query)
        const sections: string[] = []

        if (result.modules.length > 0) {
          sections.push('## Relevant modules')
          for (const m of result.modules) {
            const lines = [`### ${m.name}`, m.responsibility]
            if (m.exposes.length) lines.push(`Exposes: ${m.exposes.join(', ')}`)
            if (m.dependencies.length) lines.push(`Depends on: ${m.dependencies.join(', ')}`)
            if (m.throws.length) lines.push(`Throws: ${m.throws.join(', ')}`)
            if (m.notes) lines.push(`Note: ${m.notes}`)
            sections.push(lines.join('\n'))
          }
        } else {
          sections.push('No modules matched the query.')
        }

        if (result.global.entries.length > 0) {
          sections.push('## Project context')
          for (const e of result.global.entries) {
            sections.push(`- [${e.topic}] ${e.content} (confidence: ${e.confidence})`)
          }
        }

        return {
          content: [{ type: 'text' as const, text: sections.join('\n\n') }],
        }
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error retrieving context: ${err}` }], isError: true }
      }
    },
  )

  server.tool(
    'save_fact',
    'Save a verifiable fact from a conversation to global memory. Only save facts you are confident about.',
    {
      fact: z.string().describe('The fact to save'),
      module: z.string().describe('The module this fact relates to, or "global" for project-wide facts'),
      confidence: z.number().min(0).max(1).describe('Confidence level from 0 to 1. Facts below 0.7 will be discarded.'),
    },
    async ({ fact, module, confidence }) => {
      try {
        await agent.saveFact(fact, module, confidence)
        if (confidence < (config.confidenceThreshold ?? 0.7)) {
          return {
            content: [{
              type: 'text' as const,
              text: `Fact discarded: confidence ${confidence} is below threshold ${config.confidenceThreshold ?? 0.7}.`,
            }],
          }
        }
        return {
          content: [{
            type: 'text' as const,
            text: `Fact saved: "${fact}" (module: ${module}, confidence: ${confidence})`,
          }],
        }
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error saving fact: ${err}` }], isError: true }
      }
    },
  )

  server.tool(
    'register_module',
    'Manually register or update a module in memory. Use this to refine what the static parser extracted or to add modules for languages not yet supported.',
    {
      name: z.string().describe('Module name'),
      responsibility: z.string().describe('1-2 sentences: what the module does'),
      exposes: z.array(z.string()).describe('Public functions, classes, or constants this module exports'),
      dependencies: z.array(z.string()).describe('Local module imports (not node_modules)'),
      throws: z.array(z.string()).describe('Error classes thrown by this module'),
      tags: z.array(z.string()).describe('Search keywords'),
      notes: z.string().optional().describe('Non-obvious behavior worth noting'),
    },
    async (params) => {
      try {
        await agent.saveModule({
          name: params.name,
          responsibility: params.responsibility,
          exposes: params.exposes,
          dependencies: params.dependencies,
          throws: params.throws,
          tags: params.tags,
          notes: params.notes,
          sourcePath: '',
          sourceHash: '',
        })
        return {
          content: [{ type: 'text' as const, text: `Module "${params.name}" registered successfully.` }],
        }
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error registering module: ${err}` }], isError: true }
      }
    },
  )

  server.tool(
    'get_memory',
    'Retrieve the full memory state: all modules and global facts.',
    {},
    async () => {
      try {
        const memory = await agent.getMemory()
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(memory, null, 2) }],
        }
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error getting memory: ${err}` }], isError: true }
      }
    },
  )

  server.tool(
    'remove_module',
    'Remove a module from memory by name.',
    {
      name: z.string().describe('Name of the module to remove'),
    },
    async ({ name }) => {
      try {
        const removed = await agent.removeModule(name)
        if (removed) {
          return { content: [{ type: 'text' as const, text: `Module "${name}" removed.` }] }
        }
        return { content: [{ type: 'text' as const, text: `Module "${name}" not found.` }], isError: true }
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error removing module: ${err}` }], isError: true }
      }
    },
  )

  return server
}

export async function startMcpServer(config: McpServerConfig = {}): Promise<void> {
  const server = createMcpServer(config)
  const transport = new StdioServerTransport()
  await server.connect(transport)
}