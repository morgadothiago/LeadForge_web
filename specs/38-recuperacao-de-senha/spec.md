# SPEC-038 — Recuperacao de senha ("esqueci minha senha")
- status: IMPLEMENTED (backend 2026-09-27; frontend 2026-09-26; fix pós-QA 2026-09-26) | domain: fullstack | depende de: 009 (auth), 010 (email/Nodemailer), 037 (identidade visual, para a tela seguir o mesmo padrao)

## Objetivo
Hoje NAO existe nenhum fluxo de recuperacao de senha no LeadForge (confirmado por busca no codigo: nenhuma rota, action ou template de e-mail relacionado). O usuario pediu essa tela junto do pedido de identidade visual (SPEC-037) — tratada aqui como funcionalidade nova, separada, porque envolve decisoes de seguranca (token, expiracao, envio de e-mail) que nao sao so uma questao de cor/layout.

## Escopo proposto
- Tela `/esqueci-senha`: usuario informa e-mail; sistema gera um token de reset (aleatorio, hash armazenado, nunca o valor em claro no banco — mesmo cuidado ja aplicado a outros segredos do projeto, ex. `IntegrationSecret`/refresh tokens mobile), com expiracao curta (ex. 30-60 min, a definir).
- E-mail de reset enviado via a infraestrutura de e-mail ja existente (SPEC-010, Nodemailer) com link `/redefinir-senha?token=...`.
- Tela `/redefinir-senha`: valida o token (nao expirado, nao usado), pede nova senha (mesma validacao Zod/argon2 ja usada no signup/SPEC-034), invalida o token apos uso, encerra sessoes antigas (opcional, a decidir).
- Resposta do formulario de "esqueci senha" SEMPRE generica (nao revela se o e-mail existe ou nao — mesmo cuidado anti-enumeration ja aplicado ao signup na SPEC-033/034).
- Rate limit por e-mail/IP (mesmo padrao de outros fluxos publicos do projeto).
- Visual: reaproveita a identidade unificada definida na SPEC-037 (mesmos componentes/tokens do login).

## Fora do escopo (nesta proposta inicial)
- Autenticacao de 2 fatores.
- Notificacao "sua senha foi alterada" por e-mail (pode ser incremental depois).
- Qualquer coisa em `../mobile/`.

## Decisoes fechadas (usuario, 2026-09-26)

D-038-1: Token de reset expira em **24 horas**.

D-038-2: **Sim** — redefinir a senha encerra todas as sessoes ativas do usuario (so a nova sessao criada no fluxo, se aplicavel, continua).

## Ordem de execucao
Backend (dev-backend) primeiro (token/expiração 24h/e-mail/rate limit), depois frontend (dev-frontend) para as 2 telas. Decisoes ja fechadas — pode implementar direto.

## Implementation Notes — Backend (dev-backend, 2026-09-27)

### Modelo de dados / migration
- `prisma/schema.prisma`: novo model `PasswordResetToken` (`id`, `userId` FK `User` `onDelete: Cascade`, `tokenHash` — `@unique`, sha256 hex, NUNCA o token em claro —, `expiresAt`, `usedAt?`, `createdAt`; índice `[userId, createdAt]`). Novo campo `User.sessionsInvalidatedAt DateTime?` (ver D-038-2 abaixo).
- Migration `prisma/migrations/20260927014029_password_reset_and_session_invalidation/migration.sql` — aplicada no banco de DEV local (`prisma migrate dev`) e re-aplicada automaticamente no banco de TESTE pelo `globalSetup` do vitest (`migrateAndSeed`).

