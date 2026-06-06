import type { JsonSchema } from "../types/common.js";
import type { StructuredOutputConfig, StructuredOutputTransport } from "../types/agent.js";

const STRUCTURED_OUTPUT_INSTRUCTIONS =
  "Return exactly one JSON object that matches the schema below. Do not wrap it in markdown fences or add commentary.";

export interface StructuredOutputPromptResult {
  transport: StructuredOutputTransport;
  prompt: string;
  injectedSchema: boolean;
  nativeRequested: boolean;
}

export function isStructuredOutputTransport(value: unknown): value is StructuredOutputTransport {
  return (
    value === "validate-only" ||
    value === "prompt" ||
    value === "native" ||
    value === "auto"
  );
}

export function resolveStructuredOutputPrompt(input: {
  prompt: string;
  schema?: JsonSchema | undefined;
  structuredOutput?: StructuredOutputConfig | undefined;
}): StructuredOutputPromptResult {
  const transport = input.structuredOutput?.transport ?? "auto";

  if (!input.schema) {
    return {
      transport,
      prompt: input.prompt,
      injectedSchema: false,
      nativeRequested: transport === "native"
    };
  }

  if (transport === "validate-only") {
    return {
      transport,
      prompt: input.prompt,
      injectedSchema: false,
      nativeRequested: false
    };
  }

  if (transport === "native") {
    return {
      transport,
      prompt: input.prompt,
      injectedSchema: false,
      nativeRequested: true
    };
  }

  return {
    transport,
    prompt: renderSchemaPrompt(input.prompt, input.schema),
    injectedSchema: true,
    nativeRequested: false
  };
}

function renderSchemaPrompt(prompt: string, schema: JsonSchema): string {
  return [
    prompt.trimEnd(),
    "",
    STRUCTURED_OUTPUT_INSTRUCTIONS,
    "",
    "JSON Schema:",
    JSON.stringify(schema, null, 2)
  ].join("\n");
}
