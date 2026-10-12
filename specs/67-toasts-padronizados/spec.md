# SPEC-067 — Padronizacao de toasts de sucesso e erro (mensagens do backend em PT-BR, uma unica porta)
- status: **DRAFT** (nada aprovado; aprovar com `APROVAR SPEC-067`) | domain: **fullstack** (067a backend: codigos tipados/mensagens; 067b-067e frontend: helper + migracao + regra automatica) | depende de: 065 (helper 065b, codigos `plan_limit`/`trial_expired`), 066 (**nao tocar nos arquivos dela ate a 066c fechar**), 062/055 (`email_*`), 054 (`rate_limited`), regra transversal 429 do `specs/README.md`
- Origem: pedido do usuario (2026-10-12): "todo erro vindo do backend aparece como toast em PT-BR, padronizado (com CTA quando fizer sentido), e todo sucesso segue um padrao unico, em toda a web". Motivador: `ForbiddenError: Sem permissao` apareceu cru em `/dashboard` para usuario sem organizacao.
- Tudo abaixo e **INFERRED** (leitura do codigo em 2026-10-12) ate o usuario decidir. NENHUM codigo foi escrito, nenhum schema/migration tocado.

## Objetivo
Ter UMA porta para feedback de acao na web: erros do backend (Server Actions, excecoes lancadas em paginas, rotas `/api/*`, rede) viram toast PT-BR com CTA quando fizer sentido, e sucessos usam um helper unico com mensagens por acao, duracao, deduplicacao e acessibilidade. Depois da migracao, um teste estatico impede `toast.error(`/`toast.success(` direto fora do helper.

## Contexto — estado atual (auditado no codigo)
- **Helper existente (065b):** `src/components/feedback/action-errors.ts` (`actionErrorInfo`, puro; codigos `plan_limit`, `trial_expired`, `email_not_verified`, `email_unverified`, `rate_limited`; so `plan_limit` e `trial_expired` geram CTA, ambos para `/configuracoes/assinatura`) e `notify.ts` (`notifyActionError`, sonner; duracao 10 s so quando ha CTA; CTA via `window.location.assign`). Usado em 6 telas: EmailAccountFormDialog, WhatsAppInstanceFormDialog, OrgNameCard, LeadFormDialog, CampaignActions, CampaignForm.
- **Outros helpers paralelos (duplicados):** `getFormError` (`components/campaigns/form-utils.ts`, 1a mensagem de `_form`/qualquer campo), `applyServerErrors` (`components/org/org-format.ts`; aplica erro nos campos e devolve a mensagem geral), `isEmailNotVerified` + `EMAIL_NOT_VERIFIED_MESSAGE` (`components/auth/email-verification-ui.ts`, so no DraftQueue) e uma 2a constante `EMAIL_NOT_VERIFIED_MESSAGE` em `lib/auth/email-verification.ts`. Resultado: 3 formas diferentes de extrair a mensagem; so 6 telas entendem `code`.
- **Toaster:** `src/components/ui/sonner.tsx` fixa `theme="dark"` (nao segue o tema claro/escuro da app), sem `position`, sem `closeButton`, sem `visibleToasts`/`duration` globais; montado em `src/app/layout.tsx` (e de novo em `src/app/design/interactive.tsx`).
- **Volume:** ~44 arquivos com `toast.error(` (60 chamadas) e ~48 com `toast.success(` (73) + 9 chamadas `toast.warning/info` (MeetingDialog, InviteMemberDialog, LeadActions, DraftQueue, TemplateManager, DeleteAccountPanel, CheckoutReturnHandler, LeadFormDialog). Nenhum `toast.promise/loading`. Nenhum `fetch(` em componentes/paginas client (tudo e Server Action); logo "fetch de /api/*" no cliente se limita ao que a SPEC cria (ver D-067-9).

