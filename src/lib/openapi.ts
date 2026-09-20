import type { OpenAPIV3_1 } from "openapi-types";

/**
 * SPEC-021: contrato ÚNICO da API mobile (/api/mobile/v1). Sem campos internos (hash, chaves, telefone/e-mail de lead).
 * Rotas com `x-status: "planned"` são implementadas nas SPECs 022/023/026 (contrato reservado aqui).
 */
const ref = (n: string) => ({ $ref: `#/components/schemas/${n}` });
const env = (schema: object, meta = false) => ({
  type: "object" as const,
  required: ["data"],
  properties: { data: schema, ...(meta ? { meta: ref("PageMeta") } : {}) },
});
const json = (schema: object, example?: unknown) => ({ "application/json": { schema, ...(example ? { example } : {}) } });
const okResp = (description: string, schema: object, example?: unknown) => ({ description, content: json(schema, example) });
const err = (description: string) => ({ description, content: json(ref("Error")) });
const str = { type: "string" as const };
const int = { type: "integer" as const };
const bool = { type: "boolean" as const };
const nullable = (t: string) => ({ type: [t, "null"] });
/** Objeto fechado (additionalProperties:false) com todas as propriedades obrigatorias (SPEC-022). */
const obj = (properties: Record<string, object>) => ({ type: "object" as const, additionalProperties: false, required: Object.keys(properties), properties });
const campaignProps = { id: str, name: str, status: str, sent: int, replies: int, replyRate: nullable("number"), activeLeads: int, nextSendAt: nullable("string") };
const secured = [{ bearerAuth: [] }];
const paging = [
  { name: "limit", in: "query" as const, schema: { type: "integer" as const, minimum: 1, maximum: 50, default: 20 } },
  { name: "cursor", in: "query" as const, schema: { type: "string" as const } },
];
const planned = (tag: string, summary: string, dataSchema: object, extra: object = {}) => ({
  get: {
    tags: [tag], summary, security: secured, "x-status": "planned",
    ...extra,
    responses: { "200": okResp("OK", env(dataSchema)), "401": err("Não autenticado") },
  },
});
const live = (tag: string, summary: string, dataSchema: object, extra: object = {}, paged = false) => ({
  get: {
    tags: [tag], summary, security: secured,
    ...extra,
    responses: { "200": okResp("OK", env(dataSchema, paged)), "400": err("Entrada inválida"), "401": err("Não autenticado"), "404": err("Não encontrado") },
  },
});
const errExample = { error: { code: "invalid_credentials", message: "Credenciais inválidas." } };

