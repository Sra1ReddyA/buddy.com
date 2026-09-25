/**
 * Provider-agnostic LLM client for structured ("forced tool call") output.
 *
 * Both Resume Buddy and Law Buddy need the same shape from the model: call exactly one named tool
 * with input matching a zod schema, optionally followed by a "repair" turn that points out what was
 * wrong and asks for another attempt. This file is the only place that talks to a model provider;
 * the callers (`src/lib/law/engine.ts`, `src/lib/resume/engine.ts`) never import a provider SDK.
 *
 * Provider selection, all free-tier — set any combination of these:
 *   - GEMINI_API_KEY        → Google Gemini (`@google/genai`), model GEMINI_MODEL or "gemini-3.8-flash"
 *   - OPENROUTER_API_KEY    → OpenRouter (`openai` SDK, custom baseURL), model OPENROUTER_MODEL or
 *                             "nex-agi/nex-n2.5-mini:free"
 *   - GROQ_API_KEY          → Groq (`openai` SDK, custom baseURL), model GROQ_MODEL or
 *                             "openai/gpt-oss-20b"
 * Every provider that has a key set is used, tried in the order above (`FailoverClient`): each one
 * already retries its own transient errors (withRetry, below); if it's still down after that — a free
 * tier can be saturated for minutes at a time, not just a one-off blip — the *next configured provider*
 * is tried, not just given up on. With only one key set there's nothing to fail over to, so it behaves
 * exactly like a single-provider setup. If none are set, getLLMClient() returns null and callers fall
 * back to their rule-based engine — exactly as they did before when ANTHROPIC_API_KEY was unset.
 */
import "server-only";
import { z } from "zod";
import { jsonSchema } from "./schema";

export type LLMTool = { name: string; description: string; schema: z.ZodType };

/** Opaque per-provider conversation history. Callers only ever pass it back in unchanged. */
export type LLMTurn = unknown;

export type ToolCallResult<T> = { data: T; transcript: LLMTurn[]; toolUseId: string };

/**
 * Free-tier models are far flakier than a paid API: brief "model overloaded" 429/503s and occasional
 * malformed structured-output attempts are common and usually succeed on a second try. Retry those
 * automatically; let everything else (schema validation failures, auth errors, etc.) propagate so the
 * caller's own repair-turn / rule-based fallback can handle it.
 *
 * This is the ONLY retry layer — both provider SDKs are constructed below with their own automatic
 * retries disabled (`maxRetries`/`retryOptions.attempts: 1`), because left on, they add a second,
 * much slower retry loop underneath this one: the Gemini SDK defaults to 5 attempts with up to 60s
 * between them, and the OpenAI SDK's default 2 retries will sleep for a provider-sent Retry-After
 * header of any length. Stacked with this wrapper's own attempts, a single exhausted-quota response
 * could take minutes to surface — which is exactly what made the app feel hung. Two small, fast
 * attempts here (this wrapper) is the only backoff that happens.
 */
async function withRetry<T>(fn: () => Promise<T>, isRetryable: (err: unknown) => boolean, attempts = 2, baseDelayMs = 500): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === attempts - 1 || !isRetryable(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** i));
    }
  }
  /* istanbul ignore next — loop above always returns or throws */
  throw new Error("unreachable");
}

/** Request timeout for a single call to any provider — fail fast rather than hang. */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * A per-day (not per-minute) quota being exhausted — e.g. Gemini's free-tier daily request cap —
 * cannot recover within this request, or even within the next several requests, no matter how many
 * times or how patiently we retry it. Detected from the provider's own error text since neither SDK
 * exposes a clean status code for "daily" vs "per-minute" rate limiting.
 */
function isDailyQuotaExhausted(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /PerDay|daily quota/i.test(msg);
}

export interface LLMClient {
  readonly provider: string;
  readonly model: string;
  /** Build a plain user turn (the initial prompt). */
  userTurn(text: string): LLMTurn;
  /** Force the model to call `tool` once; validate its input against `schema`. */
  callTool<T>(
    system: string,
    messages: LLMTurn[],
    tool: LLMTool,
    schema: z.ZodType<T>,
    maxTokens: number,
    temperature?: number,
  ): Promise<ToolCallResult<T>>;
  /** Append the acknowledgement of a prior tool call plus a follow-up instruction, for a repair turn. */
  repairTurn(transcript: LLMTurn[], toolUseId: string, ackText: string, followUpText: string): LLMTurn[];
}

// ---------------------------------------------------------------------------
// Gemini (primary — free tier via Google AI Studio)
// ---------------------------------------------------------------------------
type GeminiPart = { text?: string; functionCall?: { name: string; args: Record<string, unknown> }; functionResponse?: { name: string; response: Record<string, unknown> } };
type GeminiTurn = { role: "user" | "model"; parts: GeminiPart[] };

