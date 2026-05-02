/**
 * Tool-use helpers for guaranteed-valid structured output from Claude.
 *
 *   Why tool_use, not JSON.parse(text):
 *
 *     With JSON.parse-on-text, the model emits free-form text and we hope
 *     it's valid JSON. Sonnet/Haiku occasionally embed unescaped quotes or
 *     newlines inside string values, breaking JSON.parse — symptom: a
 *     500-style "Expected ',' or '}' after property value at position N".
 *
 *     With tool_use, the API forces the model to call a named tool with
 *     a JSON-schema-shaped input. The SDK delivers `block.input` as a
 *     pre-parsed object — no string-escape concerns possible.
 *
 *   Caller pattern:
 *
 *     const res = await client.messages.create({...})
 *     const input = extractToolInput<MyShape>(res, 'my_tool')
 *
 *   We pair this with `tool_choice: { type: 'tool', name: 'my_tool' }`
 *   so the model MUST call the tool — no fallback to plain text.
 */

import type Anthropic from '@anthropic-ai/sdk'

export class ToolUseExtractError extends Error {
  constructor(
    message: string,
    public readonly stopReason: string | null,
  ) {
    super(message)
    this.name = 'ToolUseExtractError'
  }
}

/**
 * Pulls the named tool_use block's parsed input out of an Anthropic
 * Messages response. Throws ToolUseExtractError if the model didn't
 * call the expected tool — caller should handle this as a hard error
 * (it means tool_choice didn't take effect, which is an API-level issue).
 */
export function extractToolInput<T>(
  res: Anthropic.Message,
  toolName: string,
): T {
  for (const block of res.content) {
    if (block.type === 'tool_use' && block.name === toolName) {
      // SDK has already JSON-parsed `input` for us — no string escape risk.
      return block.input as T
    }
  }
  throw new ToolUseExtractError(
    `Expected tool_use block named "${toolName}" in response (stop_reason=${res.stop_reason ?? 'null'})`,
    res.stop_reason,
  )
}
