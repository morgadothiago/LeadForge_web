import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = path.resolve(__dirname, "../../../n8n/workflows");
const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
const load = (f: string) => ({ raw: readFileSync(path.join(DIR, f), "utf8"), wf: JSON.parse(readFileSync(path.join(DIR, f), "utf8")) });

type Node = { name: string; type: string; typeVersion: number; position: number[]; parameters: Record<string, unknown>; credentials?: Record<string, { name: string; id?: string }> };

describe("workflows n8n (validação estática; importação real PENDENTE)", () => {
  it("existem tick.json e ingest-leads-example.json", () => {
    expect(files).toEqual(expect.arrayContaining(["tick.json", "ingest-leads-example.json"]));
  });
  for (const f of files) {
    it(`${f}: estrutura, conexões e nós reais`, () => {
      const { wf } = load(f);
      expect(typeof wf.name).toBe("string");
      expect(Array.isArray(wf.nodes) && wf.nodes.length).toBeGreaterThan(1);
      expect(wf.settings).toBeTypeOf("object");
      expect(wf.active).toBe(false);
      const names = new Set<string>();
      for (const n of wf.nodes as Node[]) {
        expect(n.name && n.type && n.typeVersion && n.position?.length === 2 && n.parameters).toBeTruthy();
        expect(["n8n-nodes-base.scheduleTrigger", "n8n-nodes-base.httpRequest", "n8n-nodes-base.manualTrigger", "n8n-nodes-base.code"]).toContain(n.type);
        expect(names.has(n.name)).toBe(false);
        names.add(n.name);
      }
      for (const [from, c] of Object.entries<{ main: { node: string }[][] }>(wf.connections)) {
        expect(names.has(from)).toBe(true);
        for (const out of c.main) for (const t of out) expect(names.has(t.node)).toBe(true);
      }
    });
    it(`${f}: sem segredo, Bearer literal ou URL com credencial; credencial por NOME`, () => {
      const { raw, wf } = load(f);
      expect(raw).not.toMatch(/Bearer\s+\S/i);
      expect(raw).not.toMatch(/https?:\/\/[^\s"/]*:[^\s"/]*@/);
      expect(raw).not.toMatch(/(CRON_SECRET|INGEST_SECRET)\s*[=:]\s*["']?[A-Za-z0-9_-]{16,}/);
      expect(raw).not.toMatch(/[A-Za-z0-9_-]{40,}/); // nenhum token longo embutido
      const http = (wf.nodes as Node[]).filter((n) => n.type === "n8n-nodes-base.httpRequest");
      expect(http.length).toBeGreaterThan(0);
      for (const n of http) {
        expect(String(n.parameters.url)).toContain("{{ $env.LEADFORGE_URL }}");
        expect(n.parameters.method).toBe("POST");
        expect(n.parameters.genericAuthType).toBe("httpHeaderAuth");
        const cred = n.credentials?.httpHeaderAuth;
        expect(cred?.name).toMatch(/^LeadForge (CRON|INGEST)_SECRET$/);
        expect(cred).not.toHaveProperty("id");
        expect(JSON.stringify(n.parameters)).not.toMatch(/authorization/i);
      }
    });
  }
  it("tick: Schedule 1 min -> POST /api/cron/tick", () => {
    const { wf } = load("tick.json");
    const t = (wf.nodes as Node[]).find((n) => n.type === "n8n-nodes-base.scheduleTrigger")!;
    expect(JSON.stringify(t.parameters)).toContain('"minutesInterval":1');
    expect(JSON.stringify(wf.nodes)).toContain("/api/cron/tick");
  });
  it("ingestão: Manual -> Code -> POST /api/integrations/leads com retry", () => {
    const { wf } = load("ingest-leads-example.json");
    const nodes = wf.nodes as (Node & { retryOnFail?: boolean })[];
    const http = nodes.find((n) => n.type === "n8n-nodes-base.httpRequest")!;
    expect(String(http.parameters.url)).toContain("/api/integrations/leads");
    expect(http.retryOnFail).toBe(true);
    expect(nodes.map((n) => n.type)).toEqual(expect.arrayContaining(["n8n-nodes-base.manualTrigger", "n8n-nodes-base.code"]));
  });
});
