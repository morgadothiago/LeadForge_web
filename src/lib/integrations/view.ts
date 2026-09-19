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
  baseUrl: string | null;
  allowPrivateHost: boolean;
  updatedAt: Date;
  lastTestedAt: Date | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
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
  lastTestedAt: true, lastTestOk: true, lastTestError: true,
} as const;

type Row = {
  id: string; integration: IntegrationKind; name: string; hint: string; baseUrl: string | null; allowPrivateHost: boolean; updatedAt: Date;
  lastTestedAt: Date | null; lastTestOk: boolean | null; lastTestError: string | null;
};

export function toItemView(r: Row): IntegrationItemView {
  return { ...r, hintDisplay: `••••${r.hint}` };
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
