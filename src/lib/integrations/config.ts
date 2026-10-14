import { inspect } from "node:util";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto/secret-box";
import { AppError, safeErrorForLog } from "@/lib/errors";
import { getEntitlements, hasFeature } from "@/lib/billing/entitlements";
import { INTEGRATION_LABEL, type IntegrationKindName, type IntegrationOrigin } from "./types";

/**
 * Resolvedor único de configuração de integração (SPEC-018, por-org desde SPEC-030): banco (decifrado só
 * em memória, por Organization) -> fallback `.env` (só evolution — compartilhado por toda a instalação,
 * não é por-org; ver Riscos SPEC-030 sobre esse caso de fronteira multi-tenant/self-host).
 * O valor NUNCA é logado nem serializado: `IntegrationConfig` esconde o segredo em toJSON/inspect; leia via `reveal()` só para montar
 * o cliente HTTP. Cache curto POR PROCESSO (TTL, chave inclui orgId); salvar/remover invalida o do processo atual (outros processos: até o TTL).
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

type CacheEntry = { at: number; cfg: IntegrationConfig | null; managedByPlatform: boolean };
const cache = new Map<string, CacheEntry>();
let ttlMs = CACHE_TTL_MS;
const keyOf = (orgId: string, i: IntegrationKindName, n: string) => `${orgId}:${i}:${n}`;

export function invalidateIntegrationCache(orgId?: string, integration?: IntegrationKindName, name?: string): void {
  if (orgId && integration && name) cache.delete(keyOf(orgId, integration, name));
  else cache.clear();
}
/** Só testes. */
export function _setCacheTtl(ms: number | null): void {
  ttlMs = ms ?? CACHE_TTL_MS;
  cache.clear();
}

function fromEnv(integration: IntegrationKindName, name: string): IntegrationConfig | null {
  // SPEC-069c (Q-069-2/D-069-7): LLM DA PLATAFORMA (a plataforma paga a IA). Opcional: `PLATFORM_LLM_API_KEY` (+ `PLATFORM_LLM_BASE_URL` p/ OpenAI-compativel).
  // Sem URL = Claude. Valor confiavel (env), como o da Evolution; nunca logado.
  if (integration === "llm" && name === "default") {
    const key = process.env.PLATFORM_LLM_API_KEY?.trim();
    const baseUrl = process.env.PLATFORM_LLM_BASE_URL?.trim() || null;
    if (!key && !baseUrl) return null;
    return new IntegrationConfig("llm", "default", "env", key ?? "", baseUrl, true);
  }
  if (integration !== "evolution" || name !== "default") return null;
  const baseUrl = process.env.EVOLUTION_API_URL?.trim();
  const key = process.env.EVOLUTION_API_KEY?.trim();
  if (!baseUrl || !key) return null;
  return new IntegrationConfig("evolution", "default", "env", key, baseUrl, true);
}

async function fromDb(orgId: string, integration: IntegrationKindName, name: string): Promise<{ cfg: IntegrationConfig | null; managedByPlatform: boolean }> {
  const hit = cache.get(keyOf(orgId, integration, name));
  if (hit && Date.now() - hit.at < ttlMs) return { cfg: hit.cfg, managedByPlatform: hit.managedByPlatform };
  const row = await prisma.integrationSecret.findUnique({
    where: { orgId_integration_name: { orgId, integration, name } },
    select: { encryptedValue: true, baseUrl: true, allowPrivateHost: true, managedByPlatform: true },
  });
  let cfg: IntegrationConfig | null = null;
  if (row) {
    try {
      cfg = new IntegrationConfig(integration, name, "db", decrypt(row.encryptedValue), row.baseUrl, row.allowPrivateHost);
    } catch (e) {
      console.error("[integrations] falha ao decifrar segredo:", safeErrorForLog(e));
      throw new AppError({ code: "config", userMessage: `Não foi possível decifrar a chave de ${INTEGRATION_LABEL[integration]}. Este serviço é gerenciado pela plataforma: fale com o suporte.` });
    }
  }
  const managedByPlatform = row?.managedByPlatform ?? false;
  cache.set(keyOf(orgId, integration, name), { at: Date.now(), cfg, managedByPlatform });
  return { cfg, managedByPlatform };
}

/**
 * SPEC-069c (Q-069-2, QA 069b achado 5): chave de LLM gravada pelo PROPRIO tenant (BYOK legado, `managedByPlatform=false`) so vale se a org tem `llm.byok`
 * (Business/courtesy/override do admin). Sem isso a chave fica DESATIVADA (nao apagada: volta se o direito voltar) e a resolucao cai na chave da plataforma.
 * A checagem do direito NAO e cacheada (upgrade/override valem na hora).
 */
async function tenantKeyActive(orgId: string, integration: IntegrationKindName, managedByPlatform: boolean): Promise<boolean> {
  if (integration !== "llm" || managedByPlatform) return true;
  return hasFeature(await getEntitlements(prisma, orgId), "llm.byok");
}

/** null = não configurada (nem banco, nem env). */
export async function findIntegrationConfig(orgId: string, integration: IntegrationKindName, name = "default"): Promise<IntegrationConfig | null> {
  const db = await fromDb(orgId, integration, name);
  if (db.cfg && (await tenantKeyActive(orgId, integration, db.managedByPlatform))) return db.cfg;
  return fromEnv(integration, name);
}

export async function getIntegrationConfig(orgId: string, integration: IntegrationKindName, name = "default"): Promise<IntegrationConfig> {
  const cfg = await findIntegrationConfig(orgId, integration, name);
  if (!cfg) {
    throw new AppError({
      code: "config",
      userMessage: `${INTEGRATION_LABEL[integration]} não configurada. Este serviço é gerenciado pela plataforma: fale com o suporte.`,
    });
  }
  return cfg;
}

/** Origem efetiva sem decifrar nada (para listagem). */
export async function integrationOrigin(orgId: string, integration: IntegrationKindName, name = "default"): Promise<IntegrationOrigin> {
  const row = await prisma.integrationSecret.findUnique({ where: { orgId_integration_name: { orgId, integration, name } }, select: { managedByPlatform: true } });
  if (row && (await tenantKeyActive(orgId, integration, row.managedByPlatform))) return "db";
  return fromEnv(integration, name) ? "env" : "none";
}
