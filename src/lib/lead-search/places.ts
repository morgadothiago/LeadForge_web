import { z } from "zod";
import type { AxiosInstance } from "axios";
import { createHttpClient } from "@/lib/http";
import { AppError } from "@/lib/errors";
import type { Icp, LeadSource, RawLead, SearchCursor, SearchOptions } from "./types";

export const PLACES_URL = "https://places.googleapis.com";
const FIELDS = "places.id,places.displayName,places.internationalPhoneNumber,places.websiteUri,places.formattedAddress,places.rating,places.userRatingCount,nextPageToken";

const responseSchema = z.object({
  places: z
    .array(
      z.object({
        id: z.string(),
        displayName: z.object({ text: z.string() }).optional(),
        internationalPhoneNumber: z.string().optional(),
        websiteUri: z.string().optional(),
        formattedAddress: z.string().optional(),
        rating: z.number().optional(),
        userRatingCount: z.number().optional(),
      }),
    )
    .optional(),
  nextPageToken: z.string().min(1).optional(),
});

const GENERIC_SUFFIXES = ["empresas", "serviços", "melhores"];

/** SPEC-060: variações determinísticas da query (base, uma por keyword, sufixos genéricos), sem duplicatas. */
export function queryVariants(icp: Icp): string[] {
  const join = (...p: (string | null | undefined)[]) => p.filter(Boolean).join(" ");
  const list = [
    join(icp.niche, ...icp.keywords.slice(0, 2), icp.location),
    ...icp.keywords.map((k) => join(icp.niche, k, icp.location)),
    ...GENERIC_SUFFIXES.map((s) => join(icp.niche, s, icp.location)),
  ];
  return [...new Set(list)];
}

/** Uma instância axios por integração; a chave vai só em header do servidor e nunca no erro. */
export function createPlacesClient(apiKey: string, adapter?: Parameters<typeof createHttpClient>[0]["adapter"]): AxiosInstance {
  return createHttpClient({
    name: "Busca de leads (Places)",
    baseURL: PLACES_URL,
    timeout: 20_000,
    headers: { "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": FIELDS, "content-type": "application/json" },
    retry: { maxAttempts: 3 },
    maxRedirects: 0,
    adapter,
  });
}

export class PlacesSource implements LeadSource {
  readonly id = "google_places";
  constructor(private readonly client: AxiosInstance) {}

  async search(icp: Icp, limit: number, signal?: AbortSignal, opts: SearchOptions = {}) {
    const variants = queryVariants(icp);
    const n = variants.length;
    const cur = opts.cursor;
    let variant = 0;
    let pageToken: string | null = null;
    if (cur && variants[cur.variant % n] === cur.query) {
      // Cursor válido para a ICP atual: continua a paginação; sem token, avança para a próxima variação.
      if (cur.pageToken) { variant = cur.variant % n; pageToken = cur.pageToken; }
      else variant = (cur.variant + 1) % n;
    } // ICP mudou: reinicia na variação 0.
    const maxRequests = Math.max(1, opts.maxRequests ?? 1);
    let requests = 0;
    const call = async (query: string, token: string | null) => {
      requests++;
      if (opts.progress) opts.progress.requests = requests;
      // Text Search só lê: repetir é seguro (idempotent).
      const res = await this.client.post("/v1/places:searchText", { textQuery: query, languageCode: "pt-BR", regionCode: "BR", pageSize: Math.min(limit, 20), ...(token ? { pageToken: token } : {}) }, { idempotent: true, signal });
      const parsed = responseSchema.safeParse(res.data);
      if (!parsed.success) throw new AppError({ code: "upstream", userMessage: "Resposta inesperada da busca de leads (Places)." });
      return parsed.data;
    };
    let data;
    let query = variants[variant]!;
    try {
      data = await call(query, pageToken);
    } catch (e) {
      if (!pageToken || !(e instanceof AppError) || e.code !== "validation") throw e;
      // Token inválido/expirado: tenta a próxima variação só se o orçamento permitir; senão encerra sem estourar o teto.
      const next = (variant + 1) % n;
      if (requests >= maxRequests) return { leads: [] as RawLead[], requests, cursor: { variant, pageToken: null, query } };
      variant = next;
      query = variants[variant]!;
      pageToken = null;
      data = await call(query, null);
    }
    const nextCursor: SearchCursor = { variant, pageToken: data.nextPageToken ?? null, query };
    const leads: RawLead[] = (data.places ?? []).slice(0, limit).flatMap((p) => {
      const name = p.displayName?.text?.trim();
      if (!name) return [];
      return [{ externalId: p.id, name, company: name, phone: p.internationalPhoneNumber ?? null, email: null, website: p.websiteUri ?? null, address: p.formattedAddress ?? null, rating: p.rating ?? null, ratingCount: p.userRatingCount ?? null }];
    });
    return { leads, requests, cursor: nextCursor };
  }
}
