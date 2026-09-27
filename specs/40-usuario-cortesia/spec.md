# SPEC-040 — Criacao manual de usuario com acesso completo (cortesia/interno)
- status: IMPLEMENTED (backend+frontend, 2026-09-27) — falta QA formal | domain: fullstack | depende de: 030 (multi-tenant), 031/032 (admin), 033 (billing)

## Objetivo
Permitir que o `platform_admin` crie manualmente uma Organization/Provider com acesso completo ao sistema (aos planos/recursos), sem passar pelo fluxo normal de pagamento/checkout — para contas de cortesia, parceiros, demos internas, ou testes.

## Escopo proposto
- Action `createCourtesyOrganization({name, ownerEmail, ownerName, plan?})` (`requirePlatformAdmin()`, cross-tenant explicito): cria `User`(provider)+`Organization`+`Membership(owner)`+`Subscription` com status `active` e SEM `PaymentProvider` associado (ou com um provider "courtesy"/flag especifico — ver D-040-2), ignorando o fluxo de checkout/trial normal.
- Auditoria (`PlatformAuditLog`, mesmo padrao de suspender/reativar).
- UI: formulario simples na area de Administracao (SPEC-032) para o `platform_admin` criar essa conta.

## Decisoes fechadas (usuario, 2026-09-27)

D-040-1: Conta de cortesia PERMANENTE, sem prazo de validade (o `platform_admin` sempre pode suspender manualmente depois via `suspendOrganization`, mecanismo ja existente, se precisar revogar).

D-040-2: Reaproveitar `Plan`/`Subscription` — novo `Plan` especial "cortesia" (`key: "courtesy"`, `selfServiceCheckout:false`, precos zero, nao aparece na listagem publica de planos da SPEC-034/035), `Subscription.status: "active"` sem vinculo a `PaymentProvider` real (webhook nunca dispara pra essa org).

D-040-3: Acesso SEM LIMITE nenhum (`Plan.limits` do plano cortesia = null/ilimitado em todos os campos).

D-040-4: So `platform_admin` pode criar contas de cortesia (unico papel de admin que existe hoje).

## Fora do escopo
- Multiplos niveis de admin (nao existe ainda).
- Qualquer coisa em `../mobile/`.

## Ordem de execucao
Backend (dev-backend) primeiro, depois UI simples em Administracao (dev-frontend). Aprovada, decisoes fechadas — pode implementar direto.

## Implementation Notes — Backend (dev-backend, 2026-09-27)

### Modelo de dados / migration
- `prisma/schema.prisma`: `PlatformAuditAction` ganhou o valor `create_courtesy_org` (novo — os outros dois, `suspend`/`reactivate`, já existiam da SPEC-031). Nenhum model novo: reaproveita `Plan`/`Subscription`/`PlatformAuditLog` como decidido em D-040-2.
- Migration `prisma/migrations/20260927062031_platform_audit_create_courtesy_org/migration.sql` — aplicada no banco de DEV local (`prisma migrate dev`) e reaplicada automaticamente no banco de TESTE pelo `globalSetup` do vitest (`migrateAndSeed`).
- `npx prisma generate` executado após a migration (sem isso, `tsc --noEmit` falhava com "create_courtesy_org não é `PlatformAuditAction`" — o client TS não recarrega sozinho).

### Plano "cortesia" (D-040-2/D-040-3)
- `prisma/seed.ts` (`PLAN_SEED`): novo item `{ key: "courtesy", name: "Cortesia", priceMonthlyCents: 0, priceYearlyCents: null, limits: { maxCampaigns: null, maxWhatsappInstances: null, maxLeadsPerMonth: null }, selfServiceCheckout: false }` — mesmo padrão idempotente (`upsert` por `key`) de starter/pro/business, via `seedPlans()`. `limits` com todos os campos `null` = ilimitado (D-040-3), consistente com `parseLimits()` de `src/lib/billing/plans.ts` (que já trata `null` como "sem limite").
- `src/lib/billing/plans.ts` (`listActivePlans`, consumida pela landing `/`, `/signup` e `Configurações > Assinatura`): filtro `where: { active: true, key: { not: "courtesy" } }` — o plano cortesia nunca aparece na vitrine pública mesmo estando `active: true` (D-040-2). Confirmado com teste dedicado (ver abaixo). `starter`/`pro`/`business` continuam aparecendo exatamente como antes.

