// Recria o banco de TESTE do zero (drop + create + migrate + seed). Recusa qualquer nome que não termine em _test
// ou que seja igual ao do banco de dev. Nunca toca o banco de dev.
import "dotenv/config";
import { createDbIfMissing, dropDb, migrateAndSeed } from "../test/db-admin";
import { assertSameServerOrConfirmed, dbNameFromUrl, deriveTestUrl, isTestDbName } from "../test/db-guard";

async function main() {
  const target = deriveTestUrl();
  const name = dbNameFromUrl(target);
  const devName = dbNameFromUrl(process.env.DATABASE_URL);
  if (!target || !isTestDbName(name)) {
    console.error(`Recusado: o banco-alvo "${name || "indefinido"}" não termina em _test.`);
    process.exit(1);
  }
  if (name === devName) {
    console.error(`Recusado: o banco-alvo "${name}" é o mesmo do banco de dev.`);
    process.exit(1);
  }
  assertSameServerOrConfirmed(target);
  await dropDb(target);
  await createDbIfMissing(target);
  migrateAndSeed(target);
  console.log(`banco de teste "${name}" recriado (migrate + seed).`);
}
main().catch((e) => {
  console.error(String(e.message ?? e));
  process.exit(1);
});