## Inventario por area (arquivo -> tipo). E=`toast.error`, S=`toast.success`, W/I=warning/info
| Area | Arquivos (src/components/...) |
|---|---|
| Auth | auth/LoginForm (E,S), SignupForm (E), ForgotPasswordForm (E), ResetPasswordForm (E), LogoutButton (E) |
| Onboarding/Conta | onboarding/OrganizationSetupForm (E), JoinByCodeForm (E), CancelPendingSubscription (S); account/DeleteAccountPanel (S, W) |
| Organizacao/Equipe | org/TeamPanel (E,S), InviteMemberDialog (E,S,W), InviteLanding (E,S), JoinCodeDialog (E,S), MyOrganizations (E,S), OrgSwitcher (E); layout/AppSidebar (E); dashboard/OrgNameCard (S, via `notifyActionError`) |
| Leads | leads/LeadActions (E,S,I), LeadTags (E), LeadNotes (S), LeadSequenceActions (S), LeadFormDialog (S,W; ja `notifyActionError`), PossibleOptOutAlert (E,S) |
| Pipeline/Calendario | pipeline/PipelineBoard (E,S), EditOpportunityDialog (S); calendar/MeetingDialog (E,S,W) |
| Campanhas/ICP | campaigns/CampaignActions (S; ja helper), CampaignForm (S; ja helper), CampaignStartSequence (S), CampaignLeadSearch (S), IcpManager (E,S) |
| Sequencias/Templates | sequences/SequenceBuilder (E,S), SequenceActions (E,S), TemplateManager (E,S,W) |
| Agentes/Aprovacoes | agents/AgentsPanel (E,S), DraftQueue (E,S,W; unico com `isEmailNotVerified`) |
| Criativos | creatives/CreativeWizard (E,S), CreativeDetail (E,S) |
| Configuracoes | settings/WhatsAppHealthPanel, WhatsAppInstanceList, WhatsAppWebhookSection, WhatsAppQrDialog (S), WhatsAppInstanceFormDialog (S; helper), EmailAccountList, EmailAccountFormDialog (S; helper), IntegrationCard, IntegrationFormDialog, LeadSourceCards, SuppressionAddDialog, SuppressionRemoveDialog |
| Notificacoes | notifications/NotificationBell (E), NotificationsList (E,S) |
| Admin | admin/CreateCourtesyOrgDialog (E,S), OrganizationStatusActions (E,S) |
| Billing (**CONGELADA ate a 066c**) | billing/CancelSubscriptionPanel (E,S), PlanSelectionSection (E), SubscriptionSummaryCard (E), CheckoutReturnHandler (S,I) |
| Design system | app/design/interactive.tsx (S; demo, allowlist) |
| Boundaries | `src/app/(app)/error.tsx` (detecta `UnauthorizedError` por `name`/texto), `src/app/(app)/pipeline/error.tsx`; `src/app/not-found.tsx`. **Nao existe** `global-error.tsx`, nem `error.tsx` na raiz, em `(onboarding)`, `login`, `signup`, `convite`, `conta` etc. |
| Catch silencioso (sem feedback ao usuario) | settings/WhatsAppWebhookSection:50, LeadSourceCards:195, IntegrationCard:75, org/TeamPanel:248, campaigns/CampaignStartSequence:36, creatives/CreativeDetail:68, layout/HealthBanner:13, billing/SubscriptionPendingBanner:17, PendingSetupBanner:14 (+ `.catch(() => null)` em MeetingDialog:302, AgentsPanel:213, onboarding/CheckoutReturn:33, PlanCheckoutSection:57) — cada um precisa de decisao: toast, estado inline ou silencio justificado |
| Rotas `/api/*` | `notifications/*` (cliente: NotificationBell/List via Server Actions? confirmar na 067b), `billing/webhook`, `cron/tick`, `integrations/*`, `webhooks/*`, `mobile/v1/*` (fora do escopo web), `storage/*`, `openapi`. Respostas de erro com status explicito: 400 (mobile), 404 (openapi), 429 + `Retry-After` via `lib/http/too-many-requests.ts`; as demais usam helpers/`NextResponse` sem padrao uniforme — **inventariar na 067a**. `src/proxy.ts` redireciona sem sessao para `/login?next=` (nao devolve 401) |