### Action `createCourtesyOrganization` (`src/lib/actions/admin/organizations.ts`)
- `requirePlatformAdmin()` (D-040-4) + `adminPrisma` (= `prisma` cru, caminho cross-tenant explícito, mesmo padrão de `suspendOrganization`/`reactivateOrganization` da SPEC-031 — nenhuma linha desta action usa `scopedPrisma`/`requireProviderOrg`).
- Input: `createCourtesyOrganizationSchema` (novo, `src/lib/schemas/admin.ts`) — `{ name, ownerEmail, ownerName }`, mesma régua de validação (trim, tamanho, e-mail) do `signupSchema` de `src/lib/schemas/billing.ts`.
- Transação única (`adminPrisma.$transaction`, mesmo espírito de `signUpAndStartCheckout`/SPEC-033-034, mas SEM criar sessão — quem faz login depois é o usuário criado, não o admin): cria `User` (`role: "provider"`, SEM `passwordHash`) → `Organization` (`status: "active"`, slug único via `uniqueSlug`/`slugify` — mesma lógica de `billing.ts`, duplicada localmente pois não estava exportada) → `Membership` (`orgRole: "owner"`) → `Subscription` (`planId` do plano `"courtesy"`, `status: "active"`, `cadence: "monthly"`, SEM `currentPeriodEnd`/`trialEndsAt` — permanente, D-040-1, sem prazo algum) → `PasswordResetToken` (ver seção de senha abaixo) → `PlatformAuditLog` (`action: "create_courtesy_org"`, `reason` com o e-mail do owner criado). Tudo ou nada: se qualquer passo falhar, nada é criado.
- `Subscription.externalCustomerId`/`externalSubscriptionId` ficam `null` (nunca preenchidos aqui) — igual ao trial de `signUpAndStartCheckout` antes do 1º checkout. **Segurança do webhook confirmada por construção**: `processBillingEvent` (`src/lib/billing/process-event.ts`) só é acionado por eventos do provedor de pagamento que carregam um `orgId` — esse `orgId` só existe porque foi colocado nos metadados de uma sessão de checkout criada por `createCheckoutSession` (`src/lib/actions/billing.ts`), que por sua vez só é alcançável por uma org com `Plan.selfServiceCheckout: true`. Como o plano `"courtesy"` tem `selfServiceCheckout: false` e a UI de checkout (SPEC-034/035) não oferece esse plano (nem aparece na listagem, ver acima), **nenhum checkout é jamais criado para uma org de cortesia**, logo nenhum evento de webhook chega referenciando o `orgId` dela — não há nenhum caminho de checkout self-service que gere esse evento organicamente. Ressalva de precisao (QA, 2026-09-27): isso NAO significa que nenhum evento poderia alcancar essa org por nenhuma via -- quem possui o segredo de servidor do webhook (`MOCK_WEBHOOK_SECRET` em modo mock, ou a chave que assina o payload real do Stripe em produção) sempre poderia, tecnicamente, forjar um evento referenciando qualquer `orgId` do sistema, incluindo uma org de cortesia -- essa capacidade e um risco de posse de segredo de servidor equivalente para TODO o produto (ja mitigado pelo fix de autenticacao do webhook da SPEC-033, rodada 2), nao uma brecha nova introduzida por esta SPEC. A garantia real e forte o suficiente (nenhum agente externo sem esse segredo alcanca `processBillingEvent`), mas nao e "ausencia total de mecanismo" -- e "nenhum mecanismo alcancavel sem o segredo de servidor do webhook".
- E-mail duplicado: `P2002` do Prisma (`User.email` é `@unique`) → `formError("Já existe uma conta cadastrada com este e-mail.")`, mensagem direta (decisão explícita da tarefa: diferente de `signUpAndStartCheckout`, aqui não há risco de enumeração — o admin já está autenticado/autorizado e sabe que está tentando (re)cadastrar aquele e-mail).
- Auditoria: `PlatformAuditLog` (`action: "create_courtesy_org"`, `adminUserId`, `orgId`, `reason`) gravado DENTRO da mesma transação do resto da criação — nunca existe org de cortesia sem o registro correspondente de quem criou.