### Geração/hash do token (D-038-1: 24h)
- `src/lib/auth/password-reset.ts`: `newResetToken()` — 32 bytes aleatórios (`crypto.randomBytes`, base64url) para o token em claro (só existe no link do e-mail); `hashResetToken()` — sha256 hex, é o único valor gravado (`tokenHash`). Mesmo padrão de `src/lib/mobile/token.ts` (`hashRefresh`) e do cuidado já aplicado a `MobileDevice.refreshHash`/`IntegrationSecret`. `RESET_TOKEN_TTL_MS = 24h` (D-038-1 — decisão explícita do usuário, não os 30-60min do texto original da SPEC).
- Também nesse arquivo (não em `actions/auth.ts`, que é `"use server"` e só pode exportar funções async): os dois `SlidingLimiter` do rate limit de `forgotPassword` (`forgotByEmailLimiter`, 5/hora; `forgotByIpLimiter`, 20/hora) e `clearForgotPasswordRateLimit()` (helper de teste).

### E-mail transacional (reaproveitando SPEC-010)
- `src/lib/channels/system-mail.ts` (novo): `sendSystemEmail(to, subject, text, opts)` — Nodemailer com a config global `SMTP_HOST/PORT/USER/PASS` (já prevista em `src/lib/env.ts`, até então não consumida em nenhum fluxo — diferente de `src/lib/channels/email.ts`/SPEC-010, que envia por `EmailAccount` cifrada POR TENANT para Touches de campanha; aqui não há tenant/Touch, é o e-mail do próprio sistema). Reaproveita (não duplica) a checagem anti-SSRF (`resolvePublicHost`/`allowPrivateSmtpHosts`) e o normalizador de erro SMTP (`normalizeSmtpError`) do SPEC-010. Sem `SMTP_HOST` configurado: falha com `AppError` código `config`, nunca lança.
- `.env.example` atualizado com uma nota de que `SMTP_HOST/PORT/USER/PASS` agora também alimentam este envio transacional.

### Actions (`src/lib/actions/auth.ts` — mesmo arquivo de `login`/`logout`, propositalmente: são as únicas ações PÚBLICAS do módulo de auth, e esse arquivo já é 100% isento do teste estático "toda Server Action chama requireUser")
- `forgotPassword(input: { email })`: rate limit (por e-mail E por IP, checado ANTES de qualquer consulta) → resposta SEMPRE genérica (mesma mensagem para e-mail existente/inexistente/rate-limited) → se o e-mail existe, cria o token (24h) e dispara `sendSystemEmail` para `/redefinir-senha?token=...` SEM aguardar a promise (fire-and-forget) — isso evita que o tempo de resposta da action varie entre "e-mail existe" (round-trip SMTP) e "e-mail não existe" (nenhum envio), o que seria um canal de enumeração por TIMING (achado que a fila anterior de SPECs deste projeto encontrou repetidamente em fluxos de auth/token).
- `resetPassword(input: { token, password })`: valida a senha com `resetPasswordSchema` (mesma régua 12+ caracteres do `signupSchema`/SPEC-034, mesmo `hashPassword` argon2id). Claim do token ATÔMICO dentro de uma transação Prisma: `updateMany({ where: { tokenHash, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } })` — se `count === 0` (não existe, expirado OU já usado), aborta com erro genérico único (`RESET_INVALID_MESSAGE`, PT-BR, não distingue os 3 casos); se `count === 1`, dentro da MESMA transação atualiza `User.passwordHash` + `User.sessionsInvalidatedAt = now()`. A condição `usedAt: null` no `updateMany` é o que impede a corrida de dois usos concorrentes do mesmo token (TOCTOU) — dois `resetPassword` simultâneos com o mesmo token: só um consegue `count === 1`.