## Auditoria — como os erros chegam hoje
1. **`ActionResult` = `{ ok:false, errors: Record<string,string[]> }`** (`lib/actions/result.ts`): `_form` (geral), chave por campo (`icp.name`) e chaves tecnicas `code`, `metric`, `limit`, `used`, `retryAfterSeconds`. `code` so e emitido em: `trial_expired`, `plan_limit`, `email_not_verified` (via `AppError.code`), `rate_limited` (billing.ts, auth.ts, account-deletion.ts), `email_unverified`, `plan_unavailable`, `billing_unavailable` (billing.ts). **Codigos emitidos pelo servidor que o helper do cliente NAO conhece:** `plan_unavailable`, `billing_unavailable`, `cooldown` (auth.ts) — hoje caem em mensagem sem tratamento.
2. **Captura central:** `safeAction` -> `handleActionError` cobre quase todas as actions (exports vs `safeAction(`: campaign 7/5, creative 9/7, org 14/13 — os 5 exports restantes sao leitura/helpers? **auditar na 067a**; todos os demais arquivos 1:1). Mapeamento atual: `UnauthorizedError` -> "Sessao expirada. Faca login novamente." (**sem `code`**: o cliente nao sabe redirecionar), `ForbiddenError` -> "Sem permissao." (**sem `code`**), `OrgSuspendedError` -> texto longo (**sem `code`**), `OrgOwnerRequiredError` -> `e.message`, Prisma P2025/P2003/P2002 -> PT-BR genericos (**sem `code`**; nao diferencia 404/409), conflito de transacao -> `CONFLICT_MESSAGE`, demais -> "Nao foi possivel concluir a operacao. Tente novamente." (detalhe so em `console.error` via `safeErrorForLog`). Bom: nao vaza stack/SQL.
3. **Excecoes que NAO passam por `handleActionError` (chegam crus ao usuario):** os `require*` das **queries/paginas Server Component** (`lib/queries/*`, `requirePageProviderOrg`, ex.: dashboard, leads, campanhas, pipeline, email, integracao) lancam `ForbiddenError("Sem permissao.")`/`UnauthorizedError`; `requirePageProviderOrg` so trata `UnauthorizedError` e `TrialExpiredError` (redirect) e **relanca `ForbiddenError`** -> o boundary `(app)/error.tsx` mostra "Algo deu errado" (em dev, o overlay do Next mostra `ForbiddenError: Sem permissao` — o caso relatado; `/dashboard` para usuario sem organizacao). Paginas `integracoes`/`assinatura`/`admin/organizacoes*` tem `try/catch` proprio, incluindo checagem por texto `e.message.includes("Sem permissão")` (fragil). Em producao o Next sanitiza a mensagem (so `digest`): o boundary deve decidir por **codigo/digest-map**, nao por texto.
4. **Mensagens de dominio** (`AppError.userMessage`, `lib/http/messages.ts`) ja sao PT-BR por codigo e nome de integracao (rate_limited, timeout, network, unauthorized, forbidden, not_found, conflict...). Ok, mas nao chegam ao cliente como `code` (so `email_not_verified`).
5. **Strings cruas no cliente (a varrer na 067b):** toasts com texto montado no componente (`toast.error(msg)` em WhatsAppHealthPanel:57, IntegrationCard:70/77, InviteLanding:129, LeadSourceCards:165, PossibleOptOutAlert:29, CreativeWizard:117/121 com sufixo `: ${...}`; DraftQueue:87 `Bloqueado pela politica...: ${reason}`) — verificar origem do `msg`; `getFormError` devolve a 1a mensagem de QUALQUER campo (pode ser mensagem Zod tecnica/ingles). **Revisar `lib/schemas/*` por mensagens Zod em ingles/default** (varredura na 067a). **Mensagens em ingles/cruas conhecidas:** `Error.name` (`ForbiddenError`), `e.message` lido pelo boundary em dev.
6. **Rede/timeout/offline:** Server Action que falha por rede/timeout/500 **rejeita a promise no cliente** (nao ha `ActionResult`); componentes com `await action()` sem `try/catch` ficam com o botao preso em `pending` e/ou erro nao tratado. Nenhum tratamento de `navigator.onLine`. Nao ha handler global de `unhandledrejection`.
7. **401/403/404/409/422/429/5xx:** em actions viram `_form` sem status; `rate_limited` tem `code`, o resto nao. Em rotas: 429 padronizado; demais sem padrao.

