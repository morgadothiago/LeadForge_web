/** SPEC-015: contrato de fonte de leads. Só fontes com API OFICIAL (sem scraping). */
export interface Icp {
  niche: string;
  location: string | null;
  keywords: string[];
}
export interface RawLead {
  externalId: string;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  rating: number | null;
  ratingCount: number | null;
}
export interface LeadSource {
  readonly id: string;
  /** Faz no máximo `limit` resultados; `requests` informa quantas chamadas pagas foram feitas. */
  search(icp: Icp, limit: number): Promise<{ leads: RawLead[]; requests: number }>;
}