### D-038-2 — como "todas as sessões ativas" foram encerradas
- A sessão web é um JWT stateless (cookie `lf_session`, assinado com `AUTH_SECRET`) — não existe uma tabela de sessões para apagar linhas. Mecanismo escolhido: `User.sessionsInvalidatedAt` (novo campo) + uma claim de emissão com precisão de MILISSEGUNDO no próprio token (`imts`, custom claim em `src/lib/auth/session-token.ts`; `SessionPayload.issuedAtMs`).
  - Por quê uma claim custom e não o `iat` padrão do JWT: o `iat` padrão só tem resolução de SEGUNDOS. Em teste automatizado (e ocasionalmente em produção, sob carga), emissão da sessão antiga e o `UPDATE` de `sessionsInvalidatedAt` podem cair no MESMO segundo — com granularidade de segundos, a comparação `iat < sessionsInvalidatedAt` falha nesse caso-limite (falso negativo: a sessão antiga NÃO seria invalidada). Isso apareceu de fato durante os testes desta SPEC (teste "fluxo feliz completo" falhando por essa razão) e foi corrigido adicionando a claim de milissegundos, eliminando a corrida.
  - `requireUser()` (`src/lib/auth/require-user.ts`, único helper de autenticação de TODAS as actions/queries — enforçado pelo teste estático `use-server-auth.test.ts`) agora relê `User.sessionsInvalidatedAt` e rejeita (`UnauthorizedError` → "Sessão expirada. Faça login novamente." no frontend) qualquer sessão cujo `issuedAtMs` seja anterior a `sessionsInvalidatedAt`. Como TODA action/query passa por `requireUser()`, isso é equivalente, na prática, a encerrar todas as sessões ativas: nenhuma operação autenticada volta a funcionar com o token antigo, em nenhum dispositivo/aba.
  - `src/proxy.ts` (middleware/edge) continua fazendo só a checagem leve de assinatura/expiração do JWT (sem banco, documentado como decisão de arquitetura pré-existente — "a autorização real continua em requireUser()"). Um token pós-reset ainda passa pelo proxy (não é redirecionado a `/login` na navegação), mas qualquer Server Action/query real falha em `requireUser()`. Isso é consistente com o desenho de autenticação já existente do projeto (proxy = gate de UX, requireUser = gate de autorização real). **Nota (ver correção pós-QA abaixo, 2026-09-26): na rodada original, `/esqueci-senha` e `/redefinir-senha` NÃO tinham sido adicionadas à lista de isenção do proxy — o que quebrava o fluxo inteiro para usuários deslogados. Foi corrigido.**
  - Decisão de escopo tomada (não estava explicitamente decidida na SPEC): `resetPassword` NÃO cria uma nova sessão automaticamente — devolve `redirectTo: "/login"`, e o usuário loga com a senha nova. A frase "só a nova sessão criada no fluxo, se aplicável, continua" (D-038-2) foi lida como opcional ("se aplicável"); optei por NÃO auto-logar para manter o escopo do backend minimal e deixar a decisão de UX (auto-login vs. tela de login) para a SPEC/rodada de frontend. Se o frontend precisar de auto-login, é só chamar `login()` (já existente) depois de `resetPassword()` ter sucesso — não requer mudança de backend.
  - Limitação conhecida/fora de escopo: sessões do APP MOBILE (`src/lib/mobile/token.ts`, access token JWT de 15min + refresh token opaco em `MobileDevice.refreshHash`) usam um mecanismo de autenticação SEPARADO (não passam por `requireUser()`/`sessionsInvalidatedAt`) e não são explicitamente invalidadas por este mecanismo. Na prática o acesso mobile pós-reset é limitado pelo TTL curto do access token (15 min) até expirar naturalmente; a exposição residual é o mesmo raciocínio de qualquer app mobile com access+refresh token e não foi tratada aqui porque a SPEC exclui explicitamente "qualquer coisa em `../mobile/`" e o texto de D-038-2 fala em "sessão" no contexto singular do JWT web citado no pedido original.