## Escopo
- **067a (backend, so mensagens/codigos — sem regra de negocio):** (i) `FieldErrors.code` ampliado para o contrato de codigos da tabela abaixo, emitido por `handleActionError` (acrescenta `code` a `UnauthorizedError`=`unauthenticated`, `ForbiddenError`=`forbidden`, `OrgSuspendedError`=`org_suspended`, P2025=`not_found`, P2002/P2003/conflito de tx=`conflict`, generico=`unknown`); (ii) varredura/lista das actions que emitem `formError`/`failure` sem `code` onde a UI precisa de CTA (listadas na secao "Actions que precisam ganhar `code`"); (iii) auditoria dos schemas Zod por mensagem em ingles; (iv) padrao unico de JSON de erro das rotas `/api/*` consumidas pela web (`{ error: <code>, message: <PT-BR>, retryAfterSeconds? }`, status coerente); (v) `userMessage` PT-BR garantido em toda excecao lancada por `require*` (nenhum `ForbiddenError: ...` em ingles/nome de classe chega a UI).
- **067b (frontend, nucleo):** modulo unico `src/components/feedback/` com: `error-catalog.ts` (puro: codigo -> mensagem PT-BR -> CTA -> severidade -> duracao), `action-errors.ts` (evolui o atual, mantendo a API `actionErrorInfo`), `notify.ts` (`notifyActionError`, **`notifySuccess`**, `notifyWarning`, `notifyInfo`, `runAction`/`safeCall` que captura rejeicao de rede), `success-messages.ts` (mensagens por acao), `toast-dedupe.ts`; `Toaster` ajustado (tema, posicao, a11y, mobile); boundaries (`error.tsx` com mapeamento por codigo/digest, `global-error.tsx`, `error.tsx` nas areas sem boundary); handler de sessao expirada.
- **067c-067e (frontend, migracao em lotes — ver "Estrategia"):** trocar todas as chamadas diretas pelos helpers.
- **067f (frontend, trava):** teste estatico + ESLint `no-restricted-syntax` proibindo `toast.*` direto fora de `components/feedback/` (allowlist).

## Fora do escopo
Regra de negocio/limites/precos; schema/migrations; mudar quais acoes exigem permissao; app mobile e `api/mobile/v1` (so reuso do catalogo de codigos, se o usuario quiser depois); e-mails transacionais; i18n para outro idioma (so PT-BR); biblioteca de toast diferente do `sonner`; SPEC-066 (billing) ate fechar; refatorar formularios alem de trocar a chamada de toast.

