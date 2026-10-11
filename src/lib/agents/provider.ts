import { z } from "zod";
import type { AxiosInstance } from "axios";
import { createHttpClient } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { findIntegrationConfig, getIntegrationConfig } from "@/lib/integrations/config";
import { assertAllowedHost, parseIntegrationUrl, pinnedAgents, resolvesToPrivateOnly } from "@/lib/integrations/url-guard";
import { hostOf } from "@/lib/integrations/view";
import { agentOutputSchema, type AgentOutput } from "./types";

/** Interface neutra do provedor de IA (D25). Implementações: Claude (axios) e Fake (testes/replay). */
export interface LlmRequest { model: string; system: string; user: string; maxTokens?: number }
export interface LlmResult { output: AgentOutput; tokensIn: number; tokensOut: number; latencyMs: number }
export interface LlmProvider { generate(req: LlmRequest): Promise<LlmResult> }

/** Extrai e valida o JSON da resposta. Fora do schema => AppError validation (o runtime vira blocked + handoff). */
export function parseAgentOutput(raw: string): AgentOutput {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  const invalid = () => new AppError({ code: "validation", userMessage: "A resposta do agente veio fora do formato esperado." });
  if (start < 0 || end <= start) throw invalid();
  let json: unknown;
  try { json = JSON.parse(raw.slice(start, end + 1)); } catch { throw invalid(); }
  const r = agentOutputSchema.safeParse(json);
  if (!r.success) throw invalid();
  return r.data;
}

const anthropicResponse = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
});

export const ANTHROPIC_URL = "https://api.anthropic.com";

/** Uma instância axios por integração (regra transversal): erros normalizados PT-BR, 429 com Retry-After/backoff, sem vazar chave. */
export function createClaudeClient(apiKey: string, adapter?: Parameters<typeof createHttpClient>[0]["adapter"]): AxiosInstance {
  return createHttpClient({
    name: "Provedor de LLM",
    baseURL: ANTHROPIC_URL,
    timeout: 30_000,
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    retry: { maxAttempts: 3 },
    maxRedirects: 0,
    adapter,
  });
}

export class ClaudeProvider implements LlmProvider {
  constructor(private readonly client: AxiosInstance) {}
  async generate(req: LlmRequest): Promise<LlmResult> {
    const t0 = Date.now();
    // Gerar texto é seguro de repetir (sem efeito colateral além do custo): retry limitado do cliente axios vale.
    const res = await this.client.post("/v1/messages", {
      model: req.model,
      max_tokens: req.maxTokens ?? 600,
      system: req.system,
      messages: [{ role: "user", content: req.user }],
    }, { idempotent: true });
    const parsed = anthropicResponse.safeParse(res.data);
    if (!parsed.success) throw new AppError({ code: "upstream", userMessage: "Resposta inesperada do provedor de LLM." });
    const text = parsed.data.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
    return { output: parseAgentOutput(text), tokensIn: parsed.data.usage.input_tokens, tokensOut: parsed.data.usage.output_tokens, latencyMs: Date.now() - t0 };
  }
}

const openAiResponse = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable().optional() }).optional() })).min(1),
  usage: z.object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional() }).nullish(),
});

export interface OpenAICompatClientOptions {
  httpAgent?: Parameters<typeof createHttpClient>[0]["httpAgent"];
  httpsAgent?: Parameters<typeof createHttpClient>[0]["httpsAgent"];
}

/** SPEC-036: uma instância axios por integração (OpenAI-compatível: Ollama/Gemini/Groq). Bearer só com chave; sem redirect. */
export function createOpenAICompatClient(baseUrl: string, apiKey?: string, adapter?: Parameters<typeof createHttpClient>[0]["adapter"], opts: OpenAICompatClientOptions = {}): AxiosInstance {
  return createHttpClient({
    name: "Provedor de LLM",
    baseURL: baseUrl.replace(/\/+$/, ""),
    timeout: 30_000,
    headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
    retry: { maxAttempts: 3 },
    maxRedirects: 0,
    adapter,
    ...opts,
  });
}

