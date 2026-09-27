import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { purgeCanceledOrgs } from "@/lib/billing/purge";

/**
 * `npm run billing:purge` — execução manual do job de expurgo (SPEC-033, D-33-4). Já roda automaticamente
 * a cada rodada do scheduler (`run-tick.ts`); este script existe para rodar sob demanda (ex.: verificação
 * manual, ambiente sem cron configurado).
 */
async function main() {
  const r = await purgeCanceledOrgs(new Date());
  console.log(JSON.stringify(r, null, 2));
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error("billing:purge falhou:", e instanceof Error ? e.message : "erro");
  process.exit(1);
});
