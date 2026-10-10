// @vitest-environment node
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }), usePathname: () => "/criativos" }));
vi.mock("@/lib/actions/creative", () => ({
  createCreativeDraft: vi.fn(), submitCreative: vi.fn(), cancelCreative: vi.fn(), retryCreative: vi.fn(), deleteCreative: vi.fn(),
  getCreative: vi.fn(), getCreativeVideoUrl: vi.fn(), listCreatives: vi.fn(), listAvatarsAndVoices: vi.fn(),
}));

import { CreativeLibrary } from "./CreativeLibrary";
import { CreativeWizard } from "./CreativeWizard";
import { CreativeDetail } from "./CreativeDetail";
import { CreativeStatusBadge } from "./CreativeStatusBadge";
import { NAV_ITEMS } from "@/components/layout/nav-items";
import type { AvatarsAndVoices, CreativeDetailView, CreativeView } from "@/lib/creatives/types";

const now = new Date("2026-10-11T12:00:00Z");
const view = (o: Partial<CreativeView> = {}): CreativeView => ({
  id: "c1", title: "Apresentação clínicas", status: "draft", script: "Olá, tudo bem?", language: "pt-BR", avatarRef: "av1", voiceRef: "v1", aspectRatio: "9:16",
  durationSec: 12, hasVideo: false, videoFileId: null, thumbnailFileId: null, error: null, submittedAt: null, createdAt: now, updatedAt: now, job: null, ...o,
});
const detail = (o: Partial<CreativeView> = {}): CreativeDetailView => ({ ...view(o), jobs: [] });
const info = (o: Partial<AvatarsAndVoices> = {}): AvatarsAndVoices => ({
  provider: "mock",
  avatars: [{ id: "av1", name: "Ana" }, { id: "av2", name: "Bruno" }],
  voices: [{ id: "v1", name: "Voz BR", language: "pt-BR", gender: "female" }, { id: "v2", name: "Voice EN", language: "en" }],
  limits: { maxDurationSec: 120, maxScriptChars: 3000, maxConcurrentJobsPerOrg: 2, maxPerMonthPerOrg: 20 },
  usage: { usedThisMonth: 3, activeNow: 0 },
  ...o,
});

describe("sidebar", () => {
  it("tem o item Criativos", () => {
    expect(NAV_ITEMS.find((i) => i.href === "/criativos")?.label).toBe("Criativos");
  });
});

describe("CreativeLibrary", () => {
  const filters = {};
  it("grid com status, link e aviso do mock", () => {
    const html = renderToStaticMarkup(<CreativeLibrary initial={{ items: [view({ status: "ready" }), view({ id: "c2", title: "Outro", status: "failed", error: "O provedor não conseguiu gerar o vídeo." })], nextCursor: "c2" }} filters={filters} info={info()} />);
    expect(html).toContain("Apresentação clínicas");
    expect(html).toContain('href="/criativos/c1"');
    expect(html).toContain("Pronto");
    expect(html).toContain("Falhou");
    expect(html).toContain("O provedor não conseguiu gerar");
    expect(html).toContain("Provedor de demonstração (mock)");
    expect(html).toContain("Carregar mais");
    expect(html).toContain("3 de 20 usados");
  });
  it("sem aviso quando o provedor não é mock", () => {
    const html = renderToStaticMarkup(<CreativeLibrary initial={{ items: [view()], nextCursor: null }} filters={filters} info={info({ provider: "heygen" })} />);
    expect(html).not.toContain("demonstração");
    expect(html).not.toContain("Carregar mais");
  });
  it("vazio sem filtro e com filtro", () => {
    expect(renderToStaticMarkup(<CreativeLibrary initial={{ items: [], nextCursor: null }} filters={filters} info={null} />)).toContain("Nenhum criativo ainda");
    const f = renderToStaticMarkup(<CreativeLibrary initial={{ items: [], nextCursor: null }} filters={{ q: "x", status: "ready" }} info={null} />);
    expect(f).toContain("Nenhum criativo encontrado");
    expect(f).toContain("Limpar filtros");
  });
  it("erro com mensagem do backend e retry", () => {
    const html = renderToStaticMarkup(<CreativeLibrary initial={null} filters={filters} info={null} loadError="Sem permissão." />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Sem permissão.");
    expect(html).toContain("Tentar novamente");
  });
});

describe("CreativeWizard", () => {
  it("abre no passo 1 (roteiro) com contador e passos acessíveis", () => {
    const html = renderToStaticMarkup(<CreativeWizard info={info()} />);
    expect(html).toContain('aria-current="step"');
    expect(html).toContain("Roteiro");
    expect(html).toContain("0 / 3000 caracteres");
    expect(html).toContain("Continuar");
    expect(html).toContain("Provedor de demonstração (mock)");
    expect(html).toContain('for="creative-title"');
  });
  it("sem aviso mock para provedor real", () => {
    expect(renderToStaticMarkup(<CreativeWizard info={info({ provider: "heygen" })} />)).not.toContain("demonstração");
  });
});

describe("CreativeDetail", () => {
  it("rascunho: enviar e excluir, sem cancelar/tentar de novo", () => {
    const html = renderToStaticMarkup(<CreativeDetail initial={detail()} info={info()} />);
    expect(html).toContain("Enviar para geração");
    expect(html).toContain("Excluir");
    expect(html).not.toContain("Cancelar geração");
    expect(html).not.toContain("Tentar novamente");
    expect(html).toContain("Ana");
    expect(html).toContain("Voz BR");
  });
  it("processando: barra de progresso e cancelar", () => {
    const html = renderToStaticMarkup(<CreativeDetail initial={detail({ status: "processing", job: { progressPct: 40 } as never })} info={info()} />);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="40"');
    expect(html).toContain("Cancelar geração");
    expect(html).toContain("Gerando o vídeo… 40%");
  });
  it("falhou: mensagem PT-BR e tentar novamente", () => {
    const html = renderToStaticMarkup(<CreativeDetail initial={detail({ status: "failed", error: "A geração demorou mais que o esperado e foi interrompida. Tente novamente." })} info={null} />);
    expect(html).toContain("demorou mais que o esperado");
    expect(html).toContain("Tentar novamente");
    expect(html).not.toContain("demonstração");
  });
  it("pronto: baixar e área do player", () => {
    const html = renderToStaticMarkup(<CreativeDetail initial={detail({ status: "ready", hasVideo: true, videoFileId: "f1" })} info={info()} />);
    expect(html).toContain("Baixar");
    expect(html).toContain("Carregando vídeo");
    expect(html).toContain("Provedor de demonstração (mock)");
  });
  it("não vaza ids internos", () => {
    const html = renderToStaticMarkup(<CreativeDetail initial={detail({ status: "ready", hasVideo: true, videoFileId: "file-secret-id" })} info={info()} />);
    expect(html).not.toContain("file-secret-id");
  });
});

describe("CreativeStatusBadge", () => {
  it("texto PT-BR por status", () => {
    expect(renderToStaticMarkup(<CreativeStatusBadge status="queued" />)).toContain("Na fila");
    expect(renderToStaticMarkup(<CreativeStatusBadge status="canceled" />)).toContain("Cancelado");
  });
});