export class OpenAICompatProvider implements LlmProvider {
  constructor(private readonly client: AxiosInstance) {}
  async generate(req: LlmRequest): Promise<LlmResult> {
    const t0 = Date.now();
    const res = await this.client.post("/chat/completions", {
      model: req.model,
      max_tokens: req.maxTokens ?? 600,
      messages: [{ role: "system", content: req.system }, { role: "user", content: req.user }],
    }, { idempotent: true });
    const parsed = openAiResponse.safeParse(res.data);
    if (!parsed.success) throw new AppError({ code: "upstream", userMessage: "Resposta inesperada do provedor de LLM." });
    const text = parsed.data.choices[0]?.message?.content ?? "";
    return {
      output: parseAgentOutput(text),
      tokensIn: parsed.data.usage?.prompt_tokens ?? 0,
      tokensOut: parsed.data.usage?.completion_tokens ?? 0,
      latencyMs: Date.now() - t0,
    };
  }
}

/**
 * Config via SPEC-018 (banco > env), por org. Com `baseUrl` => OpenAI-compatível (URL reconferida pelo url-guard e conexão
 * fixada no IP checado); sem => ClaudeProvider (comportamento anterior). Sem config: AppError config (handoff/rascunho, nunca envio).
 */
export async function getLlmProvider(orgId: string): Promise<LlmProvider> {
  const cfg = await getIntegrationConfig(orgId, "llm");
  if (cfg.baseUrl) {
    const u = parseIntegrationUrl(cfg.baseUrl);
    const { ip, family } = await assertAllowedHost(u.hostname, cfg.allowPrivateHost);
    return new OpenAICompatProvider(createOpenAICompatClient(u.url, cfg.reveal() || undefined, undefined, pinnedAgents(ip, family)));
  }
  return new ClaudeProvider(createClaudeClient(cfg.reveal()));
}

/** D-36-3: custo 0 quando o provedor é uma instância própria (host privado/local). */
export async function isPrivateLlmHost(orgId: string): Promise<boolean> {
  try {
    const cfg = await findIntegrationConfig(orgId, "llm");
    if (!cfg?.baseUrl || !cfg.allowPrivateHost) return false;
    return await resolvesToPrivateOnly(parseIntegrationUrl(cfg.baseUrl).hostname);
  } catch {
    return false;
  }
}

export interface LlmProviderInfo { kind: "claude" | "openai_compat" | "none"; host: string | null; model: string }
/** Provedor ativo para exibição (Simular): sem segredo; host mascarado. */
export async function describeLlmProvider(orgId: string, model: string): Promise<LlmProviderInfo> {
  const cfg = await findIntegrationConfig(orgId, "llm");
  if (!cfg) return { kind: "none", host: null, model };
  return cfg.baseUrl ? { kind: "openai_compat", host: hostOf(cfg.baseUrl), model } : { kind: "claude", host: null, model };
}

/** Fake com replay: respostas programadas por chamada; registra as requisições (testes de guardrail/injeção). */
export class FakeLlmProvider implements LlmProvider {
  readonly calls: LlmRequest[] = [];
  constructor(private readonly script: (Partial<AgentOutput> | Error | ((req: LlmRequest) => Partial<AgentOutput>))[] = []) {}
  async generate(req: LlmRequest): Promise<LlmResult> {
    this.calls.push(req);
    const step = this.script[Math.min(this.calls.length - 1, this.script.length - 1)] ?? {};
    if (step instanceof Error) throw step;
    const p = typeof step === "function" ? step(req) : step;
    const output = agentOutputSchema.parse({ action: "send", confidence: 0.9, citedKnowledgeIds: [], reasonSummary: "fake", message: "Olá, tudo bem? Posso te ajudar com uma dúvida?", ...p });
    return { output, tokensIn: 100, tokensOut: 50, latencyMs: 5 };
  }
}