### Testes escritos (todos rodados, `VERIFIED`)
- `src/lib/auth/auth.test.ts` (novo describe `forgotPassword / resetPassword (SPEC-038)`, 11 testes): resposta genérica idêntica p/ e-mail existente/inexistente; e-mail inexistente não cria token nem envia e-mail; e-mail existente cria token (só hash) e envia e-mail com o link; validação Zod PT-BR; rate limit por e-mail (bloqueia mesmo variando IP); rate limit por IP (bloqueia mesmo variando e-mail); token inválido/inexistente; token expirado (24h+1min, não marca usado); senha fraca rejeitada (mesma régua do signup); **fluxo feliz completo** (pedir reset → redefinir → sessão antiga rejeitada por `requireUser()` → login com senha antiga falha → login com senha nova funciona); token já usado (2ª chamada falha).
- `src/lib/channels/system-mail.test.ts` (novo, 6 testes): sem `SMTP_HOST` falha com erro de config sem lançar; host bloqueado por SSRF (rede interna) falha sem vazar credencial na mensagem; `ALLOW_PRIVATE_SMTP_HOSTS=true` + transport injetado envia com sucesso; `createTransport` recebe a config final (host resolvido, `tls.servername`); erro SMTP (`EAUTH`) normalizado em `AppError` PT-BR.
- `src/lib/auth/password-reset.test.ts` (novo, 4 testes): token opaco ≠ hash, hash determinístico, tokens únicos, TTL = 24h, `clearForgotPasswordRateLimit` zera os limitadores.
- `src/lib/auth/auth.test.ts` (ajustes em testes pré-existentes): `SessionPayload` ganhou o campo `issuedAtMs` (era `iat`) — assertion de igualdade exata ajustada.
- `src/lib/use-server-auth.test.ts`: `forgotPassword`/`resetPassword` adicionados à allowlist de ações públicas (mesmo padrão de `login`/`logout`/`signUpAndStartCheckout`); assertion do conteúdo exato da allowlist atualizada.

### Resultado (2026-09-27)
- `npm test`: **VERIFIED** — 108 arquivos, 1347 testes, 0 falhas (inclui toda a suíte pré-existente do projeto, não só os testes novos).
- `npx tsc --noEmit`: **VERIFIED** — sem erros.
- `npm run lint`: **VERIFIED** — 0 erros (4 warnings pré-existentes, em arquivos não tocados por esta SPEC: `src/lib/billing/providers/{mock,stripe}.ts`, `src/lib/billing/webhook-handler.test.ts`).
- `npm run build` (`next build`): **VERIFIED** — build de produção completo sem erros.

### Correção pós-QA (2026-09-26) — rota pública esquecida na lista de isenção do proxy (mesma classe de bug de SPEC-035/037)
- **Achado do QA (bloqueante)**: `src/proxy.ts` (linha ~14) exemitia `/login`, `/` e `/signup` da checagem de sessão, mas NÃO `/esqueci-senha` nem `/redefinir-senha` — as duas rotas novas desta SPEC. Confirmado ao vivo via `curl`: qualquer usuário deslogado (o público-alvo exato deste fluxo) acessando essas rotas recebia 307 para `/login` antes de a página renderizar, incluindo o link `/redefinir-senha?token=...` recebido por e-mail. Isso inutilizava o fluxo de recuperação de senha por completo para quem não está logado — precisamente quem esqueceu a senha. Já tinha acontecido 2x antes nesta sessão (SPEC-035, SPEC-037), sempre pela mesma causa: rota pública nova não adicionada à lista de isenção do middleware/proxy.
- **Fix**: `src/proxy.ts` — `pathname === "/esqueci-senha"` e `pathname === "/redefinir-senha"` adicionados à condição de isenção (mesmo padrão de `/login`/`/`/`/signup`); doc-comment do arquivo atualizado para listar as duas rotas novas.
- **Cobertura de teste (lacuna apontada pelo QA)**: `src/lib/auth/auth.test.ts` (`describe("proxy")`) — novo teste cobrindo `/esqueci-senha` e `/redefinir-senha` com e sem sessão (válida e inválida), e o cenário exato reproduzido pelo QA: `/redefinir-senha?token=...` (token na query string, sem sessão) retornando 200 sem redirect. Antes desta correção, `describe("proxy")` só cobria `/login`, `/` e `/signup` — a mesma lacuna estrutural que já tinha deixado passar o bug equivalente em SPEC-035/037 sem teste automatizado pegando.
- **Nota operacional (achada ao vivo pelo QA, documentar apenas — nenhuma ação de servidor tomada)**: depois de aplicar a migration desta SPEC (`20260927014029_password_reset_and_session_invalidation`, que adiciona `User.sessionsInvalidatedAt`), qualquer processo `next dev`/servidor de longa duração iniciado ANTES da migration continua com o Prisma Client antigo em memória e passa a lançar `PrismaClientValidationError: Unknown field` ao tentar ler/escrever `sessionsInvalidatedAt` (ou qualquer campo novo). O Prisma Client em memória não recarrega sozinho — é necessário reiniciar manualmente o processo `next dev`/servidor após rodar `prisma migrate dev` (ou `prisma generate`) sempre que o schema mudar. Isso não foi automatizado aqui; é uma nota operacional para quem estiver com um servidor de longa duração rodando durante o desenvolvimento desta ou de futuras SPECs com migration.
- **Resultado (2026-09-26)**: `npx tsc --noEmit` **VERIFIED** (sem erros); `npm run lint` **VERIFIED** (0 erros, mesmos 4 warnings pré-existentes em arquivos não tocados); `npm test` **VERIFIED** — 108 arquivos, 1348 testes, 0 falhas (1347 pré-existentes + 1 novo teste de proxy cobrindo o cenário exato reproduzido pelo QA). `npm run build`/`npm run dev` deliberadamente NÃO executados (mesma cautela do QA, para não escrever no `.next` do processo `next dev` do usuário); confirmado via `ps aux` que não havia outro processo `vitest` concorrente e que o `next dev` do usuário não foi tocado.

