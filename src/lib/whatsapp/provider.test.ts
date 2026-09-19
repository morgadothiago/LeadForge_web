import "dotenv/config";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildWebhookUrl, getWhatsAppProvider } from "./provider";
import { _setCacheTtl } from "@/lib/integrations/config";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("provider factory", () => {
  it("grep: nenhum import de providers/evolution fora da factory, do próprio arquivo e do teste", () => {
    const allowed = ["src/lib/whatsapp/provider.ts", "src/lib/whatsapp/providers/evolution.ts", "src/lib/whatsapp/providers/evolution.test.ts", "src/lib/whatsapp/provider.test.ts"];
    const root = process.cwd();
    const offenders = walk(path.join(root, "src"))
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .filter((f) => !allowed.includes(path.relative(root, f)))
      .filter((f) => /providers\/evolution|from ["']\.\/evolution["']/.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => path.relative(root, f))).toEqual([]);
  });
  it("evolution -> provider resolvido (env como fallback); sem config -> AppError config na chamada; kind desconhecido -> erro síncrono", async () => {
    const old = { u: process.env.EVOLUTION_API_URL, k: process.env.EVOLUTION_API_KEY };
    try {
      process.env.EVOLUTION_API_URL = "http://evo.test";
      process.env.EVOLUTION_API_KEY = "k";
      expect(typeof getWhatsAppProvider("evolution").getStatus).toBe("function");
      delete process.env.EVOLUTION_API_KEY;
      _setCacheTtl(0);
      await expect(getWhatsAppProvider("evolution").getStatus("x")).rejects.toThrow(/não configurada/);
      expect(() => getWhatsAppProvider("cloud_api" as never)).toThrow(/não suportado/);
    } finally {
      _setCacheTtl(null);
      if (old.u === undefined) delete process.env.EVOLUTION_API_URL; else process.env.EVOLUTION_API_URL = old.u;
      if (old.k === undefined) delete process.env.EVOLUTION_API_KEY; else process.env.EVOLUTION_API_KEY = old.k;
    }
  });
  it("buildWebhookUrl usa APP_BASE_URL, senão AUTH_URL, sem barra final", () => {
    const i = { webhookToken: "tok_AB-12" };
    expect(buildWebhookUrl(i, { APP_BASE_URL: "https://a.com/", AUTH_URL: "http://x" })).toBe("https://a.com/api/webhooks/whatsapp/tok_AB-12");
    expect(buildWebhookUrl(i, { AUTH_URL: "http://x" })).toBe("http://x/api/webhooks/whatsapp/tok_AB-12");
    expect(() => buildWebhookUrl(i, {})).toThrow();
  });
});
