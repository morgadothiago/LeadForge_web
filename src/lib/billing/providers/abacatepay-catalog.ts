import { createHash } from "node:crypto";
import { Prisma, type BillingCadence } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AppError, isAppError } from "@/lib/errors";
import type { AbacateClient } from "./abacatepay-client";

/**
 * SPEC-063 (D-063-1..5) — catalogo de PRODUTOS do AbacatePay. Assinatura exige produto com `cycle`; produto nao tem update
 * (preco novo = produto novo). `ensureProduct` e find-or-create idempotente por `externalId` deterministico
 * `lf-{planKey}-{cadence}-{priceCents}`, com cache local em `BillingProduct` separado por `keyFingerprint` (dev x producao).
 *
 * Achados reais em dev mode (2026-10-12, registrados na SPEC): ciclo anual = `ANNUALLY` (`YEARLY` da 422); `externalId` duplicado
 * em `products/create` = HTTP 400 "Product with externalId already exists" (nao ha codigo proprio) — por isso o fallback de
 * duplicidade relista em QUALQUER 4xx. ATENCAO: a unicidade NAO e atomica no provedor (2 `create` quase simultaneos => 2 produtos
 * com o mesmo externalId) — a serializacao e feita aqui (lock advisory + cache), ver `ensureProduct`.
 */

export const PROVIDER = "abacatepay";
export const CADENCE_TO_CYCLE: Record<BillingCadence, "MONTHLY" | "ANNUALLY"> = { monthly: "MONTHLY", yearly: "ANNUALLY" };

export function keyFingerprintOf(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 8);
}

export interface CatalogPlan {
  id: string;
  key: string;
  name: string;
  priceMonthlyCents: number;
  priceYearlyCents: number | null;
}

/** D-063-4: preco da cadencia SEM cair no mensal. `yearly` sem preco anual = erro de validacao (nunca cobra o mensal). */
export function priceFor(plan: Pick<CatalogPlan, "priceMonthlyCents" | "priceYearlyCents">, cadence: BillingCadence): number {
  if (cadence === "yearly") {
    if (plan.priceYearlyCents == null || plan.priceYearlyCents <= 0) {
      throw new AppError({ code: "validation", userMessage: "Este plano não tem cobrança anual disponível." });
    }
    return plan.priceYearlyCents;
  }
  return plan.priceMonthlyCents;
}

export function productExternalId(planKey: string, cadence: BillingCadence, priceCents: number): string {
  return `lf-${planKey}-${cadence}-${priceCents}`;
}

let devModeWarned = false;
/** D-063-5: guarda de ambiente opcional (`ABACATEPAY_EXPECT_DEVMODE=true|false`); sem a env, so avisa 1x por processo. */
export function assertExpectedDevMode(devMode: boolean | undefined, env: Record<string, string | undefined> = process.env): void {
  if (typeof devMode !== "boolean") return;
  const expect = env.ABACATEPAY_EXPECT_DEVMODE;
  if (expect === "true" || expect === "false") {
    if ((expect === "true") !== devMode) {
      console.error(`[abacatepay] devMode=${devMode} difere de ABACATEPAY_EXPECT_DEVMODE=${expect}. Verifique a chave de API/ambiente.`);
      throw new AppError({ code: "config", userMessage: "Pagamento indisponível no momento. Tente novamente mais tarde." });
    }
    return;
  }
  if (!devModeWarned) {
    devModeWarned = true;
    console.warn(`[abacatepay] respostas com devMode=${devMode} (defina ABACATEPAY_EXPECT_DEVMODE=true|false para travar o ambiente).`);
  }
}

interface RemoteProduct {
  id: string;
  externalId?: string | null;
  price?: number;
  cycle?: string | null;
  status?: string;
  devMode?: boolean;
}

function asProduct(v: unknown): RemoteProduct | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id) return null;
  return {
    id: o.id,
    externalId: typeof o.externalId === "string" ? o.externalId : null,
    price: typeof o.price === "number" ? o.price : undefined,
    cycle: typeof o.cycle === "string" ? o.cycle : null,
    status: typeof o.status === "string" ? o.status : undefined,
    devMode: typeof o.devMode === "boolean" ? o.devMode : undefined,
  };
}

