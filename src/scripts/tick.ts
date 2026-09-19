import "dotenv/config";
import { runTick } from "@/lib/scheduler/run-tick";
import { prisma } from "@/lib/prisma";

/** `npm run tick`: uma rodada do scheduler direto (dev). Imprime só contadores (sem PII/segredo). Exit 1 se a rodada falhar. */
async function main() {
  const s = await runTick(new Date());
  console.log(JSON.stringify({ status: s.status, skipped: s.skipped ?? null, durationMs: s.durationMs, budget: s.budget, counters: s.counters, error: s.error ?? null }, null, 2));
  await prisma.$disconnect();
  process.exit(s.status === "error" ? 1 : 0);
}
main().catch((e) => {
  console.error("tick falhou:", e instanceof Error ? e.message : "erro");
  process.exit(1);
});
