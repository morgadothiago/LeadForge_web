import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { prisma } from "@/lib/prisma";
import { parseKey, reencryptAllSecrets } from "@/lib/crypto/reencrypt";

/**
 * `npm run secrets:reencrypt` (dry-run) | `npm run secrets:reencrypt -- --apply`.
 * Chaves NUNCA por argumento: env `OLD_ENCRYPTION_KEY`/`NEW_ENCRYPTION_KEY` ou `--stdin` (2 linhas: antiga, nova). Imprime só contagens.
 * Depois de aplicar, troque ENCRYPTION_KEY no ambiente para a NOVA e reinicie o app.
 */
async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  let oldRaw = process.env.OLD_ENCRYPTION_KEY;
  let newRaw = process.env.NEW_ENCRYPTION_KEY;
  if (args.includes("--stdin")) {
    const rl = createInterface({ input: process.stdin });
    const lines: string[] = [];
    for await (const l of rl) lines.push(l);
    [oldRaw, newRaw] = lines;
  }
  const r = await reencryptAllSecrets(prisma, parseKey(oldRaw, "Chave antiga"), parseKey(newRaw, "Chave nova"), { dryRun: !apply });
  console.log(JSON.stringify(r, null, 2));
  if (!apply) console.log("Dry-run: nada foi gravado. Use --apply para gravar.");
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error("secrets:reencrypt falhou:", e instanceof Error ? e.message : "erro");
  process.exit(1);
});
