// Trava de segurança dos testes: nunca rodar contra um banco que não seja de teste.
// Nenhuma função aqui imprime credenciais; só o NOME do banco pode aparecer em mensagens.

export function dbNameFromUrl(url: string | undefined): string {
  if (!url) return "";
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    return "";
  }
}

export function isTestDbName(name: string): boolean {
  return /^[A-Za-z0-9_]+_test$/.test(name);
}

export function assertTestDatabase(url: string | undefined): void {
  const name = dbNameFromUrl(url);
  if (!isTestDbName(name)) {
    throw new Error(
      `Recusando rodar testes contra banco que não é de teste (banco: "${name || "indefinido"}"). ` +
        `O nome do banco em DATABASE_URL deve terminar em "_test".`,
    );
  }
}

/** host:porta (sem credenciais); "" se a URL for inválida. */
export function hostPortFromUrl(url: string | undefined): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    return `${u.hostname.toLowerCase()}:${u.port || "5432"}`;
  } catch {
    return "";
  }
}

/**
 * O banco de teste deve estar no MESMO servidor (host:porta) do DATABASE_URL de dev; outro servidor só com
 * confirmação explícita `TEST_DB_ALLOW_OTHER_HOST=1` (evita apontar TEST_DATABASE_URL para um servidor alheio cujo banco se chame *_test).
 * Sem DATABASE_URL de referência não há o que comparar (passa).
 */
export function assertSameServerOrConfirmed(testUrl: string | undefined, env: Record<string, string | undefined> = process.env): void {
  const dev = hostPortFromUrl(env.DATABASE_URL);
  if (!dev) return;
  const test = hostPortFromUrl(testUrl);
  if (test === dev) return;
  if (env.TEST_DB_ALLOW_OTHER_HOST === "1") return;
  throw new Error(
    `Recusando: o banco de teste está em outro servidor (${test || "indefinido"}) que o do DATABASE_URL (${dev}). ` +
      `Se for intencional, defina TEST_DB_ALLOW_OTHER_HOST=1.`,
  );
}

/** URL com outro nome de banco (mesmo host/credenciais; só troca o path). */
export function withDbName(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

/** TEST_DATABASE_URL tem precedência; senão troca o nome do banco do DATABASE_URL por `<nome>_test` (idempotente). */
export function deriveTestUrl(env: Record<string, string | undefined> = process.env): string | undefined {
  if (env.TEST_DATABASE_URL) return env.TEST_DATABASE_URL;
  if (!env.DATABASE_URL) return undefined;
  const name = dbNameFromUrl(env.DATABASE_URL);
  if (!name) return undefined;
  return isTestDbName(name) ? env.DATABASE_URL : withDbName(env.DATABASE_URL, `${name}_test`);
}