/** Transient: overload (503/RESOURCE_EXHAUSTED/UNAVAILABLE) or a one-off malformed structured-output attempt. */
function isGeminiRetryable(err: unknown): boolean {
  // A daily quota won't reset in the next few seconds — retrying (even once) just burns time.
  if (isDailyQuotaExhausted(err)) return false;
  const status = (err as { status?: number })?.status;
  if (status === 429 || status === 503) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /RESOURCE_EXHAUSTED|UNAVAILABLE|MALFORMED_FUNCTION_CALL/.test(msg);
}

class GeminiClient implements LLMClient {
  readonly provider = "gemini";
  private client: Promise<import("@google/genai").GoogleGenAI>;

  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    // Lazy/dynamic import so the package is only required when this provider is actually selected.
    // `retryOptions.attempts: 1` = no SDK-internal retries (the default is 5, with up to 60s between
    // them) — `withRetry` above is the only retry loop. `timeout` fails a hung request fast.
    this.client = import("@google/genai").then(
      ({ GoogleGenAI }) => new GoogleGenAI({ apiKey, httpOptions: { timeout: REQUEST_TIMEOUT_MS, retryOptions: { attempts: 1 } } }),
    );
  }

  userTurn(text: string): GeminiTurn {
    return { role: "user", parts: [{ text }] };
  }

  async callTool<T>(system: string, messages: LLMTurn[], tool: LLMTool, schema: z.ZodType<T>, maxTokens: number, temperature = 0.2): Promise<ToolCallResult<T>> {
    const { FunctionCallingConfigMode } = await import("@google/genai");
    const ai = await this.client;
    const call = await withRetry(
      async () => {
        const response = await ai.models.generateContent({
          model: this.model,
          contents: messages as GeminiTurn[],
          config: {
            systemInstruction: system,
            temperature,
            maxOutputTokens: maxTokens,
            tools: [{ functionDeclarations: [{ name: tool.name, description: tool.description, parametersJsonSchema: jsonSchema(tool.schema) }] }],
            toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: [tool.name] } },
          },
        });
        const fc = response.functionCalls?.[0];
        if (!fc?.args) throw new Error(`Gemini returned no function call (finish reason: ${response.candidates?.[0]?.finishReason ?? "unknown"})`);
        return { args: fc.args as Record<string, unknown> };
      },
      isGeminiRetryable,
    );
    const data = schema.parse(call.args);
    const modelTurn: GeminiTurn = { role: "model", parts: [{ functionCall: { name: tool.name, args: call.args } }] };
    return { data, transcript: [...(messages as GeminiTurn[]), modelTurn], toolUseId: tool.name };
  }

  repairTurn(transcript: LLMTurn[], toolUseId: string, ackText: string, followUpText: string): LLMTurn[] {
    const turn: GeminiTurn = { role: "user", parts: [{ functionResponse: { name: toolUseId, response: { result: ackText } } }, { text: followUpText }] };
    return [...(transcript as GeminiTurn[]), turn];
  }
}

// ---------------------------------------------------------------------------
// OpenAI-compatible (OpenRouter or Groq — both free tiers, same Chat Completions shape)
// ---------------------------------------------------------------------------
type OpenAITurn =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

/** Transient: rate limit, transient server error, or a one-off malformed tool-call — worth one retry on a free tier. */
function isOpenAICompatRetryable(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) return true;
  // Groq (and some other OpenAI-compatible providers) reject a forced tool_choice as a 400 request
  // error — rather than a 200 with an empty tool_calls array — when the model fails to produce a
  // valid call. Same underlying failure as "returned no tool call" below, just surfaced differently;
  // worth the same one-off retry rather than failing straight over to the next provider.
  const code = (err as { code?: string })?.code;
  if (status === 400 && code === "tool_use_failed") return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /returned no tool call|non-JSON tool arguments|tool choice is required/i.test(msg);
}

class OpenAICompatClient implements LLMClient {
  readonly provider: string;
  private client: Promise<import("openai").default>;

  constructor(
    apiKey: string,
    baseURL: string,
    readonly model: string,
    provider: string,
  ) {
    this.provider = provider;
    // maxRetries: 0 — the SDK's own default (2 retries) will sleep for a provider-sent Retry-After
    // header of ANY length before retrying, which is what made a single exhausted-quota call take
    // ages; `withRetry` above is the only retry loop, with its own short, bounded backoff.
    this.client = import("openai").then(({ default: OpenAI }) => new OpenAI({ apiKey, baseURL, maxRetries: 0, timeout: REQUEST_TIMEOUT_MS }));
  }

