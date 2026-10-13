import { createHash } from "node:crypto";
import { AppError } from "@/lib/errors";
import { MOCK_DEMO_VIDEO } from "./mock-video";
import { MOCK_DEMO_VIDEO_LUCIANA } from "./mock-video-luciana";
import type { AvatarVideoProvider, CreateVideoInput, ProviderVideoState, ProviderVideoStream } from "../provider";
import type { CreativeAvatar, CreativeVoice } from "../types";

/**
 * SPEC-051 (D-051-1) — adapter `mock`: padrao do projeto (sem chave, custo zero, NUNCA rede). Catalogo fixo (D-051-3) e
 * "video" placeholder DETERMINISTICO (MP4 real de 4 s, SPEC-051c), servido em stream.
 *
 * Idempotencia: o id do job deriva do `idempotencyKey` (mesma chave => mesmo id, sem nova "cobranca"). O tempo de
 * criacao fica num Map em memoria do processo; id desconhecido (processo novo) conta como ja concluido.
 * Diretivas de teste no roteiro (so o mock as interpreta): `[[mock:fail]]` o provedor reporta falha;
 * `[[mock:hang]]` o job nunca termina (exercita timeout); `[[mock:reject]]` o provedor recusa o roteiro (nao retentavel);
 * `[[mock:unavailable]]` a criacao falha como indisponibilidade retentavel.
 */
export const MOCK_AVATARS: CreativeAvatar[] = [
  { id: "mock-ana", name: "Ana (mock)" },
    { id: "mock-clara", name: "Clara (mock)" },
  { id: "mock-luciana", name: "Luciana (mock)" },
];
export const MOCK_VOICES: CreativeVoice[] = [
  { id: "mock-voz-br-f", name: "Voz feminina pt-BR (mock)", language: "pt-BR", gender: "female" },
  { id: "mock-voz-br-m", name: "Voz masculina pt-BR (mock)", language: "pt-BR", gender: "male" },
  { id: "mock-voice-en-f", name: "Female voice en (mock)", language: "en", gender: "female" },
  { id: "mock-voice-en-m", name: "Male voice en (mock)", language: "en", gender: "male" },
];

const FLAG = { ok: "n", fail: "f", hang: "h" } as const;
const CHUNK = 512;

export interface MockOptions {
  delayMs: number;
  now?: () => number;
}

export class MockAvatarVideoProvider implements AvatarVideoProvider {
  readonly name = "mock";
  /** Contadores de chamadas (testes: "retry nao duplica", "nunca chama provedor real"). */
  readonly stats = { create: 0, status: 0, fetch: 0, cancel: 0 };
  private delayMs: number;
  private readonly now: () => number;
  private readonly created = new Map<string, number>();
  private readonly canceled = new Set<string>();
  /** Testes: faz o proximo `fetchVideo` falhar como erro de rede retentavel. */
  failNextFetch = false;
  /** Testes: faz os proximos N `getStatus` falharem de forma retentavel (indisponibilidade). */
  failNextStatus = 0;

  constructor(opts: MockOptions) {
    this.delayMs = opts.delayMs;
    this.now = opts.now ?? Date.now;
  }

  withDelay(ms: number): this {
    this.delayMs = ms;
    return this;
  }

  async listAvatars(): Promise<CreativeAvatar[]> {
    return MOCK_AVATARS.map((a) => ({ ...a }));
  }
  async listVoices(): Promise<CreativeVoice[]> {
    return MOCK_VOICES.map((v) => ({ ...v }));
  }
  estimateCostCents(): number {
    return 0;
  }

  async createVideo(input: CreateVideoInput): Promise<{ providerJobId: string }> {
    this.stats.create++;
    if (input.script.includes("[[mock:unavailable]]")) {
      throw new AppError({ code: "upstream", userMessage: "Provedor de vídeo indisponível.", status: 503, retryable: true });
    }
    if (input.script.includes("[[mock:reject]]") || !MOCK_AVATARS.some((a) => a.id === input.avatarId) || !MOCK_VOICES.some((v) => v.id === input.voiceId)) {
      throw new AppError({ code: "validation", userMessage: "O provedor recusou a solicitação.", status: 422 });
    }
    const flag = input.script.includes("[[mock:fail]]") ? FLAG.fail : input.script.includes("[[mock:hang]]") ? FLAG.hang : FLAG.ok;
    const variant = input.avatarId === "mock-luciana" ? "l" : "a"; // avatar Luciana => clipe do Magic Hour
    const id = `mock_${createHash("sha256").update(input.idempotencyKey).digest("hex").slice(0, 16)}${variant}_${flag}`;
    if (!this.created.has(id)) this.created.set(id, this.now());
    return { providerJobId: id };
  }

  async getStatus(providerJobId: string): Promise<ProviderVideoState> {
    this.stats.status++;
    if (this.failNextStatus > 0) {
      this.failNextStatus--;
      throw new AppError({ code: "upstream", userMessage: "Provedor de vídeo indisponível.", status: 503, retryable: true });
    }
    if (!/^mock_[0-9a-f]{16}[al]?_[nfh]$/.test(providerJobId)) throw new AppError({ code: "not_found", userMessage: "Job do provedor não encontrado.", status: 404 });
    if (this.canceled.has(providerJobId)) return { state: "failed", rawStatus: "canceled" };
    const flag = providerJobId.slice(-1);
    if (flag === FLAG.hang) return { state: "processing", progressPct: 10, rawStatus: "rendering" };
    if (flag === FLAG.fail) return { state: "failed", rawStatus: "render_error" };
    const start = this.created.get(providerJobId);
    if (start === undefined) return { state: "done", rawStatus: "completed", costCents: 0 };
    const elapsed = this.now() - start;
    if (elapsed >= this.delayMs) return { state: "done", rawStatus: "completed", costCents: 0, durationSec: undefined };
    return { state: "processing", progressPct: Math.max(1, Math.min(99, Math.floor((elapsed / Math.max(1, this.delayMs)) * 100))), rawStatus: "rendering" };
  }

  async fetchVideo(providerJobId: string): Promise<ProviderVideoStream> {
    this.stats.fetch++;
    if (this.failNextFetch) {
      this.failNextFetch = false;
      throw new AppError({ code: "network", userMessage: "Falha de rede ao baixar o vídeo.", retryable: true });
    }
    // MP4 real e pequeno (SPEC-051c): o player do navegador toca o placeholder de demonstracao.
    const video = /^mock_[0-9a-f]{16}l_/.test(providerJobId) ? MOCK_DEMO_VIDEO_LUCIANA : MOCK_DEMO_VIDEO;
    async function* gen(): AsyncGenerator<Uint8Array> {
      for (let off = 0; off < video.length; off += CHUNK) yield video.subarray(off, off + CHUNK);
    }
    return { body: gen(), contentType: "video/mp4" };
  }

  async cancel(providerJobId: string): Promise<void> {
    this.stats.cancel++;
    this.canceled.add(providerJobId);
  }
}