## Proposta de contrato (INFERRED)
### Tabela codigo -> mensagem PT-BR -> CTA
| `code` | Origem hoje | Mensagem PT-BR (default; o servidor pode sobrepor com `_form`) | CTA | Tipo/duracao |
|---|---|---|---|---|
| `unauthenticated` (401) | `UnauthorizedError` (hoje sem code) | "Sua sessao expirou. Entre novamente." | redireciona a `/login?next=<rota atual>` (auto, apos 1,5 s; sem toast repetido) | erro, 6 s |
| `forbidden` (403) | `ForbiddenError` | "Voce nao tem permissao para fazer isto." | — (ou "Falar com o dono da organizacao" se `org_owner_required`) | erro, 6 s |
| `org_owner_required` | `OrgOwnerRequiredError` | "Somente o proprietario da organizacao pode fazer isto." | — | erro |
| `org_required` (novo; sem organizacao) | `ForbiddenError` em `/dashboard` sem org | "Voce ainda nao faz parte de uma organizacao." | "Criar organizacao" / "Entrar com codigo" (rotas existentes: **confirmar na 067b**) | aviso, 10 s |
| `org_suspended` | `OrgSuspendedError` | "Assinatura pendente ou cancelada. Regularize o pagamento para continuar." | "Ver assinatura" -> `/configuracoes/assinatura` | erro, 10 s |
| `trial_expired` | 065a | "Seu teste gratis terminou. Assine um plano para continuar." | "Ver assinatura" | erro, 10 s |
| `plan_limit` | 065a | mensagem do servidor (metric/limit/used) | "Fazer upgrade" | erro, 10 s |
| `email_not_verified` / `email_unverified` | 055/062 | "Confirme seu e-mail para continuar. Enviamos um link para o seu cadastro." | "Reenviar e-mail" (acao ja existente na 055; **confirmar**) | erro, 10 s |
| `not_found` (404) | Prisma P2025 | "Nao encontramos este registro. Ele pode ter sido removido." | "Atualizar" (`router.refresh`) | erro |
| `conflict` (409) | P2002/P2003/conflito tx | "Esse dado ja existe ou foi alterado por outra pessoa. Atualize e tente de novo." | "Atualizar" | erro |
| `validation` (422/400) | Zod (`zodErrors`) | erros vao para os CAMPOS (`applyServerErrors`); toast so com resumo "Revise os campos destacados." | foco no 1o campo invalido | erro, 5 s |
| `rate_limited` (429) | billing/auth/account-deletion + rotas | "Muitas tentativas. Tente de novo em {n} s." (usa `retryAfterSeconds`, sem contador em loop) | desabilita o botao ate o fim do tempo | aviso, `retryAfterSeconds` |
| `plan_unavailable` / `billing_unavailable` | billing.ts | "Cobranca indisponivel no momento. Tente novamente em instantes." | "Tentar de novo" | erro |
| `timeout` / `network` / `offline` | rejeicao no cliente (sem `ActionResult`) | "Sem conexao com o servidor. Verifique sua internet e tente novamente." / "A operacao demorou demais. Tente novamente." | "Tentar de novo" (re-executa a acao so se idempotente) | erro, 8 s |
| `server_error` (5xx) / `unknown` | generico | "Algo deu errado do nosso lado. Tente novamente em instantes." (+ codigo de suporte curto = `digest`, se existir) | "Tentar de novo" | erro |
Mensagem do servidor so e exibida se vier de `_form`/`AppError.userMessage` (PT-BR garantido na 067a); caso contrario vale o texto do catalogo. Codigo desconhecido -> `unknown`.
### Fallback seguro (nunca vazar)
`notifyActionError` e as boundaries **nunca** exibem: `Error.name`/`stack`, texto contendo `Prisma`, `SQL`, `ECONN`, `at <fn>`, UUID/cuid/ids, URLs internas, tokens/chaves, nem mensagens em ingles detectadas (heuristica: nao contem acento/palavras PT e coincide com `^[A-Za-z]+Error`). Quando em duvida, usa o texto do catalogo para o `code`/`unknown`. Teste dedicado alimenta strings-isca (stack, SQL, `sk_live_...`, cuid) e exige que nao aparecam no DOM nem no toast.
### Excecoes lancadas (nao `ActionResult`)
- **Paginas/queries (Server Components):** `requirePageProviderOrg` passa a converter `ForbiddenError` em redirect/estado (sem org -> tela "voce ainda nao tem organizacao" ou redirect, conforme D-067-5), nunca relancar cru; demais excecoes -> `error.tsx`.
- **`error.tsx` (por area + `global-error.tsx`):** decide por `digest` + codigo (nao por texto, que e sanitizado em producao); mostra mensagem PT-BR do catalogo, botao "Tentar novamente" e, para `unauthenticated`, redirect a `/login`. Detalhe tecnico so em log do servidor. Quando a falha for de **acao no cliente** (nao de render), usa toast em vez de tela cheia.
- **Cliente:** `runAction(fn)` envolve `await serverAction()`: captura rejeicao (rede/timeout/offline), mapeia para `network`/`timeout`/`server_error`, devolve `ActionResult` sintetico (`ok:false`), nunca deixa o botao preso (`finally`). `window.addEventListener("unhandledrejection")` global como rede de seguranca com toast `unknown` (so em producao, sem expor `reason`).
- **Sessao expirada:** ao receber `unauthenticated` (de action ou boundary) -> toast unico + `router.replace("/login?next=...")`; sem laco de redirect.
### Helper de SUCESSO
- `notifySuccess(key | message, opts?)`: `key` indexa `success-messages.ts` (ex.: `lead.created` -> "Lead criado.", `campaign.paused` -> "Campanha pausada.", `invite.revoked`), padrao: **frase curta no passado, sem exclamacao, sem "com sucesso" redundante**, ate ~60 caracteres; texto livre so se a chave nao existir (e o teste exige chave para todo uso novo).
- Duracao: sucesso 4 s; sucesso com CTA/desfazer 8 s; aviso 6-10 s; erro 6 s (10 s com CTA); `closeButton` sempre.
- **Desfazer:** `notifySuccess(key, { undo: () => Promise<ActionResult> })` so onde a acao ja e reversivel no backend (hoje: arquivar/restaurar? **levantar na 067b; nao criar nova regra de negocio**); caso contrario nao aparece.
- `notifyWarning`/`notifyInfo` para os 9 casos atuais (ex.: "Lead salvo, mas NAO recebera envios..."), mesma politica.
- Deduplicacao: chave = `${tipo}:${code|mensagem}`; reutiliza `id` do sonner (atualiza o toast em vez de empilhar) e janela de 2 s; maximo de 3 toasts visiveis (`visibleToasts`).
### Toaster, acessibilidade, tema, mobile
- Remover `theme="dark"` fixo: seguir o tema da app (`theme-state.ts`/classe `dark`); tokens `bg-card/text-foreground/border-border` ja existem; validar contraste AA nos dois temas.
- Posicao: `bottom-right` no desktop e **`top-center` abaixo da barra no mobile (390 px)**, largura `calc(100vw - 32px)`, respeitando `safe-area`; nao cobrir o CTA principal/rodape fixo (**validar visualmente**).
- A11y: erro/aviso `role="alert"`/`aria-live="assertive"`, sucesso/info `role="status"`/`aria-live="polite"` (sonner ja usa regiao `aria-live`; **testar** e ajustar), CTA focavel por teclado, `closeButton` com `aria-label` PT-BR ("Fechar notificacao"), nao roubar foco, respeitar `prefers-reduced-motion`, atalho `Esc`/hotkey do sonner documentado; mensagem nunca so por cor.
- **Montagem unica:** manter 1 `Toaster` (`layout.tsx`); `design/interactive.tsx` so na rota de design.

