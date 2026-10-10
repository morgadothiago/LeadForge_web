import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { backfillLastOrgId } from "@/lib/org/backfill";

/** `npm run org:backfill-last` — SPEC-049: preenche `User.lastOrgId` (idempotente; ver `src/lib/org/backfill.ts`). */
async function main() {
  console.log(JSON.stringify(await backfillLastOrgId(), null, 2));
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error("org:backfill-last falhou:", e instanceof Error ? e.message : "erro");
  process.exit(1);
});