export const spec: OpenAPIV3_1.Document = {
  openapi: "3.1.0",
  info: {
    title: "LeadForge Mobile API",
    description: "API de monitoramento (read-mostly) do app LeadForge. Envelope { data, meta? } / { error: { code, message } }. Cache-Control: no-store.",
    version: "1.0.0",
  },
  servers: [{ url: "/api/mobile/v1" }],
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT (aud mobile, 15 min)" } },
    schemas: {
      Error: { type: "object", required: ["error"], properties: { error: { type: "object", required: ["code", "message"], properties: { code: { type: "string" }, message: { type: "string" } } } } },
      PageMeta: { type: "object", properties: { nextCursor: { type: ["string", "null"] } } },
      TokenPair: {
        type: "object", required: ["accessToken", "refreshToken", "expiresIn", "deviceId"],
        properties: {
          accessToken: { type: "string" }, refreshToken: { type: "string" }, expiresIn: { type: "integer", example: 900 }, deviceId: { type: "string", format: "uuid" },
          user: ref("MobileUser"),
        },
      },
      MobileUser: { type: "object", required: ["id", "name", "role"], properties: { id: { type: "string" }, name: { type: "string" }, role: { type: "string" } } },
      Me: { type: "object", required: ["id", "name", "role", "deviceId"], properties: { id: { type: "string" }, name: { type: "string" }, role: { type: "string" }, deviceId: { type: "string" } } },
      Device: {
        type: "object", required: ["id", "name", "platform", "createdAt", "lastSeenAt", "current"],
        properties: {
          id: { type: "string", format: "uuid" }, name: { type: "string" }, platform: { type: "string", enum: ["ios", "android"] },
          appVersion: { type: ["string", "null"] }, createdAt: { type: "string", format: "date-time" }, lastSeenAt: { type: "string", format: "date-time" }, current: { type: "boolean" },
        },
      },
      Revoked: { type: "object", required: ["revoked"], properties: { revoked: { type: "boolean" } } },
      Trend: obj({ percent: nullable("number"), direction: { type: "string", enum: ["up", "down", "flat"] } }),
      Metric: obj({ value: int, previous: int, trend: ref("Trend") }),
      SummaryLimit: obj({ sent: int, limit: int }),
      Summary: obj({
        period: { type: "string", enum: ["7d", "30d"] },
        newLeads: ref("Metric"), contacted: ref("Metric"), replied: ref("Metric"), meetings: ref("Metric"), optOut: ref("Metric"),
        responseRate: obj({ responded: int, contacted: int, rate: nullable("number") }),
        sentToday: obj({ whatsapp: ref("SummaryLimit"), email: ref("SummaryLimit") }),
        failures24h: int,
        attention: obj({ unreadAlerts: int, handoffs: int, pendingDrafts: int }),
      }),
      PipelineStage: obj({ stage: str, label: str, count: int, totalValue: { type: "number" } }),
      CampaignMetrics: obj(campaignProps),
      CampaignDetailMetrics: obj({ ...campaignProps, daily: { type: "array", items: obj({ date: str, sent: int, replies: int }) } }),
      WaAlert: obj({ id: str, kind: str, message: str, createdAt: str, readAt: nullable("string") }),
      WaInstance: obj({
        id: str, instanceName: str, numberMasked: nullable("string"), status: str, health: str, pausedUntil: nullable("string"), pausedReason: nullable("string"),
        warmupDay: nullable("integer"), sentToday: int, effectiveLimitToday: int, warnings: { type: "array", items: str }, alerts: { type: "array", items: ref("WaAlert") },
      }),
      SchedulerState: obj({
        lastRun: { type: ["object", "null"], additionalProperties: false, required: ["id", "startedAt", "finishedAt", "status", "counters", "error"], properties: { id: str, startedAt: str, finishedAt: nullable("string"), status: str, counters: { type: "object", additionalProperties: { type: "number" } }, error: nullable("string") } },
        lastSuccessAt: nullable("string"), stale: bool, lockStuck: bool,
        recentErrors: { type: "array", items: obj({ id: str, startedAt: str, error: nullable("string") }) },
      }),
      Budget: obj({ spentCents: { type: "number" }, budgetCents: nullable("integer"), budgetState: { type: "string", enum: ["ok", "alert", "exhausted", "no_budget"] }, percent: nullable("number") }),
      AgentQueue: obj({
        drafts: obj({ pending: int, oldestAt: nullable("string") }), handoffs: int, killSwitch: bool, budget: ref("Budget"),
        agents: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "name", "role", "active", "spentCents", "budgetCents", "budgetState", "percent"], properties: { id: str, name: str, role: str, active: bool, spentCents: { type: "number" }, budgetCents: nullable("integer"), budgetState: { type: "string", enum: ["ok", "alert", "exhausted", "no_budget"] }, percent: nullable("number") } } },
      }),
      SearchRunItem: obj({ id: str, campaignId: str, source: str, trigger: str, status: str, found: int, created: int, duplicate: int, suppressed: int, invalid: int, error: nullable("string"), startedAt: str, finishedAt: nullable("string") }),
      Generic: { type: "object", additionalProperties: true },
    },
  },
  paths: {
    "/auth/login": {
      post: {
        tags: ["auth"], summary: "Login do dispositivo",
        requestBody: { required: true, content: json({ type: "object", required: ["email", "password", "deviceName", "platform"], properties: { email: { type: "string" }, password: { type: "string" }, deviceName: { type: "string", maxLength: 80 }, platform: { type: "string", enum: ["ios", "android"] }, appVersion: { type: "string" } } }) },
        responses: { "200": okResp("Par de tokens", env(ref("TokenPair"))), "400": err("Entrada inválida"), "401": { description: "Credenciais inválidas (genérico)", content: json(ref("Error"), errExample) }, "429": err("Rate limit (Retry-After)") },
      },
    },
    "/auth/refresh": {
      post: {
        tags: ["auth"], summary: "Rotaciona o refresh token (o anterior deixa de valer; reuso revoga o dispositivo)",
        requestBody: { required: true, content: json({ type: "object", required: ["deviceId", "refreshToken"], properties: { deviceId: { type: "string", format: "uuid" }, refreshToken: { type: "string" } } }) },
        responses: { "200": okResp("Novo par", env(ref("TokenPair"))), "400": err("Entrada inválida"), "401": err("Refresh inválido/expirado/reusado"), "429": err("Rate limit (Retry-After)") },
      },
    },
    "/auth/logout": { post: { tags: ["auth"], summary: "Revoga o dispositivo atual", security: secured, responses: { "200": okResp("OK", env(ref("Revoked"))), "401": err("Não autenticado") } } },
    "/auth/me": { get: { tags: ["auth"], summary: "Usuário e dispositivo atuais", security: secured, responses: { "200": okResp("OK", env(ref("Me"))), "401": err("Não autenticado / token_expired") } } },
    "/devices": {
      get: { tags: ["devices"], summary: "Dispositivos ativos do usuário", security: secured, parameters: paging, responses: { "200": okResp("OK", env({ type: "array", items: ref("Device") }, true)), "400": err("cursor/limit inválido"), "401": err("Não autenticado") } },
    },
    "/devices/{id}": {
      delete: { tags: ["devices"], summary: "Revoga remotamente um dispositivo", security: secured, parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": okResp("OK", env(ref("Revoked"))), "401": err("Não autenticado"), "404": err("Não encontrado") } },
    },
    "/summary": live("dashboard", "Resumo do painel (SPEC-022)", ref("Summary"), { parameters: [{ name: "period", in: "query" as const, schema: { type: "string" as const, enum: ["7d", "30d"], default: "7d" } }] }),
    "/pipeline": live("dashboard", "Funil por etapa (SPEC-022)", { type: "array", items: ref("PipelineStage") }),
    "/campaigns": live("campaigns", "Campanhas com metricas (SPEC-022)", { type: "array", items: ref("CampaignMetrics") }, { parameters: [{ name: "status", in: "query" as const, schema: { type: "string" as const, enum: ["active", "paused", "archived"], default: "active" } }, ...paging] }, true),
    "/campaigns/{id}": live("campaigns", "Campanha com serie diaria 7d (SPEC-022)", ref("CampaignDetailMetrics"), { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }] }),
    "/whatsapp/instances": live("health", "Instancias WhatsApp (numero mascarado; SPEC-022)", { type: "array", items: ref("WaInstance") }),
    "/scheduler": live("health", "Estado do scheduler (SPEC-022)", ref("SchedulerState")),
    "/agents/queue": live("agents", "Fila de agentes e orcamento (SPEC-022)", ref("AgentQueue")),
    "/lead-search/runs": live("lead-search", "Execucoes de busca (SPEC-022)", { type: "array", items: ref("SearchRunItem") }, { parameters: paging }, true),
    "/alerts": planned("alerts", "Alertas (SPEC-023)", { type: "array", items: ref("Generic") }, { parameters: paging }),
  },
};
