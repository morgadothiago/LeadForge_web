import "dotenv/config";
import { defineConfig } from "vitest/config";
import path from "node:path";
import { deriveTestUrl } from "./src/test/db-guard";

// Testes rodam SEMPRE contra o banco `<nome>_test` (SPEC-020); TEST_DATABASE_URL tem precedência.
const testUrl = deriveTestUrl();

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    fileParallelism: false,
    // SPEC-030/031 passaram a varrer (`sweepAlerts`) 1x por Organization ATIVA do banco de teste
    // compartilhado (cross-tenant, por design). O numero de orgs so cresce a medida que specs
    // acrescentam fixtures (`createTestOrg`/`mkMeetingFixture`) — testes que fazem varias varreduras
    // sequenciais numa unica `it` (ex. meeting-reminders.test.ts) ficavam no limite do timeout padrao
    // de 5000ms, e ocasionalmente furavam por variacao normal de latencia (flakiness). Timeout maior
    // da margem real sem mascarar hangs genuinos (ainda finito e bem abaixo do teto de push, 15s).
    testTimeout: 15_000,
    hookTimeout: 15_000,
    env: testUrl ? { DATABASE_URL: testUrl } : {},
    globalSetup: ["./src/test/global-setup.ts"],
    setupFiles: ["./src/test/setup-guard.ts", "./src/test/setup.ts"],
  },
});
