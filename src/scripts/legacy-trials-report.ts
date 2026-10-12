import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { buildLegacyTrialsReport } from "@/lib/billing/legacy-trials-report";

/**
 * `npm run billing:trials-report` — SPEC-062 (D-062-17, politica A). SOMENTE LEITURA: lista as assinaturas por status e as orgs
 * hoje em `trialing` (vigente / vencido / sem data) do banco apontado por DATABASE_URL. Nao altera NENHUM dado e nao ha `--apply`:
 * a decisao sobre os trials existentes e da Q-062-2 (usuario). Rode no ambiente que quer inspecionar (ex.: producao) ANTES de a
 * 062a ir ao ar, pois a regra nova suspende trial vencido/sem data (antes nunca expirava).
 */
async function main() {
  const report = await buildLegacyTrialsReport(prisma, new Date());
  console.log(JSON.stringify(report, null, 2));
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error("billing:trials-report falhou:", e instanceof Error ? e.message : "erro");
  process.exit(1);
});
