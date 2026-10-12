import { createHmac } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { SlidingLimiter } from "@/lib/integrations/rate-limit";
import { canonicalDocumentKey, type ParsedDocument } from "@/lib/domain/document";

/**
 * SPEC-065 (D-065-19/27) — anti-abuso do trial de 14 dias: UM trial por e-mail canonico OU por CPF/CNPJ (raiz).
 * Guarda SO o hash (sha256 + pepper) em `TrialClaim` (sem PII, sem FK: sobrevive a exclusao de conta, 054). O hash do documento
 * nunca e devolvido ao cliente e a resposta nao revela qual dado bateu.
 */

export const TRIAL_DAYS = 14;
export const TRIAL_MS = TRIAL_DAYS * 24 * 3600_000;

/**
 * Chave do HMAC. Em PRODUCAO (`NODE_ENV=production`) `TRIAL_CLAIM_PEPPER` e OBRIGATORIA (sem fallback: trocar `AUTH_SECRET` zeraria o historico de
 * claims); em dev/test cai em `AUTH_SECRET`. Falta => erro claro (o `signUp` falha em vez de gravar hash fraco).
 */
function pepper(): string {
  const dedicated = process.env.TRIAL_CLAIM_PEPPER;
  if (dedicated) return dedicated;
  if (process.env.NODE_ENV === "production") throw new Error("TRIAL_CLAIM_PEPPER nao definida: obrigatoria em producao para o anti-abuso do trial (SPEC-065).");
  const fallback = process.env.AUTH_SECRET;
  if (!fallback) throw new Error("TRIAL_CLAIM_PEPPER/AUTH_SECRET ausente: nao e possivel calcular o anti-abuso do trial.");
  return fallback;
}

/** minusculas, sem `+tag`, sem pontos em gmail.com/googlemail.com (googlemail normalizado para gmail.com). */
export function canonicalEmail(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at <= 0) return e;
  let local = e.slice(0, at);
  let domain = e.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (domain === "gmail.com" || domain === "googlemail.com") {
    domain = "gmail.com";
    local = local.replace(/\./g, "");
  }
  return `${local}@${domain}`;
}

/** HMAC-SHA256 (chave = pepper) do tipo + chave canonica. */
const sha256 = (s: string): string => createHmac("sha256", pepper()).update(s).digest("hex");

export function emailClaimHash(email: string): string {
  return sha256(`email:${canonicalEmail(email)}`);
}

export function docClaimHash(doc: ParsedDocument): string {
  return sha256(`doc:${canonicalDocumentKey(doc)}`);
}

/** Lista pequena e configuravel (`TRIAL_DISPOSABLE_DOMAINS`, virgulas) de dominios descartaveis; mesmo tratamento do trial ja usado (D-065-19.5). */
const DEFAULT_DISPOSABLE = ["mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "temp-mail.org", "yopmail.com", "trashmail.com", "sharklasers.com", "getnada.com", "dispostable.com"];

export function isDisposableEmailDomain(email: string): boolean {
  const domain = canonicalEmail(email).split("@")[1] ?? "";
  const extra = (process.env.TRIAL_DISPOSABLE_DOMAINS ?? "").split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
  return [...DEFAULT_DISPOSABLE, ...extra].includes(domain);
}

/**
 * Registra os 2 claims (e-mail e documento) NA TRANSACAO do cadastro. `ON CONFLICT DO NOTHING` (skipDuplicates): um conflito nao aborta a
 * transacao do Postgres (sem P2002/500) e os hashes novos continuam registrados. Devolve `true` somente se OS DOIS eram novos (= trial
 * disponivel). Concorrencia: dois cadastros com o mesmo hash — o 2o espera o 1o e le 0 inseridos; exatamente um recebe o trial.
 */
export async function claimTrial(tx: Prisma.TransactionClient, email: string, doc: ParsedDocument): Promise<boolean> {
  const r = await tx.trialClaim.createMany({
    data: [
      { kind: "email", keyHash: emailClaimHash(email) },
      { kind: "doc", keyHash: docClaimHash(doc) },
    ],
    skipDuplicates: true,
  });
  return r.count === 2;
}

/** Teto de trials NOVOS por IP em 24 h (D-065-19.4; Redis quando houver, 059). IP desconhecido (sem cabecalho confiavel) nao e limitado: seria um bucket global. */
export const TRIAL_IP_MAX = 3;
export const trialIpLimiter = new SlidingLimiter(TRIAL_IP_MAX, 24 * 3600_000, 5000, "trial-ip");

export function isKnownIp(ipKey: string): boolean {
  return ipKey !== "unknown" && !ipKey.startsWith("unknown:");
}
