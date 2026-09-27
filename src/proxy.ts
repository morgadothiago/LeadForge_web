import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/config";
import { verifySessionToken } from "@/lib/auth/session-token";

/**
 * Guarda de rotas (Next 16 "proxy", antigo middleware): checagem OTIMISTA (assinatura/expiração do JWT).
 * A autorização real continua em requireUser() nas actions/queries.
 * Fora da guarda: /login, / (landing publica, SPEC-035), /signup (signup self-service, SPEC-034), /esqueci-senha e /redefinir-senha (recuperacao de senha, publicas por design — o publico-alvo e justamente quem esta deslogado; SPEC-038), /api/webhooks/* (segredo próprio, SPEC-012), /api/cron/* (Bearer CRON_SECRET, SPEC-013), /api/integrations/* (Bearer INGEST_SECRET, SPEC-014), /api/mobile/v1/* (auth própria no handler: Bearer mobile, 401 JSON, nunca redirect; SPEC-021), _next/static, _next/image e arquivos exatos de /public (PUBLIC_FILES).
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const session = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);

  if (
    pathname === "/login" ||
    pathname === "/" ||
    pathname === "/signup" ||
    pathname === "/esqueci-senha" ||
    pathname === "/redefinir-senha" ||
    session
  )
    return NextResponse.next();

  const url = new URL("/login", request.url);
  url.searchParams.set("next", pathname + search);
  return NextResponse.redirect(url);
}

/**
 * Isenções: somente assets estáticos reais e exatos de /public (literal estático exigido pelo Next; nenhuma
 * isenção por extensão genérica). Ao adicionar arquivo em /public, liste-o aqui.
 */
export const config = {
  matcher: ["/((?!api/webhooks(?:/|$)|api/cron(?:/|$)|api/integrations(?:/|$)|api/mobile/v1(?:/|$)|_next/static/|_next/image(?:/|$|\\?)|(?:favicon\\.ico|file\\.svg|globe\\.svg|next\\.svg|vercel\\.svg|window\\.svg)$).*)"],
};
