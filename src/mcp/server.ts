import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { MemoAgent } from '../agent/MemoAgent.js'

export interface McpServerConfig {
  memoryPath?: string
  confidenceThreshold?: number
  logLevel?: 'debug' | 'info' | 'warn' | 'error' | 'silent'
}

export function createMcpServer(config: McpServerConfig = {}): McpServer {
  const agent = new MemoAgent({
    memoryPath: config.memoryPath,
    confidenceThreshold: config.confidenceThreshold,
    logLevel: config.logLevel,
  })

  const server = new McpServer({
    name: 'memorag',
    version: '1.0.0',
  })

  server.tool(
    'ingest_file',
    'Analyze a source file and store a structured summary in memory. Automatically detects the programming language and extracts exports, dependencies, classes, functions, and thrown errors.',
    {
      path: z.string().describe('Absolute path to the source file to analyze'),
    },
    async ({ path }) => {
      try {
        await agent.ingest(path)
        const mod = await agent.getModule(path.split('/').pop()!.split('.')[0])
        if (!mod) {
          return { content: [{ type: 'text' as const, text: `Ingested ${path} but could not retrieve module. The file type may be unsupported.` }] }
        }
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