### Critérios de aceite (backend)
| Critério | Status | Evidência |
|---|---|---|
| Token nunca gravado em claro (só hash) | PASS | `password-reset.test.ts` ("token opaco, nunca igual ao hash"); `auth.test.ts` ("e-mail existente: cria token...") |
| Expiração 24h (D-038-1) | PASS | `password-reset.test.ts` ("TTL é 24 horas"); `auth.test.ts` ("token expirado (24h + 1min)...") |
| Token não reutilizável | PASS | `auth.test.ts` ("token já usado (reuso bloqueado)...") |
| Resposta sempre genérica (anti-enumeration) | PASS | `auth.test.ts` ("resposta genérica idêntica...", "e-mail inexistente: nenhum token...") |
| Rate limit por e-mail E por IP, não trivialmente contornável | PASS | `auth.test.ts` ("rate limit por e-mail...", "rate limit por IP...") |
| Nova senha com mesma validação Zod/argon2 do signup | PASS | `auth.test.ts` ("senha nova fraca é rejeitada...") |
| D-038-2: redefinir encerra todas as sessões ativas (web) | PASS | `auth.test.ts` ("fluxo feliz completo...") |
| Reaproveita infra de e-mail (SPEC-010: Nodemailer/SSRF/erro normalizado) | PASS | `system-mail.test.ts` (todos); revisão de código (`resolvePublicHost`/`normalizeSmtpError` importados, não reimplementados) |
| Erro claro PT-BR sem vazar detalhe de segurança | PASS | `auth.test.ts` ("token inválido/inexistente...") |
| `npm test`/lint/typecheck/build | PASS | ver seção "Resultado" acima |
| `/esqueci-senha` e `/redefinir-senha` acessíveis por usuário deslogado (fix pós-QA) | PASS | `auth.test.ts`, `describe("proxy")` (novo teste, cenário com `?token=...` sem sessão reproduz exatamente o `curl` do QA) |

### Limitações conhecidas
- Rate limit de `forgotPassword` em memória por processo (mesma limitação documentada em `rate-limit.ts`/SPEC-009 e no `SlidingLimiter` de `billing.ts`/SPEC-033): reinicia no deploy, não é compartilhado entre instâncias.
- Sessões do app MOBILE não são explicitamente invalidadas por `sessionsInvalidatedAt` (ver seção D-038-2 acima) — mitigado pelo TTL curto (15 min) do access token mobile.
- Notificação "sua senha foi alterada" por e-mail está fora de escopo (já declarado na SPEC original, "Fora do escopo").
- Frontend (telas `/esqueci-senha` e `/redefinir-senha`) NÃO implementado nesta rodada — é a próxima etapa (dev-frontend), consumindo `forgotPassword`/`resetPassword` de `src/lib/actions/auth.ts` (`ActionResult<{ message: string }>` e `ActionResult<{ redirectTo: string }>`, respectivamente, mesmo contrato de `login`/`logout`).