  userTurn(text: string): OpenAITurn {
    return { role: "user", content: text };
  }

  async callTool<T>(system: string, messages: LLMTurn[], tool: LLMTool, schema: z.ZodType<T>, maxTokens: number, temperature = 0.2): Promise<ToolCallResult<T>> {
    const openai = await this.client;
    const { rawCall, fn, args, msg } = await withRetry(async () => {
      const completion = await openai.chat.completions.create({
        model: this.model,
        temperature,
        max_tokens: maxTokens,
        messages: [{ role: "system", content: system }, ...(messages as OpenAITurn[])],
        tools: [{ type: "function", function: { name: tool.name, description: tool.description, parameters: jsonSchema(tool.schema) } }],
        tool_choice: { type: "function", function: { name: tool.name } },
      });
      const message = completion.choices[0]?.message;
      const call = message?.tool_calls?.find((c) => c.type === "function" && c.function.name === tool.name);
      const func = call && call.type === "function" ? call.function : undefined;
      if (!call || !func) {
        const reason = completion.choices[0]?.finish_reason ?? "unknown";
        const hint = reason === "length" ? " — hit maxTokens before finishing the tool call; consider a higher maxTokens for this call" : "";
        throw new Error(`${this.provider} returned no tool call (finish reason: ${reason}${hint})`);
      }
      let parsedArgs: unknown;
      try {
        parsedArgs = JSON.parse(func.arguments);
      } catch {
        throw new Error(`${this.provider} returned non-JSON tool arguments`);
      }
      return { rawCall: call, fn: func, args: parsedArgs, msg: message };
    }, isOpenAICompatRetryable);
    const data = schema.parse(args);
    const assistantTurn: OpenAITurn = { role: "assistant", content: msg?.content ?? null, tool_calls: [{ id: rawCall.id, type: "function", function: { name: tool.name, arguments: fn.arguments } }] };
    return { data, transcript: [...(messages as OpenAITurn[]), assistantTurn], toolUseId: rawCall.id };
  }

  repairTurn(transcript: LLMTurn[], toolUseId: string, ackText: string, followUpText: string): LLMTurn[] {
    const toolTurn: OpenAITurn = { role: "tool", tool_call_id: toolUseId, content: ackText };
    const userTurn: OpenAITurn = { role: "user", content: followUpText };
    return [...(transcript as OpenAITurn[]), toolTurn, userTurn];
  }
}

// ---------------------------------------------------------------------------
// Failover — tries every configured provider, in order, before giving up
// ---------------------------------------------------------------------------
/**
 * A turn that hasn't been sent to any backend yet: just the plain text. `callTool` turns this into
 * whichever backend it ends up trying (`backend.userTurn(text)`), so the same initial prompt can be
 * replayed against a second provider if the first one fails.
 */
type UniversalTurn = { __llm: "universal"; text: string };
/**
 * A turn already tied to one specific backend (the model's own tool call, or a repair turn built from
 * it) — from here on the conversation MUST stay on that backend, since the two providers' transcript
 * formats aren't interchangeable. `provider` is a `LLMClient.provider` value ("gemini", "groq", …).
 */
type TaggedTurn = { __llm: "tagged"; provider: string; turn: LLMTurn };
type FailoverTurn = UniversalTurn | TaggedTurn;
const isTagged = (t: LLMTurn): t is TaggedTurn => typeof t === "object" && t !== null && (t as FailoverTurn).__llm === "tagged";

/**
 * Once a backend is confirmed to be out for a while (its daily quota, not a one-off blip), every
 * request for the rest of that window would otherwise pay the same timeout+retry cost again just to
 * rediscover that — across a burst of requests that adds up to real, user-visible slowness. Skip it
 * outright until the cooldown passes. Per server instance, like the search-result cache in
 * courtlistener.ts; a cold instance (or a redeploy) simply re-discovers it on the next failure.
 */
const DAILY_QUOTA_COOLDOWN_MS = 20 * 60_000;
const cooldownUntil = new Map<string, number>();

class FailoverClient implements LLMClient {
  readonly provider = "auto";
  /** Cosmetic only (for GenerateResult.model-style display) — which backend most recently succeeded. */
  private lastUsed: LLMClient;

  constructor(private backends: LLMClient[]) {
    this.lastUsed = backends[0];
  }

  get model(): string {
    return `${this.lastUsed.provider}:${this.lastUsed.model}`;
  }

  userTurn(text: string): FailoverTurn {
    return { __llm: "universal", text };
  }

