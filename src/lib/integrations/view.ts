import type { IntegrationKind } from "@prisma/client";
import { maskHost } from "./url-guard";
import { INTEGRATION_LABEL, REQUIRES_BASE_URL, TESTABLE, type IntegrationKindName, type IntegrationOrigin } from "./types";

/** Nada aqui contém o valor (nem cifrado nem decifrado). */
export interface IntegrationItemView {
  id: string;
  integration: IntegrationKindName;
  name: string;
  /** Últimos 4 caracteres. */
  hint: string;
  /** "••••1234" */
  hintDisplay: string;
  /** SPEC-069d (M1): `null` em chave da PLATAFORMA (`managedByPlatform`): o tenant ve so `hostMasked`. */
  baseUrl: string | null;
  /** Host mascarado (sem caminho/credenciais); seguro para exibir ao tenant. */
  hostMasked: string | null;
  allowPrivateHost: boolean;
  updatedAt: Date;
  lastTestedAt: Date | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
  /** SPEC-069c: chave da PLATAFORMA (gravada pelo admin); o tenant so ve, nao edita nem remove. */
  managedByPlatform: boolean;
}

export interface IntegrationSummary {
  integration: IntegrationKindName;
  label: string;
  /** db = cadastrada no painel; env = só via .env (fallback, sem revelar valor); none = não configurada. */
  origin: IntegrationOrigin;
  configured: boolean;
  requiresBaseUrl: boolean;
  testAvailable: boolean;
  items: IntegrationItemView[];
}

export const SELECT_ITEM = {
  id: true, integration: true, name: true, hint: true, baseUrl: true, allowPrivateHost: true, updatedAt: true,
  lastTestedAt: true, lastTestOk: true, lastTestError: true, managedByPlatform: true,
} as const;

type Row = {
  id: string; integration: IntegrationKind; name: string; hint: string; baseUrl: string | null; allowPrivateHost: boolean; updatedAt: Date;
  lastTestedAt: Date | null; lastTestOk: boolean | null; lastTestError: string | null; managedByPlatform: boolean;
};

export function toItemView(r: Row): IntegrationItemView {
  // `Row.integration` é o enum Prisma inteiro (inclui os kinds da SPEC-041, sem tela própria ainda); esta view só
  // é chamada pelos 4 kinds de `INTEGRATIONS` (filtro em `listIntegrations`), nunca pelos novos.
  // SPEC-069d (M1): chave da plataforma nunca devolve URL completa nem dica ao navegador do tenant (so host mascarado).
  const platform = r.managedByPlatform;
  return { ...r, integration: r.integration as IntegrationKindName, hint: platform ? "" : r.hint, hintDisplay: platform ? "" : `••••${r.hint}`, baseUrl: platform ? null : r.baseUrl, hostMasked: hostOf(r.baseUrl) };
}

export function summarize(integration: IntegrationKindName, items: IntegrationItemView[], envConfigured: boolean): IntegrationSummary {
  const origin: IntegrationOrigin = items.length ? "db" : envConfigured ? "env" : "none";
  return {
    integration, label: INTEGRATION_LABEL[integration], origin, configured: origin !== "none",
    requiresBaseUrl: REQUIRES_BASE_URL[integration], testAvailable: TESTABLE[integration], items,
  };
}

export const hostOf = (url: string | null | undefined): string | null => {
  if (!url) return null;
  try {
    return maskHost(new URL(url).hostname);
  } catch {
    return null;
  }
};
