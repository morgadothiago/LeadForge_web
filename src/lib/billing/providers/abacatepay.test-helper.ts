import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from "axios";
import { z } from "zod";

/**
 * SPEC-063 — API falsa do AbacatePay para testes (NUNCA chama a rede). Os esquemas `z.strictObject` abaixo espelham o OpenAPI oficial
 * (docs.abacatepay.com, 2026-10-11): QUALQUER campo extra/ausente nos corpos que o adapter envia falha — e a regressao do 422.
 * Respostas no formato REAL validado em dev mode em 2026-10-12.
 */

export const subscriptionsCreateSchema = z.strictObject({
  items: z.array(z.strictObject({ id: z.string().min(1), quantity: z.number().int().min(1) })).length(1),
  methods: z.array(z.enum(["CARD", "PIX", "BOLETO"])).optional(),
  returnUrl: z.string().min(1).optional(),
  completionUrl: z.string().min(1).optional(),
  customerId: z.string().optional(),
  coupons: z.array(z.string()).optional(),
  externalId: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  card: z.strictObject({ maxInstallments: z.number().int().optional() }).optional(),
  retryPolicy: z.strictObject({ maxRetry: z.number().int().min(1).max(10), retryEvery: z.number().int().min(1).max(30) }).optional(),
});

export const productsCreateSchema = z.strictObject({
  externalId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  price: z.number().int().positive(),
  currency: z.literal("BRL"),
  cycle: z.enum(["WEEKLY", "MONTHLY", "QUARTERLY", "SEMIANNUALLY", "ANNUALLY"]).optional(),
  trialDays: z.number().int().optional(),
});

export const transparentsCreateSchema = z.strictObject({
  method: z.literal("PIX"),
  data: z.strictObject({
    amount: z.number().int().positive(),
    description: z.string().regex(/^[\x20-\x7e]*$/, "so ASCII").optional(),
    expiresIn: z.number().int().optional(),
    externalId: z.string().optional(),
    customer: z.strictObject({ name: z.string().min(1), taxId: z.string().min(1), email: z.string().optional(), cellphone: z.string().optional() }).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    ensureSameTaxId: z.boolean().optional(),
    utm: z.unknown().optional(),
  }),
});

export interface RecordedCall {
  method: string;
  path: string;
  params: Record<string, unknown>;
  body: unknown;
  authorization: string | null;
}
export interface FakeResponse { status: number; data: unknown }
export type Handler = (call: RecordedCall) => FakeResponse | Promise<FakeResponse>;

export interface FakeApi {
  adapter: AxiosAdapter;
  calls: RecordedCall[];
  products: Map<string, Record<string, unknown>>;
  /** Substitui o comportamento de "METODO /path" (ex.: "POST /products/create"). */
  override: (route: string, h: Handler | null) => void;
  /** Chamadas a uma rota. */
  callsTo: (route: string) => RecordedCall[];
}

let seq = 0;
const rid = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(seq++).toString(36)}`.padEnd(prefix.length + 25, "x");

export function fakeAbacateApi(opts: { devMode?: boolean } = {}): FakeApi {
  const devMode = opts.devMode ?? true;
  const calls: RecordedCall[] = [];
  const products = new Map<string, Record<string, unknown>>();
  const overrides = new Map<string, Handler>();

  const defaults: Record<string, Handler> = {
    "GET /products/list": (c) => {
      const ext = c.params.externalId;
      const data = [...products.values()].filter((p) => !ext || p.externalId === ext);
      return { status: 200, data: { success: true, data, error: null, pagination: { hasMore: false, next: null, before: null } } };
    },
    "POST /products/create": (c) => {
      const parsed = productsCreateSchema.safeParse(c.body);
      if (!parsed.success) return { status: 422, data: { success: false, data: null, error: "Value should be one of 'object'" } };
      if (products.has(parsed.data.externalId)) return { status: 400, data: { success: false, data: null, error: "Product with externalId already exists" } };
      const p = { id: rid("prod"), description: "", imageUrl: null, hasFile: false, devMode, status: "ACTIVE", cycle: null, trialDays: null, ...parsed.data };
      products.set(parsed.data.externalId, p);
      return { status: 200, data: { success: true, data: p, error: null } };
    },
    "POST /subscriptions/create": (c) => {
      const parsed = subscriptionsCreateSchema.safeParse(c.body);
      if (!parsed.success) return { status: 422, data: { success: false, data: null, error: "Property 'items' is missing" } };
      const id = rid("bill");
      return {
        status: 200,
        data: { success: true, error: null, data: { id, externalId: parsed.data.externalId ?? null, url: `https://app.abacatepay.com/pay/${id}`, status: "PENDING", devMode, items: parsed.data.items, methods: parsed.data.methods ?? ["CARD"], metadata: parsed.data.metadata ?? null } },
      };
    },
    "POST /transparents/create": (c) => {
      const parsed = transparentsCreateSchema.safeParse(c.body);
      if (!parsed.success) return { status: 422, data: { success: false, data: null, error: "Value should be one of 'object', 'object', 'object'" } };
      const id = rid("pix_char");
      return { status: 200, data: { success: true, error: null, data: { id, amount: parsed.data.data.amount, status: "PENDING", devMode, brCode: "00020101021126580014", brCodeBase64: "data:image/png;base64,iVBORw0K", expiresAt: "2026-10-13T02:31:19.902Z", metadata: {} } } };
    },
    "POST /transparents/simulate-payment": (c) => ({ status: 200, data: { success: true, error: null, data: { id: c.params.id, status: "PAID", devMode } } }),
  };

  const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
    const method = (config.method ?? "get").toUpperCase();
    const path = (config.url ?? "").split("?")[0]!;
    const body = typeof config.data === "string" && config.data ? JSON.parse(config.data) : config.data;
    const call: RecordedCall = { method, path, params: (config.params ?? {}) as Record<string, unknown>, body, authorization: (config.headers.get("Authorization") as string | null) ?? null };
    calls.push(call);
    const route = `${method} ${path}`;
    const handler = overrides.get(route) ?? defaults[route];
    const res: FakeResponse = handler ? await handler(call) : { status: 404, data: { success: false, data: null, error: "Not found" } };
    const full = { data: res.data, status: res.status, statusText: "", headers: {}, config, request: {} };
    if (res.status < 300) return full;
    throw new AxiosError(`Request failed ${res.status}`, "ERR_BAD_RESPONSE", config, {}, full);
  };

  return {
    adapter, calls, products,
    override: (route, h) => (h ? overrides.set(route, h) : overrides.delete(route)),
    callsTo: (route) => calls.filter((c) => `${c.method} ${c.path}` === route),
  };
}
