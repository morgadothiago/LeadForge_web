import { Client } from "pg";

/**
 * Lock global do scheduler.
 * Escolha: `pg_try_advisory_lock` (sessão) numa conexão `pg` DEDICADA, fora do pool do adapter-pg do Prisma. Motivos:
 *  - o lock de sessão pertence à conexão; o pool do Prisma reparte queries entre conexões, então lock+unlock por ele seria
 *    imprevisível (unlock em outra conexão = no-op, lock vazado). Aqui lock e liberação ocorrem SEMPRE no mesmo Client;
 *  - `pg_try_advisory_xact_lock` exigiria manter uma transação interativa aberta por ~50 s (timeout padrão do Prisma: 5 s) e
 *    ocuparia uma conexão do pool;
 *  - se o processo morrer, o Postgres libera o lock ao derrubar a conexão (sem lock órfão).
 */
export const TICK_LOCK_KEY = "7301301301";

export interface TickLock {
  release(): Promise<void>;
}
export type AcquireLock = () => Promise<TickLock | null>;

export const acquirePgAdvisoryLock: AcquireLock = async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  client.on("error", () => {}); // erro assíncrono da conexão ociosa não pode derrubar o processo
  await client.connect();
  try {
    const r = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1::bigint) AS ok", [TICK_LOCK_KEY]);
    if (!r.rows[0]?.ok) {
      await client.end().catch(() => {});
      return null;
    }
  } catch (e) {
    await client.end().catch(() => {});
    throw e;
  }
  return {
    async release() {
      try {
        await client.query("SELECT pg_advisory_unlock($1::bigint)", [TICK_LOCK_KEY]);
      } finally {
        await client.end().catch(() => {}); // fechar a conexão também libera o lock de sessão
      }
    },
  };
};
