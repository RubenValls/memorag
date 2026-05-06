import Anthropic from '@anthropic-ai/sdk'
import { LLMAdapter } from './LLMAdapter'

export class ClaudeAdapter implements LLMAdapter {
  private client: Anthropic
  private model: string

  constructor(apiKey: string, model = 'claude-sonnet-4-6') {
    this.client = new Anthropic({ apiKey })
    this.model = model
  }

  async complete(prompt: string): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    })
    const block = response.content[0]
    if (block.type !== 'text') {
      throw new Error(`Unexpected content block type: ${block.type}`)
    }
    return block.text
  }
}