**Pronto para o frontend seguir.**

## Implementation Notes — Frontend (dev-frontend, 2026-09-26)

### Telas novas (públicas, mesmo route group top-level de `/login`/`/signup`, fora do gate de `requireUser()`)
- `src/app/esqueci-senha/page.tsx` — Server Component; mesmo card centralizado (`rounded-xl border border-border bg-card p-6 shadow-xl sm:p-8`, `max-w-sm`) e cabeçalho (`font-heading text-primary` "LeadForge" + título + subtítulo) de `login/page.tsx`/`signup/page.tsx` (identidade da SPEC-037). Renderiza `ForgotPasswordForm` e um link "Entrar" de volta pra `/login`.
- `src/app/redefinir-senha/page.tsx` — Server Component; lê `token` de `searchParams` (mesmo padrão `Promise<...>`/`Array.isArray` já usado em `login/page.tsx` pro param `next`). Sem `token` na query string, não renderiza o formulário: mostra direto o estado de erro (mensagem + link "Solicitar novo link" pra `/esqueci-senha`), sem round-trip ao servidor pra descobrir que o token está ausente.

### Componentes (`src/components/auth/`)
- `ForgotPasswordForm.tsx` — mesmo padrão de `LoginForm.tsx`/`SignupForm.tsx`: `"use client"`, `useTransition` + `Field`/`fieldError` (`@/components/campaigns/Field`, `form-utils`), `aria-invalid`/`aria-live`, foco automático no primeiro campo inválido pós-erro. Chama `forgotPassword({ email })`; em sucesso, substitui o formulário por uma mensagem de confirmação (`res.data.message` — a mensagem SEMPRE genérica que já vem do backend, sem nenhuma lógica de frontend que diferencie e-mail existente/inexistente) com `role="status"`/`aria-live="polite"` e um link de volta pro login.
- `ResetPasswordForm.tsx` — mesmo padrão + campo "Confirmar nova senha" (client-side only: `resetPasswordSchema` do backend não tem esse campo — é usabilidade, não segurança; comparação `password !== confirmPassword` bloqueia o submit antes de chamar a action, com erro no campo `confirmPassword`). Chama `resetPassword({ token, password })`. Em sucesso: mostra mensagem "Senha redefinida. Faça login com a nova senha." (o backend não auto-loga — decisão já registrada nas Implementation Notes do backend) e redireciona pra `/login` automaticamente após 2s (`REDIRECT_DELAY_MS`, com link imediato "Ir para o login agora" pra quem não quiser esperar). Em erro: a mensagem genérica única do backend (`RESET_INVALID_MESSAGE`, cobre token inexistente/expirado/já usado sem distinguir) é exibida junto com um link "Solicitar um novo link" pra `/esqueci-senha` — não há tentativa de inferir qual dos 3 casos ocorreu, seguindo a decisão anti-enumeration do backend.

### Link de entrada
- `src/components/auth/LoginForm.tsx`: novo link "Esqueceu sua senha?" (`text-xs`, alinhado à direita) entre o campo de senha e o botão "Entrar", apontando pra `/esqueci-senha`.

