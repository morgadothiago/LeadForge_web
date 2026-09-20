import { z } from "zod";
import type { AxiosInstance } from "axios";
import { createHttpClient } from "@/lib/http";
import { AppError } from "@/lib/errors";
import type { Icp, LeadSource, RawLead } from "./types";

export const PLACES_URL = "https://places.googleapis.com";
const FIELDS = "places.id,places.displayName,places.internationalPhoneNumber,places.websiteUri,places.formattedAddress,places.rating,places.userRatingCount";

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
});

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

  async search(icp: Icp, limit: number) {
    const query = [icp.niche, ...icp.keywords.slice(0, 2), icp.location].filter(Boolean).join(" ");
    // Text Search só lê: repetir é seguro (idempotent).
    const res = await this.client.post("/v1/places:searchText", { textQuery: query, languageCode: "pt-BR", regionCode: "BR", pageSize: Math.min(limit, 20) }, { idempotent: true });
    const parsed = responseSchema.safeParse(res.data);
    if (!parsed.success) throw new AppError({ code: "upstream", userMessage: "Resposta inesperada da busca de leads (Places)." });
    const leads: RawLead[] = (parsed.data.places ?? []).slice(0, limit).flatMap((p) => {
      const name = p.displayName?.text?.trim();
      if (!name) return [];
      return [{ externalId: p.id, name, company: name, phone: p.internationalPhoneNumber ?? null, email: null, website: p.websiteUri ?? null, address: p.formattedAddress ?? null, rating: p.rating ?? null, ratingCount: p.userRatingCount ?? null }];
    });
    return { leads, requests: 1 };
  }
}
