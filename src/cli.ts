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
    await agent.ingest(resolved)
    const moduleName = basename(resolved, extname(resolved))
    const mod = await agent.getModule(moduleName)
    if (mod) {
      console.log(JSON.stringify(mod, null, 2))
    } else {
      console.error(`Could not parse ${resolved}. Unsupported file type?`)
      process.exit(1)
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