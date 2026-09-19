import { createDbIfMissing, migrateAndSeed } from "./db-admin";
import { assertSameServerOrConfirmed, assertTestDatabase, deriveTestUrl } from "./db-guard";

export default async function setup() {
  const url = deriveTestUrl();
  assertTestDatabase(url);
  assertSameServerOrConfirmed(url);
  await createDbIfMissing(url!);
  migrateAndSeed(url!);
}
