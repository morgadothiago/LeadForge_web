import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto/secret-box";
import { safeErrorForLog } from "@/lib/errors";

/**
 * Leitura de credenciais por-org armazenadas em `IntegrationSecret` (SPEC-018/030) para os `IntegrationKind`
 * da SPEC-041 (`google_ads_leads`, `meta_leads`). Deliberadamente à parte de `src/lib/integrations/config.ts`
 * (camada usada pela tela de Configurações > Integrações, D-041-4 — cartões novos ficam para a rodada de
 * dev-frontend): aqui só é preciso ler, nunca há fallback de `.env` nem cache de UI. Nunca loga o valor decifrado.
 */
export async function readIntegrationSecretValue(orgId: string, integration: "google_ads_leads" | "meta_leads", name: string): Promise<string | null> {
  const row = await prisma.integrationSecret.findUnique({
    where: { orgId_integration_name: { orgId, integration, name } },
    select: { encryptedValue: true },
  });
  if (!row) return null;
  try {
    return decrypt(row.encryptedValue);
  } catch (e) {
    console.error("[lead-source] falha ao decifrar segredo:", safeErrorForLog(e));
    return null;
  }
}

/** Nome de `IntegrationSecret` do Page Access Token de uma Página do Meta (por org, por página). */
export const metaPageTokenName = (pageId: string): string => `page:${pageId}`.slice(0, 40);
