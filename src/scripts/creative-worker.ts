import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { processCreativeJobs } from "@/lib/creatives/runner";

/**
 * `npm run creatives:dev` — SOMENTE DESENVOLVIMENTO: em dev o tick não roda sozinho, então o criativo fica "Na fila".
 * Este worker processa APENAS os jobs de criativos a cada 4 s (não dispara sequências, e-mails nem WhatsApp como o
 * tick completo). Em produção quem faz isso é o cron (`/api/cron/tick`). Ctrl+C para parar.
 */
if (process.env.NODE_ENV === "production") {
  console.error("creatives:dev não deve rodar em produção.");
  process.exit(1);
}
const INTERVAL_MS = 4000;
let stop = false;
process.on("SIGINT", () => { stop = true; });
process.on("SIGTERM", () => { stop = true; });

async function main() {
  console.log(`creatives:dev ativo (a cada ${INTERVAL_MS / 1000}s). Ctrl+C para parar.`);
  while (!stop) {
    try {
      const r = await processCreativeJobs(new Date());
      if (r.picked) console.log(new Date().toISOString(), "criativos:", JSON.stringify(r));
    } catch (e) {
      console.error("creatives:dev erro:", e instanceof Error ? e.name : "erro");
    }
    await new Promise((res) => setTimeout(res, INTERVAL_MS));
  }
  await prisma.$disconnect();
}
void main();
