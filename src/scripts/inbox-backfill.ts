import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { backfillInbox } from "@/lib/inbox/backfill";

/** `npm run inbox:backfill` — SPEC-068a: preenche a caixa de atendimento com o histórico de Touches de WhatsApp (idempotente; ver `src/lib/inbox/backfill.ts`). */
async function main() {
  console.log(JSON.stringify(await backfillInbox(), null, 2));
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error("inbox:backfill falhou:", e instanceof Error ? e.name : "erro");
  process.exit(1);
});
