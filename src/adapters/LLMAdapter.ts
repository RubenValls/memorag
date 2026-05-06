export interface LLMAdapter {
  complete(prompt: string): Promise<string>
}
