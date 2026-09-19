import { inspect } from "node:util";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto/secret-box";
import { AppError, safeErrorForLog } from "@/lib/errors";
import { INTEGRATION_LABEL, type IntegrationKindName, type IntegrationOrigin } from "./types";

/**
 * Resolvedor único de configuração de integração (SPEC-018): banco (decifrado só em memória) -> fallback `.env` (só evolution).
 * O valor NUNCA é logado nem serializado: `IntegrationConfig` esconde o segredo em toJSON/inspect; leia via `reveal()` só para montar
 * o cliente HTTP. Cache curto POR PROCESSO (TTL); salvar/remover invalida o do processo atual (outros processos: até o TTL).
 */
export const CACHE_TTL_MS = 30_000;

export class IntegrationConfig {
  readonly #value: string;
  constructor(
    readonly integration: IntegrationKindName,
    readonly name: string,
    readonly origin: "db" | "env",
    value: string,
    readonly baseUrl: string | null,
    /** Só origem db: "instância própria" confirmada. Env é confiável (comportamento anterior preservado). */
    readonly allowPrivateHost: boolean,
  ) {
    this.#value = value;
  }
  reveal(): string {
    return this.#value;
  }
  toJSON(): Record<string, unknown> {
    return { integration: this.integration, name: this.name, origin: this.origin, baseUrl: this.baseUrl, value: "[REDACTED]" };
  }
  [inspect.custom](): string {
    return `IntegrationConfig<${this.integration}/${this.name} ${this.origin} [REDACTED]>`;
  }
}

type CacheEntry = { at: number; cfg: IntegrationConfig | null };
const cache = new Map<string, CacheEntry>();
let ttlMs = CACHE_TTL_MS;
const keyOf = (i: IntegrationKindName, n: string) => `${i}:${n}`;

export function invalidateIntegrationCache(integration?: IntegrationKindName, name?: string): void {
  if (integration && name) cache.delete(keyOf(integration, name));
  else cache.clear();
}
/** Só testes. */
export function _setCacheTtl(ms: number | null): void {
  ttlMs = ms ?? CACHE_TTL_MS;
  cache.clear();
}

function fromEnv(integration: IntegrationKindName, name: string): IntegrationConfig | null {
  if (integration !== "evolution" || name !== "default") return null;
  const baseUrl = process.env.EVOLUTION_API_URL?.trim();
  const key = process.env.EVOLUTION_API_KEY?.trim();
  if (!baseUrl || !key) return null;
  return new IntegrationConfig("evolution", "default", "env", key, baseUrl, true);
}

async function fromDb(integration: IntegrationKindName, name: string): Promise<IntegrationConfig | null> {
  const hit = cache.get(keyOf(integration, name));
  if (hit && Date.now() - hit.at < ttlMs) return hit.cfg;
  const row = await prisma.integrationSecret.findUnique({
    where: { integration_name: { integration, name } },
    select: { encryptedValue: true, baseUrl: true, allowPrivateHost: true },
  });
  let cfg: IntegrationConfig | null = null;
  if (row) {
    try {
      cfg = new IntegrationConfig(integration, name, "db", decrypt(row.encryptedValue), row.baseUrl, row.allowPrivateHost);
    } catch (e) {
      console.error("[integrations] falha ao decifrar segredo:", safeErrorForLog(e));
      throw new AppError({ code: "config", userMessage: `Não foi possível decifrar a chave de ${INTEGRATION_LABEL[integration]}. Cadastre-a novamente em Configurações > Integrações.` });
    }
  }
  cache.set(keyOf(integration, name), { at: Date.now(), cfg });
  return cfg;
}

/** null = não configurada (nem banco, nem env). */
export async function findIntegrationConfig(integration: IntegrationKindName, name = "default"): Promise<IntegrationConfig | null> {
  return (await fromDb(integration, name)) ?? fromEnv(integration, name);
}

export async function getIntegrationConfig(integration: IntegrationKindName, name = "default"): Promise<IntegrationConfig> {
  const cfg = await findIntegrationConfig(integration, name);
  if (!cfg) {
    throw new AppError({
      code: "config",
      userMessage: `${INTEGRATION_LABEL[integration]} não configurada. Cadastre em Configurações > Integrações.`,
    });
  }
  return cfg;
}

/** Origem efetiva sem decifrar nada (para listagem). */
export async function integrationOrigin(integration: IntegrationKindName, name = "default"): Promise<IntegrationOrigin> {
  const n = await prisma.integrationSecret.count({ where: { integration, name } });
  if (n) return "db";
  return fromEnv(integration, name) ? "env" : "none";
}
