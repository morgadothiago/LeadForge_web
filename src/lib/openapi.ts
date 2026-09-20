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
    "/summary": planned("dashboard", "Resumo do painel (SPEC-022)", ref("Generic")),
    "/pipeline": planned("dashboard", "Funil por etapa (SPEC-022)", ref("Generic")),
    "/campaigns": planned("campaigns", "Campanhas (SPEC-022)", { type: "array", items: ref("Generic") }, { parameters: paging }),
    "/campaigns/{id}": planned("campaigns", "Campanha (SPEC-022)", ref("Generic"), { parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }] }),
    "/whatsapp/instances": planned("health", "Instâncias WhatsApp (SPEC-022)", { type: "array", items: ref("Generic") }),
    "/scheduler": planned("health", "Estado do scheduler (SPEC-022)", ref("Generic")),
    "/agents/queue": planned("agents", "Fila de agentes (SPEC-022)", ref("Generic")),
    "/lead-search/runs": planned("lead-search", "Execuções de busca (SPEC-022)", { type: "array", items: ref("Generic") }, { parameters: paging }),
    "/alerts": planned("alerts", "Alertas (SPEC-023)", { type: "array", items: ref("Generic") }, { parameters: paging }),
  },
};
