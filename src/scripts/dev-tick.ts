import "dotenv/config";

/**
 * `npm run dev:tick`: chama POST /api/cron/tick em loop (só dev). Usa a rota HTTP (não o scheduler direto) para
 * exercitar o mesmo caminho da produção: scheduler + agentes + busca + criativos (SPEC-051). Não imprime segredo.
 * Variáveis: DEV_TICK_INTERVAL_MS (padrão 15000, mínimo 2000), DEV_TICK_URL (padrão http://localhost:3000).
 */
const secret = process.env.CRON_SECRET;
if (process.env.NODE_ENV === "production") {
  console.error("dev:tick é só para desenvolvimento.");
  process.exit(1);
}
if (!secret) {
  console.error("CRON_SECRET ausente no .env.");
  process.exit(1);
}
const base = (process.env.DEV_TICK_URL ?? "http://localhost:3000").replace(/\/$/, "");
const interval = Math.max(2000, Number(process.env.DEV_TICK_INTERVAL_MS) || 15000);
let stop = false;
process.on("SIGINT", () => (stop = true));
process.on("SIGTERM", () => (stop = true));

async function once() {
  try {
    const res = await fetch(`${base}/api/cron/tick`, { method: "POST", headers: { Authorization: `Bearer ${secret}` } });
    const body = (await res.json().catch(() => ({}))) as { status?: string; creatives?: { picked?: number }; error?: string };
    const extra = body.creatives?.picked ? ` criativos=${body.creatives.picked}` : "";
    console.log(`[dev:tick] ${new Date().toLocaleTimeString("pt-BR")} http=${res.status} ${body.status ?? body.error ?? ""}${extra}`);
  } catch {
    console.log(`[dev:tick] ${new Date().toLocaleTimeString("pt-BR")} app fora do ar em ${base}; tentando de novo`);
  }
}

console.log(`[dev:tick] a cada ${interval / 1000}s em ${base} (Ctrl+C para parar)`);
(async () => {
  while (!stop) {
    await once();
    await new Promise((r) => setTimeout(r, interval));
  }
})();
