import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createMcpServer } from '../../src/mcp/server.js'

describe('MCP server tool handlers', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'memorag-mcp-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('creates an MCP server without errors', () => {
    const server = createMcpServer({ memoryPath: join(tmpDir, 'docs/memorag') })
    expect(server).toBeDefined()
  })
})