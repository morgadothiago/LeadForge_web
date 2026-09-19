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
    env: testUrl ? { DATABASE_URL: testUrl } : {},
    globalSetup: ["./src/test/global-setup.ts"],
    setupFiles: ["./src/test/setup-guard.ts", "./src/test/setup.ts"],
  },
});