### Senha inicial — abordagem escolhida
- **Decisão**: reaproveitar o fluxo de "esqueci minha senha" (SPEC-038) em vez de gerar uma senha aleatória temporária. O `User` nasce sem `passwordHash`; a action cria diretamente um `PasswordResetToken` (mesma função `newResetToken()`/`RESET_TOKEN_TTL_MS` de `src/lib/auth/password-reset.ts`, dentro da mesma transação da criação) e dispara (fire-and-forget, fora da transação, mesmo padrão de `forgotPassword`) um e-mail via `sendSystemEmail` com o link `/redefinir-senha?token=...` — a mesma página que a SPEC-038 já implementou (não foi preciso criar nenhuma tela/rota nova).
- **Por que essa abordagem e não senha aleatória**: reaproveita 100% de infraestrutura já existente e testada (model `PasswordResetToken`, página `/redefinir-senha`, validação de token atômica em `resetPassword`, rate limit de uso) sem precisar inventar um canal novo para entregar um segredo gerado ao admin (que teria que copiar/colar/transmitir a senha temporária de algum jeito, um risco de segurança evitável). O usuário final define a própria senha, exatamente como no signup self-service.
- Limitação assumida: se o envio de e-mail falhar (SMTP fora do ar, endereço inválido etc.), a conta é criada mesmo assim (fire-and-forget, erro só logado no servidor) — o admin não tem hoje um botão de "reenviar link" dedicado a essa conta, mas o próprio usuário pode usar `/esqueci-senha` (SPEC-038) normalmente depois que a conta existe, com o mesmo efeito.

### Testes escritos (todos rodados, `VERIFIED`)
- `src/lib/actions/admin/organizations.test.ts` (novo describe `createCourtesyOrganization (SPEC-040)`, 5 testes): provider comum recebe erro de permissão e nada é criado; sem sessão → erro; platform_admin cria User(`role: provider`, sem `passwordHash`)+Organization+Membership(`owner`)+Subscription(`plan: courtesy`, `status: active`, sem `externalCustomerId`/`externalSubscriptionId`) corretamente ligados à mesma org, `Plan.limits` ilimitado nos 3 campos, `PasswordResetToken` criado (não usado), `PlatformAuditLog` (`action: create_courtesy_org`) gravado com o `adminUserId` certo; e-mail duplicado → erro tratado, nenhuma organização nova criada (contagem de `Organization` antes/depois idêntica).
- `src/lib/billing/plans.test.ts` (1 teste novo): `listActivePlans()` nunca inclui o plano `"courtesy"`, mesmo que ele esteja `active: true`.

### Resultado (2026-09-27)
- `npx tsc --noEmit`: **VERIFIED** — sem erros.
- `npm run lint`: **VERIFIED** — 0 erros (4 warnings pré-existentes, em arquivos não tocados por esta SPEC: `src/lib/billing/providers/{mock,stripe}.ts`, `src/lib/billing/webhook-handler.test.ts`).
- `npm test`: **VERIFIED** — 109 arquivos, 1370 testes, 0 falhas (inclui toda a suíte pré-existente do projeto, não só os testes novos desta SPEC). Nota: outro agente estava trabalhando em paralelo no mesmo repositório durante esta implementação (SPEC-039, campo `Organization.suspendedReason`/migration própria) — uma primeira tentativa de rodar a suíte completa pegou 1 falha transiente em `src/lib/mobile/alerts.test.ts` (contagem cross-tenant de orgs afetada por uma seed/vitest concorrente do outro agente, confirmado via `ps aux`); esperei os processos concorrentes terminarem e repeti — suíte completa 100% verde. `npx prisma generate` precisou ser re-executado depois que o outro agente aplicou sua migration (client TS ficou temporariamente desatualizado).
- `npm run dev`/`npm run build` deliberadamente **NÃO executados** (instrução explícita da tarefa — o usuário roda o próprio servidor).