  async callTool<T>(system: string, messages: LLMTurn[], tool: LLMTool, schema: z.ZodType<T>, maxTokens: number, temperature = 0.2): Promise<ToolCallResult<T>> {
    const turns = messages as FailoverTurn[];
    const tag = (backend: LLMClient, result: ToolCallResult<T>): ToolCallResult<T> => ({
      data: result.data,
      transcript: result.transcript.map((t): TaggedTurn => ({ __llm: "tagged", provider: backend.provider, turn: t })),
      toolUseId: `${backend.provider}:${result.toolUseId}`,
    });

    // Continuation of an existing conversation (a repair turn) — already committed to one backend.
    const committed = turns.find(isTagged);
    if (committed) {
      const backend = this.backends.find((b) => b.provider === committed.provider);
      if (!backend) throw new Error(`llm failover: provider "${committed.provider}" is no longer configured`);
      const native = turns.map((t) => (t.__llm === "tagged" ? t.turn : backend.userTurn(t.text)));
      this.lastUsed = backend;
      return tag(backend, await backend.callTool(system, native, tool, schema, maxTokens, temperature));
    }

    // Fresh conversation — every turn is still a plain UniversalTurn at this point. Try each
    // configured backend in turn, skipping any still cooling down from a confirmed daily-quota hit.
    const universal = turns as UniversalTurn[];
    let lastErr: unknown;
    for (const backend of this.backends) {
      const until = cooldownUntil.get(backend.provider);
      if (until && Date.now() < until) {
        lastErr = new Error(`${backend.provider} is cooling down after a daily quota error (retry after ${new Date(until).toISOString()})`);
        console.warn(`[llm] ${backend.provider} skipped — cooling down for another ${Math.ceil((until - Date.now()) / 1000)}s`);
        continue;
      }
      try {
        const native = universal.map((t) => backend.userTurn(t.text));
        const result = tag(backend, await backend.callTool(system, native, tool, schema, maxTokens, temperature));
        this.lastUsed = backend;
        cooldownUntil.delete(backend.provider);
        return result;
      } catch (err) {
        lastErr = err;
        if (isDailyQuotaExhausted(err)) cooldownUntil.set(backend.provider, Date.now() + DAILY_QUOTA_COOLDOWN_MS);
        console.warn(`[llm] ${backend.provider} failed${this.backends.length > 1 ? ", trying next provider" : ""}:`, err instanceof Error ? err.message : err);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("llm failover: all configured providers failed");
  }

  repairTurn(transcript: LLMTurn[], toolUseId: string, ackText: string, followUpText: string): LLMTurn[] {
    const tagged = (transcript as FailoverTurn[]).filter(isTagged);
    const providerName = tagged.at(-1)?.provider;
    const backend = this.backends.find((b) => b.provider === providerName);
    if (!backend) throw new Error(`llm failover: provider "${providerName}" is no longer configured`);
    const sep = toolUseId.indexOf(":");
    const nativeToolUseId = sep >= 0 ? toolUseId.slice(sep + 1) : toolUseId;
    const native = backend.repairTurn(
      tagged.map((t) => t.turn),
      nativeToolUseId,
      ackText,
      followUpText,
    );
    return native.map((t): TaggedTurn => ({ __llm: "tagged", provider: backend.provider, turn: t }));
  }
}

// ---------------------------------------------------------------------------
// Provider selection
// ---------------------------------------------------------------------------
let cached: LLMClient | null | undefined;

/** Every provider with a key configured, in fallback order. */
function configuredBackends(): LLMClient[] {
  const backends: LLMClient[] = [];
  if (process.env.GEMINI_API_KEY) backends.push(new GeminiClient(process.env.GEMINI_API_KEY, process.env.GEMINI_MODEL || "gemini-3.8-flash"));
  if (process.env.OPENROUTER_API_KEY)
    backends.push(new OpenAICompatClient(process.env.OPENROUTER_API_KEY, "https://openrouter.ai/api/v1", process.env.OPENROUTER_MODEL || "nex-agi/nex-n2.5-mini:free", "openrouter"));
  if (process.env.GROQ_API_KEY) backends.push(new OpenAICompatClient(process.env.GROQ_API_KEY, "https://api.groq.com/openai/v1", process.env.GROQ_MODEL || "openai/gpt-oss-20b", "groq"));
  return backends;
}

/** The configured free-tier provider(s) with automatic failover between them, or null if none is set. */
export function getLLMClient(): LLMClient | null {
  if (cached !== undefined) return cached;
  const backends = configuredBackends();
  cached = backends.length ? new FailoverClient(backends) : null;
  return cached;
}

/** For tests: reset the memoized client so a changed env var takes effect. */
export function resetLLMClientCache() {
  cached = undefined;
}
