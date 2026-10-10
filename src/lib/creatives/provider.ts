import type { CreativeAspectRatio, CreativeAvatar, CreativeLanguage, CreativeVoice } from "./types";

/**
 * SPEC-051 (D-051-1) — abstracao do provedor de video com avatar (mesmo padrao de `StorageProvider`/`PaymentProvider`).
 * Chamadores NUNCA importam `providers/*`: sempre `getAvatarVideoProvider()` (`factory.ts`). Um adapter real futuro
 * (HeyGen/D-ID/Synthesia/Azure...) implementa esta interface e e registrado na factory; chave por env, so server-side (D-051-2).
 *
 * Erros: o adapter lanca `AppError` (`@/lib/errors`) — `retryable` decide se o runner tenta de novo; nunca coloque
 * corpo cru/segredo em `userMessage`.
 */
export interface CreateVideoInput {
  script: string;
  avatarId: string;
  voiceId: string;
  language: CreativeLanguage;
  aspectRatio: CreativeAspectRatio;
  /** Duracao maxima/estimada em segundos. */
  durationSec: number;
  /** `creative:{id}:run:{n}`: o provedor DEVE tratar a mesma chave como a mesma criacao (sem cobrar 2x). */
  idempotencyKey: string;
}

export type ProviderVideoState =
  | { state: "processing"; progressPct?: number; rawStatus?: string }
  | { state: "done"; durationSec?: number; costCents?: number; rawStatus?: string }
  | { state: "failed"; rawStatus?: string };

export interface ProviderVideoStream {
  body: AsyncIterable<Uint8Array>;
  contentType: string;
}

export interface AvatarVideoProvider {
  readonly name: string;
  listAvatars(): Promise<CreativeAvatar[]>;
  listVoices(): Promise<CreativeVoice[]>;
  /** Custo estimado (centavos) para a duracao informada; 0 no mock. */
  estimateCostCents(durationSec: number): number;
  /** Cria a geracao e devolve o id do job no provedor. Idempotente por `idempotencyKey`. */
  createVideo(input: CreateVideoInput): Promise<{ providerJobId: string }>;
  getStatus(providerJobId: string): Promise<ProviderVideoState>;
  /**
   * Abre o video pronto como stream (nunca carregar inteiro em memoria).
   *
   * REQUISITOS OBRIGATORIOS para QUALQUER adapter real (D-051-15; pre-requisito para ligar um provider real). A URL de
   * download vem do provedor e e tratada como NAO CONFIAVEL (SSRF):
   *  1. so `https:`;
   *  2. allowlist do host do provedor (e do CDN dele), nunca host arbitrario vindo da resposta;
   *  3. apos resolver o DNS, bloquear IP privado/loopback/link-local (169.254.x.x, metadados cloud), IPv6 equivalentes, e
   *     conectar no IP ja validado (pinning) — reaproveitar `assertAllowedHost`/`classifyIp`/`pinnedAgents` de
   *     `src/lib/integrations/url-guard.ts` e o cliente `src/lib/http` (aceita `httpsAgent`/`maxRedirects`);
   *  4. a cada redirect, revalidar (1-3) e limitar o numero de redirects (ex.: <= 3);
   *  5. timeout de conexao e de inatividade (o runner ja aplica inatividade no stream: `RunnerDeps.downloadIdleMs`, 30 s);
   *  6. validar `content-type` (video/mp4) antes de devolver o stream; o tamanho e limitado por `STORAGE_MAX_FILE_BYTES`
   *     e os magic bytes pelo `uploadFile` (SPEC-050).
   */
  fetchVideo(providerJobId: string): Promise<ProviderVideoStream>;
  /** Cancelamento best-effort no provedor. */
  cancel?(providerJobId: string): Promise<void>;
  /** Esqueleto OPCIONAL de webhook (Q-051-4): sem rota nesta SPEC; so verifica a autenticidade de um payload. */
  verifyWebhook?(headers: Record<string, string>, rawBody: string): boolean;
}