### Critérios de aceite (backend)
| Critério | Status | Evidência |
|---|---|---|
| Criação com sucesso: User+Org+Membership+Subscription todos na org certa | PASS | `organizations.test.ts` ("platform_admin cria User+Organization+Membership(owner)+Subscription...") |
| `provider` comum tentando chamar a action recebe erro | PASS | `organizations.test.ts` ("provider comum (não platform_admin) recebe erro de permissão...") |
| E-mail duplicado tratado | PASS | `organizations.test.ts` ("e-mail duplicado -> erro tratado...") |
| `listActivePlans()` não inclui o plano cortesia | PASS | `plans.test.ts` ("plano 'courtesy' (SPEC-040...) nunca aparece na vitrine pública...") |
| `Plan.limits` do cortesia é ilimitado | PASS | `organizations.test.ts` (assert `limits.maxCampaigns/maxWhatsappInstances/maxLeadsPerMonth` todos `null`) |
| Auditoria registrada | PASS | `organizations.test.ts` (assert `PlatformAuditLog` com `action: "create_courtesy_org"` e `adminUserId` corretos) |
| D-040-4: só `platform_admin` cria | PASS | mesmo teste de negação acima |
| D-040-1: conta permanente, sem expiração | PASS | revisão de código — `Subscription` criada sem `trialEndsAt`/`currentPeriodEnd`; nenhum mecanismo de expiração automática existe no código |
| D-040-2: `Subscription` sem vínculo real a provedor de pagamento, webhook nunca dispara | PASS | revisão de código (ver seção acima) — segurança por construção, sem checkout possível para este plano |
| `npx tsc --noEmit`/`npm run lint`/`npm test` | PASS | ver seção "Resultado" acima |

### Decisões arquiteturais tomadas nesta rodada (não estavam explícitas na SPEC)
- Slug único da nova `Organization`: reaproveitada a mesma função `slugify`/`uniqueSlug` de `src/lib/actions/billing.ts` (`signUpAndStartCheckout`) — duplicada localmente em `organizations.ts` (não exportada do arquivo original, e os dois arquivos têm razões de existir separadas: um é ação pública, o outro é cross-tenant de admin).
- A action **não cria sessão** para o usuário criado (diferente de `signUpAndStartCheckout`, que loga automaticamente quem se cadastra) — o admin está criando uma conta para OUTRA pessoa, então logar automaticamente na sessão do admin não faria sentido; quem usa a conta é quem recebe o e-mail e define a senha.
- `reason` do `PlatformAuditLog` para esta ação é sempre preenchido automaticamente (`"conta de cortesia criada para {ownerEmail}"`) — não é um campo livre pedido ao admin (diferente de `suspendOrganization`, cujo `reason` é obrigatório e digitado pelo admin), porque a SPEC não pediu esse campo no input da action.

### Limitações conhecidas / fora de escopo desta rodada
- UI de Administração (formulário para o `platform_admin` chamar esta action) — **não implementada nesta rodada**, é a próxima etapa (dev-frontend), conforme a "Ordem de execução" original da SPEC.
- QA formal desta SPEC ainda não foi disparado — por regra do projeto, a SPEC só pode ser considerada de fato encerrada após essa rodada.
- Não há "reenviar link de definição de senha" dedicado para uma conta de cortesia já criada — mitigado pelo fluxo já existente `/esqueci-senha` (SPEC-038), que funciona normalmente para qualquer `User` já existente, cortesia ou não.

**Pronto para QA. Pronto para o frontend seguir** (consumindo `createCourtesyOrganization({ name, ownerEmail, ownerName }): ActionResult<{ orgId: string; userId: string }>` de `src/lib/actions/admin/organizations.ts`).

## Implementation Notes — Frontend (dev-frontend, 2026-09-27)

