import { SlidingLimiter } from "@/lib/integrations/rate-limit";

/**
 * SPEC-049: rate limits em memória (por processo; mesma limitação de `auth/rate-limit.ts` — migrar p/ Redis/tabela se
 * escalar para multi-instância). Vivem fora do arquivo "use server" para expor `clearOrgRateLimits` aos testes.
 * Toda tentativa conta (sucesso ou falha) — a barreira é contra força bruta de token/código e spam de e-mail.
 */
const WINDOW = 15 * 60_000;
/** Aceitar convite / entrar por código / pré-visualizar: por usuário (ou e-mail) e por IP. */
export const joinByUserLimiter = new SlidingLimiter(10, WINDOW, 1000, "org-join-user");
export const joinByIpLimiter = new SlidingLimiter(30, WINDOW, 1000, "org-join-ip");
/** Convidar por e-mail: por org+usuário (anti-spam de e-mail) e por e-mail-alvo (anti-assédio). */
export const inviteByActorLimiter = new SlidingLimiter(20, 60 * 60_000, 1000, "org-invite-actor");
export const inviteByTargetLimiter = new SlidingLimiter(5, 24 * 60 * 60_000, 1000, "org-invite-target");
/** Criar organização (cada uma abre um trial). */
export const createOrgLimiter = new SlidingLimiter(5, 60 * 60_000, 1000, "org-create");
/** Signup via convite/código (público). */
export const signupJoinLimiter = new SlidingLimiter(10, 10 * 60_000, 1000, "org-signup-join");

export function clearOrgRateLimits(): void {
  for (const l of [joinByUserLimiter, joinByIpLimiter, inviteByActorLimiter, inviteByTargetLimiter, createOrgLimiter, signupJoinLimiter]) l.clear();
}
