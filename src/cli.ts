#!/usr/bin/env node
import { startMcpServer } from './mcp/server.js'
import { MemoAgent } from './agent/MemoAgent.js'
import { StaticParser } from './static/StaticParser.js'
import { readFile } from 'node:fs/promises'
import { resolve, basename, extname } from 'node:path'
import { homedir } from 'node:os'

const [nodeMajor] = process.versions.node.split('.').map(Number)
if (nodeMajor < 18) {
  process.stderr.write(
    `[memorag] Node.js v${process.versions.node} detected. Required: v18+.\n` +
    `  Download: https://nodejs.org/en/download\n`
  )
  process.exit(1)
}

const args = process.argv.slice(2)
const command = args[0]

function getMemoryPath(): string {
  const idx = args.indexOf('--memory-path')
  if (idx !== -1 && args[idx + 1]) {
    return resolve(args[idx + 1])
  }
  return resolve(homedir(), '.memorag')
}

async function main(): Promise<void> {
  if (!command || command === 'serve') {
    await startMcpServer({ memoryPath: getMemoryPath() })
    return
  }

  const agent = new MemoAgent({ memoryPath: getMemoryPath() })

  if (command === 'ingest') {
    const filePath = args[1]
    if (!filePath) {
      console.error('Usage: memorag ingest <file-path>')
      process.exit(1)
    }
    const resolved = resolve(filePath)
    const result = await agent.ingest(resolved)
    if (result === 'unreadable') {
      console.error(`Cannot read file: ${resolved}`)
      process.exit(1)
    }
    if (result === 'unsupported') {
      console.error(`Unsupported file type: ${extname(resolved) || '(no extension)'}`)
      console.error(`Supported: .ts .tsx .js .jsx .mjs .cjs .py .go .rs .java .rb`)
      process.exit(1)
    }
    if (result === 'unchanged') {
      console.log(`Unchanged (skipped): ${resolved}`)
      return
    }
    const mod = await agent.getModule(basename(resolved, extname(resolved)))
    if (mod) {
      console.log(JSON.stringify(mod, null, 2))
    }
    return
  }

  if (command === 'inspect') {
    const memory = await agent.getMemory()
    if (memory.modules.length === 0 && memory.global.entries.length === 0) {
      console.log('No memory found. Run `memorag ingest <file>` first.')
      return
    }
    if (memory.modules.length > 0) {
      console.log('## Modules')
      for (const m of memory.modules) {
        console.log(`  ${m.name}: ${m.responsibility}`)
        if (m.exposes.length) console.log(`    exposes: ${m.exposes.join(', ')}`)
        if (m.dependencies.length) console.log(`    depends on: ${m.dependencies.join(', ')}`)
      }
    }
    if (memory.global.entries.length > 0) {
      console.log('\n## Global facts')
      for (const e of memory.global.entries) {
        console.log(`  [${e.topic}] ${e.content} (${e.confidence})`)
      }
    }
    return
  }

  if (command === 'parse') {
    const filePath = args[1]
    if (!filePath) {
      console.error('Usage: memorag parse <file-path>')
      process.exit(1)
    }
    const resolved = resolve(filePath)
    const content = await readFile(resolved, 'utf-8')
    const result = StaticParser.parse(resolved, content)
    if (result) {
      console.log(JSON.stringify(result, null, 2))
    } else {
      console.error('Unsupported file type.')
      process.exit(1)
    }
    return
  }

  console.error(`Unknown command: ${command}`)
  console.error('Usage: memorag [serve|ingest|inspect|parse] [options]')
  process.exit(1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})