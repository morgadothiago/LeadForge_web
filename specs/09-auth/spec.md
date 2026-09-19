# SPEC-009 — Autenticacao
- status: IMPLEMENTED (2026-09-19) | domain: fullstack | sessao: 2 (recomendo antecipar; ver D14) | ordem: 10 | depende de: SPEC-001, SPEC-003
## Contexto
PROMPT tem NEXTAUTH_SECRET/URL mas nenhum fluxo. Uso interno de agencia. `User.role` existe sem `passwordHash`.
## [DECIDIDO D14] Estrategia: opcao 2 (sessao propria, login por e-mail e senha)
Decisao do usuario: sessao propria com cookie JWT httpOnly (`jose`) + hash de senha argon2. Sem Auth.js. Escopo aprovado como abaixo.

### Opcoes consideradas
1. Auth.js (NextAuth v5) Credentials — padrao; vars AUTH_SECRET (v5) diferem das do PROMPT.
2. Sessao propria (cookie JWT com `jose` + bcrypt/argon2) — menos dependencia, mais codigo.
3. Sem auth (rede interna/VPN) — nao recomendado; webhooks e actions expostos.
Impacto: adiciona `passwordHash` ao User; protege todas as rotas (proxy/middleware do Next 16 — ler docs, nome pode ter mudado para `proxy`).
## Escopo (apos decisao)
Tela /login (PT-BR), logout, guarda de rotas `(app)`, `requireUser()` real substituindo o mock, seed de admin via env, rate limit basico de login. Webhooks (SPEC-012) ficam FORA da guarda e usam segredo proprio.
## Criterios de aceite
- [x] Rota do app sem sessao redireciona para /login; com sessao acessa.
- [x] Credenciais invalidas -> mensagem generica; senha hasheada no banco.
- [x] `/api/webhooks/*` nao exigem sessao.
- [x] Todas as Server Actions chamam `requireUser()` (grep/teste).
- [x] build/lint/typecheck OK.

## Backend (implementado 2026-09-19; frontend implementado 2026-09-19)
**Arquivos:** `src/lib/auth/{config,password,session-token,session,require-user,safe-redirect,rate-limit}.ts`, `src/lib/actions/auth.ts`, `src/lib/schemas/auth.ts`, `src/proxy.ts`, seed em `prisma/seed.ts` (`seedAdmin`), helpers de teste `src/lib/auth/test-helpers.ts` + `src/test/setup.ts`, testes `src/lib/auth/auth.test.ts`. Migration `user_password_hash` (`User.passwordHash String?`).

**Sessão:** JWT HS256 (`jose`, `AUTH_SECRET` 32+ chars), `sub`=userId, expira em 7 dias (`SESSION_TTL_SECONDS`). Cookie `lf_session`: httpOnly, sameSite=lax, secure em produção, path=/. Stateless: logout só remove o cookie (token roubado vale até expirar). Senha: argon2id (`@node-rs/argon2`, m=19456,t=2,p=1).

**API (Server Actions em `@/lib/actions/auth`, públicas, sem requireUser):**
- `login(input: { email: string; password: string; next?: string }): Promise<ActionResult<{ redirectTo: string }>>` — erros de campo (`email`, `password`) PT-BR; falha de credenciais: `errors._form = ["E-mail ou senha inválidos."]` (genérica; tempo constante via hash dummy); e-mail trim+lowercase; `redirectTo` = `next` só se caminho interno (`safeNext`; rejeita `//x`, `/\x`, URLs absolutas, `/login`), senão `"/"`. Rate limit: 5 falhas/15 min por e-mail+IP (em memória, por processo; em multi-instância cada instância conta separado e reinicia no deploy) -> `_form: ["Muitas tentativas. Aguarde alguns minutos e tente novamente."]`.
- `logout(): Promise<ActionResult<{ redirectTo: string }>>` (`"/login"`).
- O frontend chama a action e, em `ok`, navega com `router.replace(data.redirectTo)` (as actions NÃO fazem `redirect()`).
- `getSession(): Promise<{userId}|null>`; `requireUser(): Promise<CurrentUser>` (mesma assinatura; valida cookie e relê o usuário; lança `UnauthorizedError`).

**Rota de login esperada:** `/login` (lê `?next=`; ao montar, o frontend repassa `next` no input de `login`). O proxy (`src/proxy.ts`, Next 16) redireciona sem sessão válida para `/login?next=<path+query>`; deixa passar `/login`, `/_next/*`, `favicon`, estáticos e `/api/webhooks/*`. Checagem final continua em `requireUser()`.