### Decisão: dialog na própria listagem, não sub-rota nova
- Formulário implementado como **dialog** na própria página `/admin/organizacoes` (`src/app/(app)/admin/organizacoes/page.tsx`), não uma sub-rota `/admin/organizacoes/nova`. Motivo: só 3 campos simples (nome da org, nome e e-mail do dono), sem etapas/wizard — o padrão já estabelecido na base de código para esse caso exato é dialog no cabeçalho da própria listagem (`SuppressionAddDialog` em `src/app/(app)/configuracoes/supressao/page.tsx`, `WhatsAppInstanceFormDialog` em Configurações), não uma rota dedicada (rotas dedicadas no projeto são usadas para fluxos maiores/multi-etapa, ex. `/signup`, não para "adicionar 1 registro simples"). Botão "Nova conta de cortesia" fica ao lado do título, no mesmo lugar/estilo de "Adicionar à lista de supressão".
- Padrão de formulário: `useState` manual + `fieldError`/`getFormError` (`src/components/campaigns/form-utils.ts`) + `React.useTransition`, copiando quase literalmente `SuppressionAddDialog.tsx` (não `React.useActionState`, que é o padrão usado em `WhatsAppInstanceFormDialog`/formulários com `FormData` nativo — optei pelo padrão mais simples/mais recente entre os dois já existentes, ambos válidos hoje). Confirmado antes de implementar: SPEC-042 (padronização react-hook-form) segue `DRAFT` no `web/specs/README.md` — não adiantada a migração, conforme instrução da tarefa.

### Arquivos criados
- `src/components/admin/CreateCourtesyOrgDialog.tsx` — dialog + formulário (`Field`, `Input`, `Dialog*` do design system, SPEC-002/037; nenhum componente novo de base). 3 campos: nome da organização, nome do dono, e-mail do dono. Aviso explícito abaixo dos campos (`role="note"`, mesmo padrão visual informativo de `PlanSelectionSection.tsx`, ícone `Mail` do lucide-react) deixando claro que nenhuma senha é definida pelo admin e que o dono recebe um e-mail para escolher a própria senha (reaproveita SPEC-038). Sucesso: `toast.success` com o e-mail do dono + `onDone()` (fecha o dialog) + `router.refresh()` (mesmo padrão de `router.refresh()` já usado em `OrganizationStatusActions.tsx`/`SuppressionAddDialog.tsx` — a lista de `OrganizationsList` relê os dados no próximo request). Erro (ex. e-mail duplicado, retornado pela action como `formError`): banner inline (`role="alert"`, `bg-destructive/10`) via `fieldError(errors, "_form")` + `toast.error(getFormError(errors))`, idêntico ao padrão pós-SPEC-038 usado nas demais telas.
- `src/components/admin/CreateCourtesyOrgDialog.test.tsx` — teste estático (mesma limitação documentada em `OrganizationStatusActions.test.tsx`/SPEC-032: `Dialog` do base-ui não renderiza nada no servidor com `open=false` via `renderToStaticMarkup`, então só é verificável o botão-gatilho fechado). A submissão em si (chamada à action, tratamento de sucesso/erro) já está coberta por `src/lib/actions/admin/organizations.test.ts` (backend, SPEC-040); a interação real do dialog (abrir, digitar, ver toast) depende de DOM real e fica para revisão visual manual em navegador — mesma ressalva já registrada em outras SPECs deste bloco (ex. SPEC-032/034/035).

### Arquivos alterados
- `src/app/(app)/admin/organizacoes/page.tsx` — cabeçalho da página passou a `flex justify-between` (título+descrição à esquerda, `<CreateCourtesyOrgDialog />` à direita), mesmo padrão de layout já usado em `src/app/(app)/configuracoes/supressao/page.tsx`. Nenhuma outra mudança na página (query/paginação/filtros intocados).

### Nenhuma mudança em
- `src/lib/actions/admin/organizations.ts`, `src/lib/schemas/admin.ts` (backend já pronto, consumido como está — `createCourtesyOrganization({ name, ownerEmail, ownerName })`).
- `../mobile/` — não tocado, conforme regra dura da tarefa.

