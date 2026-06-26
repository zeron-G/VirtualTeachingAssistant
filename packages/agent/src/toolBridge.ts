/**
 * Bridge between framework-agnostic `VtaTool`s and the wire-level `LlmTool`
 * shape the LLM router/providers understand.
 *
 * A `VtaTool` carries its argument schema as raw zod (`parameters`), keeping
 * `@vta/tools` decoupled from any model SDK. The LLM layer, by contrast, wants a
 * JSON-Schema object. This module performs that one-way conversion via
 * `zod-to-json-schema`, passing `name`/`description` through unchanged.
 */

import { zodToJsonSchema } from 'zod-to-json-schema';
import type { LlmTool } from '@vta/llm';
import type { VtaTool } from '@vta/tools';

/**
 * Convert each `VtaTool` to an `LlmTool` by translating its zod `parameters`
 * into a JSON-Schema object. The model only ever sees `name`, `description`,
 * and this schema; execution stays in our loop.
 *
 * `zodToJsonSchema` returns a JSON-Schema 7 object; `LlmTool.parameters` is a
 * `Record<string, unknown>`, which that object structurally satisfies.
 */
export function toLlmTools(tools: VtaTool[]): LlmTool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: zodToJsonSchema(tool.parameters) as Record<string, unknown>,
  }));
}

/**
 * Find a `VtaTool` by name. Returns `undefined` when no tool matches, so the
 * caller can record an "unknown tool" result rather than throwing — the model
 * may hallucinate a tool name, and the loop must degrade gracefully.
 */
export function findTool(tools: VtaTool[], name: string): VtaTool | undefined {
  return tools.find((tool) => tool.name === name);
}
