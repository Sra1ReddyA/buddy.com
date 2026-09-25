import "server-only";
import { z } from "zod";

/**
 * Plain JSON Schema for a zod type, with the `$schema` key stripped. Shared by every provider —
 * Gemini's `parametersJsonSchema` and OpenAI-compatible `function.parameters` both accept standard
 * JSON Schema (object/properties/required/enum/items/etc.), so no per-provider conversion is needed.
 */
export function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  return rest;
}
