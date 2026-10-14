// Recria o webhook de DEV do AbacatePay apontando para APP_BASE_URL (usado por scripts/dev-tunnel.sh).
// Lê .env, nunca imprime a chave nem o segredo. Só mexe em webhooks de nome `leadforge-dev` em modo teste.
import { readFileSync } from "node:fs";

const NAME = "leadforge-dev";
const EVENTS = ["subscription.completed", "subscription.renewed", "subscription.payment_failed", "subscription.cancelled", "transparent.completed"];
const API = "https://api.abacatepay.com/v2";

const env = {};
for (const line of readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const { ABACATEPAY_API_KEY: key, ABACATEPAY_WEBHOOK_SECRET: secret, APP_BASE_URL: base } = env;
if (!key || !secret || !base) {
  console.error("Faltam ABACATEPAY_API_KEY, ABACATEPAY_WEBHOOK_SECRET ou APP_BASE_URL no .env.");
  process.exit(1);
}
if (!base.startsWith("https://")) {
  console.error("APP_BASE_URL precisa ser HTTPS público (o túnel).");
  process.exit(1);
}

const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
const call = async (path, init) => {
  const res = await fetch(`${API}${path}`, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) throw new Error(`${path} -> ${res.status} ${typeof body.error === "string" ? body.error : ""}`.trim());
  return body;
};

const list = await call("/webhooks/list");
const old = (list.data ?? []).filter((w) => w.name === NAME && w.devMode === true);

const created = await call("/webhooks/create", {
  method: "POST",
  body: JSON.stringify({ name: NAME, secret, endpoint: `${base}/api/billing/webhook?webhookSecret=${secret}`, events: EVENTS }),
});
for (const w of old) await call(`/webhooks/delete?id=${encodeURIComponent(w.id)}`, { method: "POST" });

console.log(`Webhook ${NAME} (${created.data.id}) -> ${base}/api/billing/webhook | ${old.length} antigo(s) removido(s).`);