## Estrategia de migracao (em lotes; ordem por risco crescente) e ordem de execucao
**Ordem global:** 067 so comeca **depois da 066c** (billing congelado: `assinatura/page.tsx`, `SubscriptionSummaryCard`, `CancelSubscriptionPanel`, `PlanSelectionSection`, `CheckoutReturnHandler`, `process-event.ts`, `lib/billing/*`). 067a (backend) pode rodar em paralelo a 066 **somente** em `lib/actions/result.ts` e arquivos que a 066 nao altera — **a confirmar** (Q-067-3); billing entra no lote final 067e.
| Lote | Conteudo | Risco |
|---|---|---|
| 067a | `handleActionError` + `code` + rotas `/api` + schemas | medio (contrato; testes de actions existentes devem continuar verdes) |
| 067b | catalogo, helpers, Toaster, boundaries, `runAction` + testes | medio |
| 067c | telas JA no helper (6) + auth (Login/Signup/Forgot/Reset/Logout) + onboarding + org/equipe/convite | baixo-medio (auth e critico: so trocar chamada) |
| 067d | leads, pipeline, calendario, campanhas, sequencias, agentes/aprovacoes, criativos, notificacoes, admin | medio (maior volume) |
| 067e | configuracoes (WhatsApp/e-mail/integracoes/fontes/supressao) + **billing/conta (pos-066c)** + catch silenciosos | medio-alto (billing) |
| 067f | trava automatica (teste estatico + ESLint) | baixo |
Cada lote: migrar, rodar testes verdes, **sem mudar comportamento** alem do toast. Regra de migracao: toda chamada `toast.error(getFormError(...))`/`applyServerErrors(...)` vira `notifyActionError(r.errors[, fallback])`; `toast.success("...")` vira `notifySuccess("<chave>")`.
### Regra automatizada (067f)
1. Teste Vitest `toast-usage.test.ts`: varre `src/**/*.{ts,tsx}` e falha se achar `toast.error(`, `toast.success(`, `toast.warning(`, `toast.info(`, `toast(`, `import { toast } from "sonner"` fora da allowlist.
2. ESLint `no-restricted-imports` (paths `sonner`, nome `toast`) + `no-restricted-syntax` no `eslint.config.mjs` (**alterar o config exige aprovacao desta SPEC**).
3. Allowlist (fechada, versionada no teste): `src/components/feedback/**`, `src/components/ui/sonner.tsx`, `src/app/design/**` (demo), testes `*.test.*`. Excecao nova exige comentario `// toast-allow: <motivo>` revisado.
4. Teste de cobertura do catalogo: todo `code` emitido por `lib/actions/**` (varredura por `code: ["..."]`) deve existir no catalogo (impede novo codigo sem mensagem).
5. Teste de varredura de ingles: nenhuma mensagem do catalogo/`success-messages` sem acentuacao PT-BR esperada (lista de termos proibidos: `Error`, `Forbidden`, `Unauthorized`, `failed`, `undefined`).