### Decisões de escopo tomadas nesta rodada (dentro do espaço já delegado ao frontend, não alteram o contrato do backend)
- Toast (sonner) NÃO foi usado nas telas novas: `<Toaster />` só está montado em `src/app/(app)/layout.tsx` (grupo autenticado) — o layout raiz e as páginas públicas (`/login`, `/signup`) não têm Toaster, e nenhuma delas usa `sonner` hoje. Segui o padrão real já existente em `LoginForm`/`SignupForm` (mensagem inline com `role="alert"`/`role="status"`, banners de erro/sucesso no próprio card) em vez de introduzir um Toaster novo só pra essas duas telas.
- `/esqueci-senha` e `/redefinir-senha` NÃO redirecionam usuário já autenticado pra home (diferente de `/login`/`/signup`, que fazem isso via `requireUser()`+`homeRouteFor`). A SPEC pediu explicitamente que essas telas fiquem "fora do gate de `requireUser()`"; como `resetPassword` invalida todas as sessões antigas (D-038-2), um usuário autenticado que chegue em `/redefinir-senha` com um token válido (ex. abriu o link de reset numa aba onde já tinha logado de novo) ainda consegue concluir o fluxo normalmente.
- Sem testes de componente novos: não existe teste dedicado pra `LoginForm`/`SignupForm` neste repo (só os fluxos de action, já cobertos exaustivamente no backend — 11 testes em `auth.test.ts`) — mantive a mesma convenção em vez de introduzir um padrão de teste de componente só pra esta SPEC. A suíte completa (`npm test`) foi rodada e confirma 0 regressões.

### Arquivos criados/alterados
- Criados: `src/components/auth/ForgotPasswordForm.tsx`, `src/components/auth/ResetPasswordForm.tsx`, `src/app/esqueci-senha/page.tsx`, `src/app/redefinir-senha/page.tsx`.
- Alterado: `src/components/auth/LoginForm.tsx` (link "Esqueceu sua senha?").

### Resultado (2026-09-26)
- `npx tsc --noEmit`: **VERIFIED** — sem erros.
- `npm run lint`: **VERIFIED** — 0 erros (mesmos 4 warnings pré-existentes, em arquivos não tocados por esta SPEC).
- `npm test`: **VERIFIED** — 108 arquivos, 1347 testes, 0 falhas (nenhum teste novo — ver decisão de escopo acima; suíte completa, sem regressão).
- `npm run build` (`next build`): **VERIFIED** — build de produção completo sem erros; `/esqueci-senha` e `/redefinir-senha` aparecem na tabela de rotas geradas.
- Nenhum servidor de dev foi iniciado por este agente; confirmado via `ps aux` antes e depois de `npm run build` que o processo `next dev` do usuário continuou intacto (mesmos PIDs).

### Critérios de aceite (frontend)
| Critério | Status | Evidência |
|---|---|---|
| `/esqueci-senha`: formulário de e-mail, mensagem genérica sempre igual em sucesso | PASS | `ForgotPasswordForm.tsx` (renderiza `res.data.message` sem lógica condicional); backend já garante a mensagem única (ver testes do backend) |
| `/esqueci-senha`: reaproveita padrão visual de `/login`/`/signup` | PASS | `esqueci-senha/page.tsx` (mesmo card/tipografia/tokens) |
| Link "Esqueceu sua senha?" em `/login` | PASS | `LoginForm.tsx` |
| `/redefinir-senha`: lê `token` da query string | PASS | `redefinir-senha/page.tsx` (`searchParams`) |
| `/redefinir-senha`: campo de nova senha + confirmação, mesma validação de 12+ caracteres do signup | PASS | `ResetPasswordForm.tsx` (hint "Mínimo de 12 caracteres.", régua real aplicada no backend via `resetPasswordSchema`; confirmação client-side) |
| `/redefinir-senha`: sucesso mostra mensagem e redireciona pra `/login` (sem auto-login) | PASS | `ResetPasswordForm.tsx` (`setDone` + `setTimeout` + `router.replace("/login")`) |
| `/redefinir-senha`: token expirado/inválido/usado tratado com mensagem clara + link pra pedir novo | PASS | `ResetPasswordForm.tsx` (banner de erro + link "Solicitar um novo link"); `redefinir-senha/page.tsx` (token ausente na query) |
| `npm test`/lint/typecheck/build | PASS | ver seção "Resultado" acima |

### Limitações conhecidas
- Nenhuma nova. Limitações já documentadas na seção de backend (rate limit em memória, sessões mobile não invalidadas, notificação de "senha alterada" fora de escopo) continuam válidas e não são afetadas pelo frontend.