**Env:** `AUTH_SECRET` (obrigatório, min 32), `ADMIN_EMAIL`, `ADMIN_PASSWORD` (min 12; opcionais — sem senha o seed pula com aviso). `AUTH_URL` opcional (não usado).
**Admin em dev:** definir `ADMIN_EMAIL`/`ADMIN_PASSWORD` no `.env` e rodar `npm run db:seed` (upsert idempotente por e-mail; atualiza a senha).
**Testes:** `signInAs()/signInAsSeedAdmin()` (sessão JWT real via mock de `next/headers`); teste garante que toda action em `src/lib/actions` (exceto `auth.ts`) chama `requireUser`.

## Implementation Notes (frontend)
- Arquivos: `src/app/login/page.tsx` (fora de `(app)`, noindex, `getSession`/`requireUser` -> redirect "/"), `src/components/auth/{LoginForm,LogoutButton}.tsx`, `src/app/(app)/layout.tsx` (requireUser; UnauthorizedError -> redirect("/login")), `src/app/(app)/error.tsx`, `Header.tsx`/`MobileNav.tsx` (usuario + Sair).
- Verificado: typecheck, lint, test (149) e build OK; curl em `npm run start`: `/` e `/leads` sem cookie -> 307 /login?next=..., `/login` 200 com form/noindex/autocomplete, `/api/webhooks/x` 404 sem redirect.
- NOT VERIFIED: login real via POST de Server Action e navegacao autenticada (Header/Sair) — sem verificacao automatizada de browser; cobertura do backend em auth.test.ts.
- Limitacao: em producao o Next sanitiza erros de Server Components; deteccao por nome/mensagem em error.tsx so funciona em dev. Em prod o layout `(app)` redireciona, e o error.tsx oferece link "Entrar novamente". `/design` e estatica (protegida pelo proxy).

## Implementation Notes (correções do QA de segurança, 2026-09-19)
- **M1** Rate limit em duas camadas (`src/lib/auth/rate-limit.ts`): e-mail+IP 5 falhas/15 min e só e-mail 20 falhas/15 min (não burlável por rotação de IP). Backoff progressivo: na chave e-mail+IP, a partir da 3ª falha bloqueia por min(2^(n-2) s, 60 s); na chave e-mail, a partir da 10ª falha (mesma fórmula). Mensagem PT-BR genérica inalterada. `getClientIp()` (`src/lib/auth/client-ip.ts`) IGNORA `x-forwarded-for`; usa só o cabeçalho de `TRUSTED_PROXY_IP_HEADER` (ex.: `x-real-ip`, `cf-connecting-ip`); sem a env -> "unknown". **Configurar atrás de proxy/CDN:** definir a env com o cabeçalho que o proxy sobrescreve (nunca um repassado do cliente). Documentado em `.env.example`.
- **M2** Store com teto duro `MAX_ENTRIES=10000` (FIFO) e varredura de expiradas a cada escrita; testado.
- **M3** `src/proxy.ts` matcher agora isenta só `api/webhooks`, `_next/static/`, `_next/image` e arquivos exatos (`favicon.ico`, `file|globe|next|vercel|window.svg`). O Next exige matcher literal estático (não aceita valor computado): novos arquivos em `/public` devem ser listados manualmente. Testes: /leads/abc.png, /campanhas/x.svg, /sequences/x.txt, /pipeline.js protegidos; /_next/static/x.js, /favicon.ico, /login, /api/webhooks/x passam.
- **B1** Todas as funções `async` exportadas de `src/lib/queries/*.ts` chamam `requireUser()` primeiro; `(app)/page.tsx` idem (só a chamada). Teste estático garante a ordem. `dashboard.test.ts` agora usa `signInAsSeedAdmin()`.
- **B4** Testes adicionados: token expirado, outro segredo, alg none; `safeNext` com `%2f%2f`, espaço/tab/newline iniciais, `javascript:`. `safeNext` passou a rejeitar também `%2f`/`%5c`/controles codificados no path (endurecimento conservador).
- **B3 (risco aceito, não implementado):** sessão stateless; logout só remove o cookie e não há revogação server-side (token vale até 7 dias).
- Verificado: prisma validate, tsc, lint, test (160), build OK; curl em `next start` sem cookie: /leads/abc.png, /campanhas/x.svg, /pipeline -> 307 /login; /login 200; /api/webhooks/x 404 (sem redirect). Servidor encerrado.
- Limitação: rate limit continua por processo (em memória).