function configError(reason: string): AppError {
  return new AppError({ code: "config", userMessage: "Pagamento indisponível no momento. Tente novamente mais tarde.", cause: new Error(reason) });
}

export interface EnsuredProduct {
  providerProductId: string;
  externalId: string;
  priceCents: number;
}

export interface EnsureProductInput {
  client: AbacateClient;
  keyFingerprint: string;
  plan: CatalogPlan;
  cadence: BillingCadence;
}

export async function ensureProduct({ client, keyFingerprint, plan, cadence }: EnsureProductInput): Promise<EnsuredProduct> {
  const priceCents = priceFor(plan, cadence);
  const externalId = productExternalId(plan.key, cadence, priceCents);
  const cycle = CADENCE_TO_CYCLE[cadence];
  const where = { provider_keyFingerprint_externalId: { provider: PROVIDER, keyFingerprint, externalId } };
  const done = (providerProductId: string): EnsuredProduct => ({ providerProductId, externalId, priceCents });

  // 1) cache local (caminho quente: sem transacao, sem rede)
  const cached = await prisma.billingProduct.findUnique({ where });
  if (cached) return done(cached.providerProductId);

  const findRemote = async (): Promise<RemoteProduct | null> => {
    const res = await client.get<{ data?: unknown }>("/products/list", { externalId });
    const list = Array.isArray(res?.data) ? res.data : [];
    for (const item of list) {
      const p = asProduct(item);
      if (p && p.externalId === externalId) return p;
    }
    return null;
  };
  // Nunca usa produto errado: valor/ciclo/status divergentes = erro de configuracao (nao cobra o valor errado).
  const accept = (p: RemoteProduct): RemoteProduct => {
    if (p.price !== priceCents || p.cycle !== cycle || (p.status && p.status !== "ACTIVE")) {
      throw configError(`produto ${externalId} no provedor diverge do esperado (price=${p.price} cycle=${p.cycle} status=${p.status}; esperado price=${priceCents} cycle=${cycle})`);
    }
    assertExpectedDevMode(p.devMode);
    return p;
  };

  // 2) find-or-create SERIALIZADO por externalId (lock advisory de transacao no Postgres, vale entre instancias).
  // Achado real (dev mode, 2026-10-12): o provedor NAO garante unicidade de `externalId` sob concorrencia (2 `create` com ~20 ms de
  // diferenca => 2 produtos com o mesmo externalId) e `GET /products/list?externalId=` pode ficar defasado logo apos o create.
  // Por isso a corrida e resolvida AQUI: so 1 requisicao por vez cria; as demais releem o cache gravado pela vencedora.
  try {
    const row = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`billing-product:${PROVIDER}:${keyFingerprint}:${externalId}`}))`;
        const again = await tx.billingProduct.findUnique({ where });
        if (again) return again;

        let remote = await findRemote(); // ja existe no provedor (cache perdido, outra instancia)?
        if (!remote) {
          try {
            // SEM retry automatico: POST de criacao nao e idempotente.
            const res = await client.post<{ data?: unknown }>("/products/create", {
              externalId,
              name: `LeadForge ${plan.name} (${cadence === "yearly" ? "Anual" : "Mensal"})`,
              price: priceCents,
              currency: "BRL",
              cycle,
            });
            remote = asProduct(res?.data);
            if (!remote) throw new AppError({ code: "upstream", userMessage: "AbacatePay devolveu uma resposta inesperada." });
          } catch (e) {
            // Duplicidade (o provedor responde 400 "Product with externalId already exists", sem codigo proprio): relista 1x.
            if (isAppError(e) && e.status !== undefined && e.status >= 400 && e.status < 500 && e.code !== "unauthorized" && e.code !== "forbidden" && e.code !== "rate_limited") {
              remote = await findRemote();
            }
            if (!remote) throw e;
          }
        }
        const p = accept(remote);
        return tx.billingProduct.create({
          data: { provider: PROVIDER, keyFingerprint, planId: plan.id, cadence, priceCents, externalId, providerProductId: p.id, devMode: p.devMode ?? false },
        });
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
    return done(row.providerProductId);
  } catch (e) {
    // Rede de seguranca (nao esperado com o lock): linha gravada por outra via entre o lock e o insert.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const row = await prisma.billingProduct.findUnique({ where });
      if (row) return done(row.providerProductId);
    }
    throw e;
  }
}