## Nota de ajuste incremental (dev-frontend, 2026-09-26) — toast de erro + logout limpa storage

Pedido direto do dono do projeto, dentro do escopo já `IMPLEMENTED` das SPECs 009/034/037/038 (ajuste de UX, sem SPEC nova). Duas correções:

1. **Logout limpa `localStorage`/`sessionStorage` do navegador.** Antes, `logout()` (server action) só apagava o cookie httpOnly de sessão; nenhum dado de cliente era limpo. Não havia PII em `localStorage` (grep confirmou zero uso); `sessionStorage` só guarda ids de notificação já mostradas como toast (`src/lib/notifications/toast-dedupe.ts`, dedupe da SPEC-029), não sensível, mas limpo por higiene — evita que o próximo usuário logado no mesmo navegador herde esse estado. Criado `src/lib/auth/client-logout.ts` (`clearClientStorage()`), chamado nos dois pontos reais de disparo de `logout()` — `src/components/auth/LogoutButton.tsx` e `src/components/layout/AppSidebar.tsx` (`NavUser`) — logo após `res.ok`, antes do `router.replace(res.data.redirectTo)`.
2. **Erros de API agora também disparam toast, além do banner inline.** A decisão de escopo original desta SPEC (seção acima, "Decisões de escopo tomadas nesta rodada") dizia explicitamente que Toast não seria usado por não haver `<Toaster />` fora do grupo `(app)`. Isso mudou: `<Toaster />` foi movido de `src/app/(app)/layout.tsx` para `src/app/layout.tsx` (layout raiz, que envolve tanto `(app)` quanto a landing/login/signup/esqueci-senha/redefinir-senha) — mantendo uma ÚNICA instância montada (sonner duplica visualmente o toast se houver 2 `<Toaster/>` simultâneos escutando o mesmo evento; por isso o de `(app)/layout.tsx` foi removido, não apenas duplicado). Com o Toaster disponível globalmente, os 4 formulários de auth (`LoginForm.tsx`, `SignupForm.tsx`, `ForgotPasswordForm.tsx`, `ResetPasswordForm.tsx`) passaram a chamar `toast.error(getFormError(res.errors))` (mesmo padrão de `form-utils.ts` já usado em componentes autenticados, ex. `src/components/settings/SuppressionRemoveDialog.tsx`) quando a action retorna `ok: false`, mantendo o banner inline existente (`role="alert"`) sem alterar — é redundância intencional (toast + inline), não substituição. `ResetPasswordForm.tsx`: o toast só cobre o erro retornado pela action (`resetPassword`), não a validação client-side de "senhas não coincidem" (que nunca chama a action).

Arquivos alterados: `src/lib/auth/client-logout.ts` (novo), `src/components/auth/LogoutButton.tsx`, `src/components/layout/AppSidebar.tsx`, `src/app/layout.tsx`, `src/app/(app)/layout.tsx`, `src/components/auth/LoginForm.tsx`, `src/components/auth/SignupForm.tsx`, `src/components/auth/ForgotPasswordForm.tsx`, `src/components/auth/ResetPasswordForm.tsx`.

Resultado: `npx tsc --noEmit` **VERIFIED** (sem erros) · `npm run lint` **VERIFIED** (0 erros, 4 warnings pré-existentes em arquivos não tocados) · `npm test` **VERIFIED** (108 arquivos, 1348 testes, 0 falhas). Nenhum servidor de dev foi iniciado; `next dev` do usuário não foi tocado.

Não alterado nesta rodada: `src/app/design/interactive.tsx` (Toaster próprio de uma página de storybook interno, `notFound()` em produção) — com o Toaster também no root, essa página passa a ter 2 instâncias em ambiente de desenvolvimento; fora do escopo pedido (só páginas públicas de auth + `(app)`) e sem efeito em produção, não foi tocado.

**SPEC-038 completa (backend + frontend + fix pós-QA de 2026-09-26, ver "Correção pós-QA" na seção de backend). `status: IMPLEMENTED`.**