## Actions que precisam ganhar `code` (a confirmar na 067a; hoje sem `code` tipado)
Via `handleActionError` (cobre todas de uma vez): `unauthenticated`, `forbidden`, `org_suspended`, `not_found`, `conflict`, `unknown`. Emissoes manuais a revisar: `billing.ts` (`plan_unavailable`, `billing_unavailable`, `rate_limited` ja tem), `auth.ts` (`cooldown`/`rate_limited` tem; falta `unauthenticated` no login invalido = manter mensagem generica anti-enumeracao), `org.ts` (convite expirado/invalido, ja membro: `invite_invalid`, `already_member` — **confirmar**), `lead.ts`/`suppression.ts` (conflito de duplicidade = `conflict`), `campaign.ts`/`creative.ts`/`org.ts` (os exports sem `safeAction`), `integration.ts` (1 uso manual de `handleActionError`). Nao muda regra de negocio.

## Requisitos
**Funcionais:** RF1 todo `ActionResult.ok=false` e rejeicao de rede exibe toast PT-BR via helper unico; RF2 CTA conforme tabela; RF3 `unauthenticated` leva ao login com `next`; RF4 sucesso por chave com duracao/dedupe padrao; RF5 boundaries PT-BR por area + `global-error`; RF6 usuario sem organizacao em `/dashboard` nao ve `ForbiddenError` cru; RF7 `Toaster` segue o tema e funciona em 390 px. **Nao funcionais:** nenhum vazamento (stack/SQL/ids/segredos); sem novas dependencias (sonner existente); sem mudanca de schema; helper puro testavel sem DOM; compat com testes existentes.

## Arquivos esperados (INFERRED)
Novos: `src/components/feedback/{error-catalog,success-messages,toast-dedupe,run-action}.ts`, `src/app/global-error.tsx`, `error.tsx` em areas sem boundary, `src/components/feedback/toast-usage.test.ts`. Alterados: `action-errors.ts`, `notify.ts`, `ui/sonner.tsx`, `lib/actions/result.ts`, `lib/auth/require-page.ts`, `(app)/error.tsx`, `pipeline/error.tsx`, ~45 componentes `.tsx` da tabela, `eslint.config.mjs`, `lib/schemas/*` (so mensagens), rotas `/api` consumidas pela web.

## Criterios de aceitacao
1. Varredura estatica: 0 ocorrencias de `toast.*` direto fora da allowlist; teste e ESLint verdes.
2. Para cada `code` do catalogo existe teste unitario (mensagem, CTA, duracao); `code` desconhecido -> `unknown`.
3. Strings-isca (stack, SQL, `PrismaClientKnownRequestError`, cuid, `sk_live_`) nunca aparecem em toast/DOM/boundary.
4. `/dashboard` sem organizacao nao mostra `ForbiddenError`/"Sem permissao" cru (RTL/SSR + checagem manual).
5. Rejeicao de Server Action (rede/timeout) mostra toast PT-BR e solta o `pending`.
6. `unauthenticated` redireciona a `/login?next=` sem laco e sem toast duplicado.
7. 2 disparos iguais em <2 s = 1 toast; maximo 3 visiveis.
8. A11y: `aria-live` correto (assertive erro / polite sucesso), CTA e fechar acessiveis por teclado, contraste AA nos temas claro/escuro, sem scroll horizontal e sem cobrir CTA em 390 px.
9. Todos os testes existentes continuam verdes (`npm test`, `tsc`, `lint`); nenhum arquivo da 066 alterado antes do fechamento dela.
10. ROTEIRO_DE_TESTES, PRIMEIROS_PASSOS (linguagem simples) e RETOMAR atualizados ao fechar cada lote.

## Plano de testes
Unitarios (puros): catalogo/`actionErrorInfo`/dedupe/`success-messages`/saneamento do fallback/`handleActionError` com cada excecao. SSR/RTL por tela migrada (1 teste por lote cobrindo erro com CTA, erro simples, sucesso): padrao `renderToStaticMarkup`/RTL ja usado no repo (ver `onboarding-ui.test.tsx`). Varredura estatica (067f) e de codigos nao catalogados. Boundaries: render de `error.tsx` com `Error` sintetico (nome `ForbiddenError`, digest) sem vazar. A11y: asserts de `role`/`aria-live`/`aria-label`; checagem visual manual em 390 px e 2 temas (**pendente: sem navegador/E2E automatico — marcar PENDENTE ate validar**). Rotas `/api`: formato de erro e 429 com/sem `Retry-After`.

## Seguranca
Nunca expor stack/SQL/ids/tokens; manter anti-enumeracao de login/recuperacao (mensagens genericas inalteradas); `next` do login so caminhos internos (reusar validacao existente); log de detalhe so no servidor (`safeErrorForLog`); sem `dangerouslySetInnerHTML` em toast; `rate_limited` nao revela criterio do limite.

