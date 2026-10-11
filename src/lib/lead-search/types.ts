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
/** SPEC-060: cursor da paginação. `pageToken` null = páginas da variação esgotadas (próxima busca avança de variação). */
export interface SearchCursor {
  variant: number;
  pageToken: string | null;
  query: string;
}
export interface SearchOptions {
  cursor?: SearchCursor | null;
  /** Teto de chamadas pagas desta busca (o orçamento restante entregue pela reserva). Padrão 1. */
  maxRequests?: number;
  /** Contador mutável: a fonte incrementa a cada chamada paga feita, para o chamador contabilizar mesmo se `search` lançar. */
  progress?: { requests: number };
}
export interface LeadSource {
  readonly id: string;
  /** Faz no máximo `limit` resultados; `requests` informa quantas chamadas pagas foram feitas; `cursor` = onde a próxima busca continua. */
  search(icp: Icp, limit: number, signal?: AbortSignal, opts?: SearchOptions): Promise<{ leads: RawLead[]; requests: number; cursor?: SearchCursor | null }>;
}