### Testes executados (todos rodados nesta rodada, `VERIFIED`)
- `npx tsc --noEmit`: **VERIFIED** — sem erros.
- `npm run lint`: **VERIFIED** — 0 erros (mesmos 4 warnings pré-existentes já registrados na rodada de backend, em arquivos não tocados por esta SPEC: `src/lib/billing/providers/{mock,stripe}.ts`, `src/lib/billing/webhook-handler.test.ts`).
- `npm test`: **VERIFIED** — 110 arquivos, 1371 testes, 0 falhas (1370 pré-existentes + 1 teste novo desta rodada, `CreateCourtesyOrgDialog.test.tsx`). Confirmado via `ps aux` antes de rodar que não havia processo `vitest` concorrente.
- `npm run dev`/`npm run build` deliberadamente **NÃO executados** (instrução explícita da tarefa — o usuário roda o próprio servidor).

### Critérios de aceite (frontend)
| Critério | Status | Evidência |
|---|---|---|
| Formulário de criação de conta de cortesia em Administração (nome, e-mail do dono, nome do dono) | PASS | `CreateCourtesyOrgDialog.tsx`, montado em `/admin/organizacoes` |
| UI reaproveita design system existente (SPEC-002/037), nenhum componente novo de base | PASS | revisão de código — só composição de `Dialog`/`Button`/`Input`/`Field` já existentes |
| Sucesso: toast de confirmação + revalidação da lista | PASS | `toast.success(...)` + `router.refresh()` em `CreateCourtesyOrgDialog.tsx` |
| UI deixa claro que o novo usuário recebe e-mail para definir a própria senha | PASS | bloco `role="note"` no formulário + texto do toast de sucesso |
| Erro (ex. e-mail duplicado): banner inline + toast, padrão pós-SPEC-038 | PASS | `fieldError(errors, "_form")` (banner) + `toast.error(getFormError(errors))` |
| Padrão de formulário antigo (`useState`/`fieldError`), não react-hook-form (SPEC-042 ainda DRAFT) | PASS | confirmado `web/specs/README.md` (linha 049) antes de implementar; `CreateCourtesyOrgDialog.tsx` usa `useState`/`useTransition` |
| Nenhuma mudança em `../mobile/` | PASS | nenhum arquivo fora de `web/` tocado nesta rodada |
| `npx tsc --noEmit`/`npm run lint`/`npm test` | PASS | ver seção "Testes executados" acima |

### Decisões arquiteturais tomadas nesta rodada (não estavam explícitas na SPEC)
- Botão-gatilho ("Nova conta de cortesia") posicionado no cabeçalho da listagem, à direita do título — não dentro de `OrganizationsSearchForm.tsx` (que é um form GET nativo de busca/filtro, sem JS necessário; misturar um dialog client-side nele quebraria essa propriedade) e não como link separado na sidebar (a SPEC não pediu uma tela própria, e a ação é sempre disparada a partir de "ver a lista de organizações").
- Texto do toast de sucesso inclui o e-mail do dono (`` `Conta de cortesia criada. ${ownerEmail} vai receber um e-mail para definir a senha.` ``) para reforçar visualmente, no momento da ação, que não há senha definida pelo admin — reforça o mesmo aviso já presente no corpo do formulário.

### Limitações conhecidas / fora de escopo desta rodada
- QA formal desta SPEC (frontend) ainda não foi disparado — por regra do projeto, a SPEC não deve ser marcada `IMPLEMENTED` como encerrada antes dessa rodada. Status permanece como está até o QA rodar.
- Interação real do dialog em DOM (abrir, preencher, ver erro/sucesso) não tem teste automatizado de integração (limitação do projeto como um todo — nenhum componente usa `@testing-library/react`/jsdom para esse tipo de interação hoje); fica para revisão visual manual em navegador (mobile ~375px, tablet ~768px, desktop ~1280px+), a cargo do QA/usuário.
- Não há botão dedicado de "reenviar e-mail de definição de senha" para uma conta de cortesia já criada, na UI — mesma limitação já registrada na rodada de backend, mitigada por `/esqueci-senha` (SPEC-038).