## Riscos
Volume (~45 arquivos) e conflito com a 066 (mitigado pela ordem); mudar `handleActionError` quebra testes que comparam `errors` exatos (`toEqual` sem `code`); `digest`/mensagem sanitizada em producao limita o mapeamento no boundary (por isso o `code` deve vir de `redirect`/estado, nao de texto); dedupe pode esconder erro legitimo repetido (janela curta); retry automatico de acao nao idempotente (so oferecer "Tentar de novo" quando seguro); `top-center` mobile pode cobrir cabecalho; allowlist virar brecha.

## Decisoes (INFERRED, com recomendacao; viram CONFIRMED so com aprovacao)
- **D-067-1** Manter `sonner` e o contrato `ActionResult`; evoluir o helper 065b em vez de criar outro. Rec.: sim.
- **D-067-2** `code` tipado e aditivo em `errors.code` (compat com `FieldErrors`); sem mudar o formato `ActionResult`. Rec.: sim.
- **D-067-3** Catalogo unico codigo->mensagem->CTA (tabela acima); mensagem do servidor so prevalece quando `_form` PT-BR. Rec.: sim.
- **D-067-4** `Toaster` segue tema claro/escuro (remover `theme="dark"`). Rec.: sim.
- **D-067-5** Usuario sem organizacao em `/dashboard`: redirecionar para a tela de criar/entrar em organizacao (em vez de erro). Rec.: redirect + toast `org_required` (depende do estado das rotas de onboarding; **confirmar**).
- **D-067-6** Sucesso por chave (`notifySuccess("lead.created")`), 4 s, sem exclamacao. Rec.: sim.
- **D-067-7** Dedupe por `id` + janela 2 s, max 3 visiveis. Rec.: sim.
- **D-067-8** Trava dupla (Vitest + ESLint) com allowlist fechada. Rec.: sim.
- **D-067-9** Sem `fetch` novo no cliente; se alguma tela web passar a consumir `/api/*`, usar o mesmo `runAction`/catalogo e o formato `{error,message,retryAfterSeconds}` (regra transversal 429 do README). Rec.: sim.
- **D-067-10** Migrar em 6 lotes (a-f), billing so apos 066c. Rec.: sim.
- **D-067-11** Catch silenciosos: decidir um a um (toast vs. estado inline vs. silencio justificado); nao inventar feedback onde o silencio e proposital (ex.: banners de saude). Rec.: sim.

## Perguntas
- **Q-067-1 (BLOQUEANTE):** Aprovar o escopo fullstack em 6 lotes (067a..f) e a ordem "depois da 066c"? Rec.: sim.
- **Q-067-2 (BLOQUEANTE):** Alterar `eslint.config.mjs` (regra `no-restricted-*`) e `lib/actions/result.ts` (adicionar `code` a Unauthorized/Forbidden/etc.) esta autorizado? Rec.: sim; sem isso a regra nao e automatica.
- **Q-067-3 (BLOQUEANTE para 067a):** `result.ts` e arquivos de actions podem ser tocados em paralelo a 066b/c, ou so apos a 066c? Rec.: so apos a 066c (mais seguro).
- **Q-067-4:** Posicao dos toasts: `bottom-right` desktop / `top-center` mobile ok? Rec.: sim.
- **Q-067-5:** Existe alguma acao hoje desfazivel que valha o botao "Desfazer"? Rec.: nao inventar; so se ja houver reversao no backend.
- **Q-067-6:** Usuario sem organizacao: destino do redirect/CTA (criar organizacao, entrar com codigo ou ambos)? Rec.: ambos, conforme rotas existentes.
- **Q-067-7:** Mostrar "codigo de suporte" (`digest`) no erro 5xx? Rec.: sim, curto, so em boundary.
- **Q-067-8:** Mensagem de 401 em login invalido segue generica (anti-enumeracao)? Rec.: sim, inalterada.

## Restricoes de implementacao
Ler `node_modules/next/dist/docs/` antes de mexer em `error.tsx`/`global-error.tsx` (AGENTS.md: Next 16 diferente; note que o boundary atual recebe `retry`, nao `reset`). Nao commitar/mexer em `.env`/`next.config.ts`. Nao tocar nos arquivos de billing/066 antes do fechamento da 066c. Uma SPEC por vez; cada lote termina com testes verdes e doc atualizada.
