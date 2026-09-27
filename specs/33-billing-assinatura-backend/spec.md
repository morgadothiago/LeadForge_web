# SPEC-033 — Billing/assinatura: backend (planos, checkout, webhook, gating)
- status: IMPLEMENTED (dev-backend, 2026-09-26, rodada 2 — QA fix) | domain: backend | depende de: 030

## Objetivo
Cada `Organization` (Provider) assina um plano pago. Backend cobre: modelo de planos, checkout, webhook do provedor de pagamento, e bloqueio/downgrade de acesso conforme status da assinatura — usando o `Organization.status` ja preparado pela SPEC-030 (o cron ja respeita `status !== "active"`).

## Contexto
`package.json` nao tem nenhuma lib de pagamento instalada hoje (grep confirmado). Este e o primeiro SPEC de billing do projeto — nao ha decisao previa de provedor a preservar.

## Escopo
### Modelo de dados
- `Plan` (catalogo, definido pelo `platform_admin`, nao pelo Provider): `id`, `key` (slug estavel usado no codigo, ex. `starter`/`growth`/`scale`), `name`, `priceMonthlyCents`, `priceYearlyCents?`, `limits` (Json — ex. `{maxCampaigns, maxWhatsappInstances, maxLeadsPerMonth}`, formato exato definido junto com D-33-2), `active` (Boolean, permite descontinuar plano sem apagar historico), `stripePriceIdMonthly`/`stripePriceIdYearly` (ou equivalente do provedor escolhido em D-33-1).
- `Subscription`: `orgId` (unico — 1 assinatura ativa por org), `planId`, `status` (`trialing|active|past_due|canceled|incomplete`, espelha o vocabulario do provedor escolhido), `currentPeriodEnd`, `cancelAtPeriodEnd`, `externalCustomerId`, `externalSubscriptionId`, timestamps.
- `Organization.status` (SPEC-030) passa a ser **derivado** do `Subscription.status` por um mapeamento explicito (ex.: `active|trialing -> active`; `past_due -> active` com aviso, ate D-33-3 definir grace period; `canceled|incomplete -> suspended`) — escrito em um unico lugar (`src/lib/billing/status-map.ts`) para nao divergir do enforcement do cron.

### Checkout e portal
- Endpoint/action para iniciar checkout (`createCheckoutSession({orgId, planKey, cadence: "monthly"|"yearly"})`) — so `owner` da org (via `requireProviderOrg()`) inicia checkout para a propria org; `platform_admin` nao assina em nome de ninguem nesta fase.
- Endpoint/action para abrir o portal de gestao de assinatura do provedor (trocar cartao, ver faturas, cancelar) — se o provedor escolhido (D-33-1) tiver essa funcionalidade pronta (Stripe Billing Portal tem).
- Implementar atras de uma interface `PaymentProvider` (`src/lib/billing/provider.ts`: `createCheckoutSession`, `createPortalSession`, `verifyWebhookSignature`, `parseWebhookEvent`) — ver D-33-5: a integracao real do Stripe fica para depois (usuario ainda nao tem conta/chaves), entao esta SPEC implementa um `MockPaymentProvider` como implementacao default (via `PAYMENT_PROVIDER=mock` no env) e deixa o adapter Stripe real como stub documentado (`src/lib/billing/providers/stripe.ts`, chamadas reais comentadas/nao ativadas), pronto pra ativar so trocando env+chaves quando o usuario tiver conta.

### Webhook
- Novo Route Handler `POST /api/billing/webhook` (padrao de assinatura verificada por HMAC/assinatura do provedor, igual ao cuidado ja documentado para o webhook do WhatsApp em SPEC-012/017 — reaproveitar o padrao de validacao de assinatura de payload assim que aplicavel), idempotente por `eventId` (reaproveita o padrao de `WebhookEvent.eventId @unique` ja existente no schema, so muda `source`), processa eventos de: assinatura criada/atualizada/cancelada, pagamento falhou/recuperado — atualiza `Subscription` e por consequencia `Organization.status`. Com `PAYMENT_PROVIDER=mock`, o proprio checkout mock dispara esses eventos internamente (sem HTTP externo) pra exercitar o mesmo caminho de codigo do webhook real.
- Erros de HTTP de saida (chamadas ao SDK do provedor) seguem a regra transversal do projeto (axios, retry/backoff, PT-BR, sem vazar segredo — `web/specs/README.md` secao "Regras transversais"). So se aplica quando `PAYMENT_PROVIDER=stripe` estiver ativo.

### Gating de acesso
- Middleware/guard reaproveitando `Organization.status` (ja consumido pelo cron na SPEC-030): rotas autenticadas de Provider com org `suspended` mostram tela de "assinatura pendente" (nao apagam nem escondem dado, so bloqueiam acoes de escrita/operacao — leitura pode continuar liberada, decisao de UX fica com a SPEC-034/035, aqui so o guard no backend).
- `platform_admin` nunca e bloqueado por este gate (ele nao tem org "assinante" propria — ver D-30-1/D-33-4).

## Fora do escopo
- UI de pricing/checkout/portal (SPEC-034).
- Definicao final de precos/tiers reais (D-33-2 — aqui so o campo `limits`/`priceCents` no schema, populado com dados de teste ate o usuario aprovar os planos de verdade).
- Enforcement fino de `limits` (ex.: bloquear criacao da 4a campanha se o plano permite 3) — nasce aqui como schema, mas o enforcement em cada action de criacao (`createCampaign`, `createWhatsAppInstance` etc.) e trabalho incremental que pode virar SPEC-033-bis se o volume for grande; nesta SPEC o minimo obrigatorio e o gate de `Organization.status` (bloquear tudo quando suspenso), nao o limite fino por metrica.
- Qualquer coisa em `../mobile/`.

## Decisoes fechadas (usuario, 2026-09-25)

D-33-1: **Stripe**. Checkout Session + Billing Portal + webhooks. SDK `stripe` (Node) instalado nesta SPEC.

D-33-2: 3 tiers — `starter` (R$297/mes), `pro` (R$697/mes), `business` (sob consulta, sem checkout self-service, so contato/vendas). Cobranca mensal e anual (anual com desconto, ex. 2 meses gratis). **Precos e limites exatos sao PLACEHOLDER** — populam o schema `Plan` (via seed) para desenvolver o fluxo completo, mas precisam de confirmacao explicita do usuario antes de ir para producao (sinalizar isso no relatorio de entrega e no seed, ex. comentario `-- PLACEHOLDER: confirmar preco final antes do launch`).

D-33-3: Trial de 14 dias sem cartao obrigatorio na entrada. Falha de pagamento (`past_due`): grace period de 7 dias com acesso mantido (banner de aviso, SPEC-034), depois soft-block.

D-33-4: Soft-block imediato ao cancelar — dado preservado, leitura/export liberados, escrita/operacao bloqueada. Retencao de 90 dias apos cancelamento, depois job de expurgo/anonimizacao automatizado (cuidado com PII no mesmo espirito do mobile, ver D-M6 em `web/specs/README.md`). Esta SPEC inclui o job de expurgo (escopo confirmado, nao so o gate).

D-33-5 (usuario, 2026-09-25): **Usuario ainda nao tem conta/meio de pagamento configurado — integracao real do Stripe fica para depois.** Esta SPEC implementa a camada de billing inteira (schema, checkout, webhook, gating, portal) atras da interface `PaymentProvider`, rodando em modo `mock` por default (`PAYMENT_PROVIDER=mock` no `.env`): checkout mock marca `Subscription` como `trialing`/`active` direto, sem sair pra nenhum gateway externo, e dispara os mesmos eventos que o webhook real trataria. O adapter Stripe real (`providers/stripe.ts`) fica implementado como stub/interface pronta, sem chave configurada, documentado no relatorio de entrega como "trocar `PAYMENT_PROVIDER=stripe` + preencher `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` quando o usuario tiver a conta". Nada aqui bloqueia o fluxo de signup/trial/pricing, que funcionam ponta a ponta em mock.

## Criterios de aceitacao

| # | Criterio | Status | Evidencia |
|---|---|---|---|
| AC-001 | Checkout (modo `mock`) cria `Subscription` e reflete em `Organization.status`, com idempotencia por `eventId`. | PASS (rodada 2; FAIL na rodada de QA independente — idempotencia por `eventId` global so e uma garantia real se o `eventId`/evento so puder ser gerado por caminho autenticado; rodada 1 nao fechava isso no Route Handler HTTP, ver AC-003) | `process-event.test.ts` (11), `providers/mock.test.ts` (7), `webhook-handler.test.ts` (evento duplicado -> `duplicate`) |
| AC-002 | `owner` de uma org inicia checkout so para a propria org; nao ha como assinar em nome de outra org (teste). | PASS | `src/lib/actions/billing.test.ts` (owner/member/sem-sessao, injecao de `orgId` de outra org ignorada) |
| AC-003 | Webhook valida assinatura do provedor quando `PAYMENT_PROVIDER=stripe`; payload/erro nunca vaza segredo (chave do provedor) em log/toast/RSC. Em modo `mock`, o Route Handler HTTP exige autenticacao real (nao apenas "sem assinatura externa a validar") antes de processar qualquer evento. | PASS (rodada 2) — **FAIL na rodada de QA independente**: achado CRITICO — em modo `mock` (`PAYMENT_PROVIDER` default), `verifyWebhookSignature()` sempre retornava `true` e `parseWebhookEvent()` usava `orgId`/`status` crus do corpo HTTP sem nenhuma autenticacao, permitindo a qualquer chamador HTTP nao autenticado ativar/suspender a assinatura de qualquer org so sabendo o `orgId`. Corrigido: ver "QA fix — achado critico" abaixo. | `webhook-handler.test.ts`, bloco "QA fix (achado critico, rodada 2)" (4 testes: sem `Authorization` -> 401 sem mudar `Organization.status`; segredo errado -> 401 sem mudar status nem vazar o segredo valido; `MOCK_WEBHOOK_SECRET` ausente -> 503; segredo correto -> `processed`) |
| AC-004 | Suspensao por assinatura cancelada/falha bloqueia escrita/operacao (reusa gate de `Organization.status` da SPEC-030), sem apagar dado (a menos que D-33-4 decida o contrario). | PASS | `require-admin.test.ts`, `*-auth-coverage.test.ts`; `getInstanceQr`/`refreshInstanceStatus` migradas para `requireActiveProviderOrg()` na rodada 2 (achado menor — ver "QA fix" abaixo) |
| AC-005 | `PaymentProvider` trocavel por env sem mudar chamadores (`createCheckoutSession`/etc. nao sabem se estao em mock ou Stripe). | PASS | `provider-factory.ts` inalterado nesta rodada; `webhook-handler.ts` so acrescenta uma checagem ANTES de chamar `provider.verifyWebhookSignature`, sem os chamadores (`actions/billing.ts`) saberem do detalhe |
| AC-006 | build/lint/typecheck/testes OK, incluindo testes de webhook com assinatura valida/invalida, evento duplicado, e todos os status de transicao definidos no mapeamento. | PASS | ver "Testes executados (rodada 2, VERIFIED)" abaixo — 1216/1216 |

## Ordem de execucao
dev-backend, apos 030 `IMPLEMENTED`. Todas as decisoes (D-33-1..D-33-5) ja fechadas — pode implementar direto, com os precos de D-33-2 marcados como placeholder no seed e `PAYMENT_PROVIDER=mock` como default (Stripe real fica stub ate o usuario ter conta, D-33-5).

## Implementation Notes (dev-backend, 2026-09-26)

### Arquivos criados
- `prisma/schema.prisma`: enums `SubscriptionStatus`, `BillingCadence`; models `Plan` (catalogo global, sem orgId) e `Subscription` (`orgId` unico, indice em `status`); `Organization.subscription`/`Organization.purgedAt` (D-33-4).
- `prisma/migrations/20260926154947_billing_subscription_plan/migration.sql`.
- `src/lib/billing/provider.ts` — interface `PaymentProvider` (`createCheckoutSession`, `createPortalSession`, `verifyWebhookSignature`, `parseWebhookEvent`) + vocabulario proprio `BillingEventType`/`ParsedBillingEvent` (nao o nome literal do evento do provedor).
- `src/lib/billing/providers/mock.ts` — `MockPaymentProvider` (default): `createCheckoutSession` marca a `Subscription` `active` DIRETO e chama `processBillingEvent` (mesmo caminho de codigo do webhook HTTP real, D-33-5); `verifyWebhookSignature` sempre `true`.
- `src/lib/billing/providers/stripe.ts` — `StripePaymentProvider` (stub real, SDK `stripe` instalado via npm/D-33-1): `verifyWebhookSignature` usa `stripe.webhooks.constructEvent` de verdade; `createCheckoutSession`/`createPortalSession`/`parseWebhookEvent` lancam `AppError({code:"config"})` (nao ativados — sem `stripePriceId`/mapeamento de evento Stripe->vocabulario proprio implementados, D-33-5). So instanciado se `PAYMENT_PROVIDER=stripe` E `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` presentes (`provider-factory.ts`); NUNCA testado contra a API real (sem credenciais) — **NOT VERIFIED end-to-end**.
- `src/lib/billing/provider-factory.ts` — `getPaymentProvider(env)`, unico ponto que decide mock vs stripe.
- `src/lib/billing/status-map.ts` — `computeOrgStatus`/`syncOrgStatuses` (D-33-3 grace de 7d em `past_due`, D-33-4 soft-block imediato em `canceled`/`incomplete`), `TRIAL_DAYS`/`PAST_DUE_GRACE_MS`/`CANCEL_RETENTION_MS`.
- `src/lib/billing/process-event.ts` — `processBillingEvent`, unico caminho que escreve `WebhookEvent`+`Subscription`+`Organization.status` (idempotente por `WebhookEvent.eventId @unique` GLOBAL — `eventId` sempre gerado pelo provedor, nunca previsivel por org, sem risco do vazamento cross-tenant que ja mordeu a SPEC-030).
- `src/lib/billing/webhook-handler.ts` + `src/app/api/billing/webhook/route.ts` — Route Handler publico, mesmo padrao de corpo limitado/erro PT-BR/sem vazar segredo do webhook do WhatsApp (SPEC-012/017).
- `src/lib/billing/purge.ts` + `src/scripts/purge-canceled-orgs.ts` (`npm run billing:purge`) — job de expurgo D-33-4 (90 dias apos `canceledAt`): anonimiza `Lead` (nome/email/telefone/website/linkedin/rawData), `Touch` (content/subject) e `LeadNote` (body) via `scopedPrisma`, marca `Organization.purgedAt`. NAO apaga Campaign/Opportunity/StageHistory (auditoria agregada preservada) nem credenciais operacionais (EmailAccount/WhatsAppInstance — fora do escopo de PII de CONTATO, ver comentario no arquivo).
- `src/lib/actions/billing.ts` — `createCheckoutSession`/`createPortalSession` (owner-only via `requireProviderOrg()` + checagem de `Membership.orgRole==="owner"`; **nao** usam `requireActiveProviderOrg()` de proposito, para permitir reativar assinatura com a org suspensa) e `signUpAndStartCheckout` (D-35-1: publica como `login`, cria User+Organization+Membership(owner)+Subscription(trialing) numa `$transaction`, autentica e devolve `redirectTo`).
- `src/lib/schemas/billing.ts` — `checkoutSchema`/`signupSchema` (senha 12+, mesma regua do `ADMIN_PASSWORD`).
- 8 arquivos de teste (`status-map.test.ts`, `process-event.test.ts`, `webhook-handler.test.ts`, `providers/mock.test.ts`, `purge.test.ts`, `src/lib/actions/billing.test.ts`, `src/lib/auth/require-admin.test.ts`) — 55 testes novos.

### Arquivos alterados
- `src/lib/auth/require-admin.ts` — `requireActiveProviderOrg()` novo (`requireProviderOrg()` + `Organization.status==="active"`, lido do banco a cada chamada) e `OrgSuspendedError`. `requireProviderOrg()` (leitura) nao mudou.
- `src/lib/actions/result.ts` — `handleActionError` mapeia `OrgSuspendedError` -> mensagem PT-BR ("Assinatura pendente ou cancelada...").
- **Gate de escrita/operacao (criterio "Suspensao... bloqueia escrita/operacao")**: toda action de ESCRITA em `src/lib/actions/*.ts` trocou `requireProviderOrg()` -> `requireActiveProviderOrg()` (agent.ts, campaign.ts, email.ts, icp.ts, integration.ts, lead.ts, lead-search.ts, meeting.ts, pipeline.ts, sequence-start.ts, sequence.ts, suppression.ts, template.ts, whatsapp.ts, whatsapp-health.ts — ~55 pontos de chamada). Acoes de LEITURA dentro dessas mesmas actions (`getAgentUsage`, `getAgentRuns`, `getMeetingSettings`, `getInstanceQr`, `refreshInstanceStatus`, `getInstanceWebhookConfig`) e `meeting-search.ts` (busca) permanecem em `requireProviderOrg()` — leitura continua liberada com a org suspensa, so a escrita e bloqueada (decisao explicita da SPEC: "leitura pode continuar liberada"). Todos os testes estaticos de cobertura de auth (`*-auth-coverage.test.ts`, `use-server-auth.test.ts`, `auth.test.ts`, `agents.test.ts`) foram atualizados para reconhecer `requireActiveProviderOrg()` como guard valido.
- `src/lib/tenant/scoped-prisma.ts` — `subscription` adicionado a `DIRECT_ORG_MODELS`; `Plan` documentado como catalogo global (fora do escopo do policy layer, acessado via `prisma` direto, como `User`/`Organization`).
- `src/lib/scheduler/run-tick.ts` — `syncOrgStatuses(now)` chamado ANTES de selecionar as orgs ativas da rodada (cobre a expiracao do grace period de `past_due`, dependente do tempo); `purgeCanceledOrgs(new Date())` chamado no fim (isolado, como `sweepThrottled`).
- `prisma/seed.ts` — `seedPlans`/`PLAN_SEED` (3 planos PLACEHOLDER, ver abaixo) e a org de seed ganha uma `Subscription` `active` (plano starter) para nao ficar presa no gate por omissao.
- `src/lib/env.ts` — `PAYMENT_PROVIDER`/`STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` (todos opcionais; default mock).
- `.env.example` — documentado o bloco de billing.
- `package.json` — dependencia `stripe` (D-33-1) + script `billing:purge`.

### Preços/limites (D-33-2) — PLACEHOLDER, confirmar antes do launch
`starter` R$297/mes (R$2.970/ano) `{maxCampaigns:3,maxWhatsappInstances:1,maxLeadsPerMonth:500}` | `pro` R$697/mes (R$6.970/ano) `{maxCampaigns:10,maxWhatsappInstances:3,maxLeadsPerMonth:3000}` | `business` sob consulta, `selfServiceCheckout:false` (recusado tanto em `signUpAndStartCheckout` quanto em `createCheckoutSession`/`MockPaymentProvider`). Enforcement fino de `limits` explicitamente fora do escopo (ver spec.md "Fora do escopo").

### Migration
`npx prisma migrate dev --name billing_subscription_plan` aplicada no banco de dev (`leadforge`, docker local) e no banco de teste (`leadforge_test`, via `npm run test:db:reset`, que roda `migrate deploy` + seed). Nenhum dado existente perdido (`Organization`/demais tabelas so ganharam colunas/tabelas novas).

### Testes executados (VERIFIED)
- `npx tsc --noEmit` — sem erros.
- `npx eslint .` (projeto inteiro) — 0 erros, 4 warnings pre-existentes de estilo (`no-unused-vars` em parametros de stub intencionalmente nao usados, `providers/mock.ts`/`providers/stripe.ts`/`webhook-handler.test.ts`).
- `npx next build` — sucesso; `/api/billing/webhook` presente na lista de rotas dinamicas.
- `npm run test:db:reset` (recria o banco de teste do zero: `migrate deploy` + seed) — sucesso, confirma que a migration e o seed (`seedPlans`) rodam limpos numa base nova.
- `npx vitest run` (suite completa, banco de teste recem-recriado): **1212/1212 testes passando, 95/95 arquivos**. Cobertura nova relevante:
  - `status-map.test.ts` (9): todas as transicoes do mapeamento D-33-3/D-33-4, incluindo limite exato do grace de 7d.
  - `process-event.test.ts` (11): idempotencia por `eventId` (evento duplicado nao reaplica), `eventId` global nunca colide entre 2 orgs, `org_not_found`/`plan_not_found`, e as 5 transicoes de status (`trialing`/`active`/`past_due` dentro e fora do grace/`payment.recovered`/`canceled`/`incomplete`) refletidas em `Organization.status`.
  - `webhook-handler.test.ts` (10): assinatura valida (mock sempre `true`)/invalida (401, sem vazar segredo no corpo), payload JSON malformado e forma invalida (400), evento duplicado (200 `duplicate`), evento fora do vocabulario (200 `ignored`), org inexistente (200 `org_not_found`, nunca 500), e todos os 5 status de transicao exercitados via HTTP real (`POST` na rota).
  - `providers/mock.test.ts` (7): checkout marca `active` e persiste `WebhookEvent` via o MESMO `processBillingEvent` do webhook real; plano `business`/inexistente recusado; portal devolve URL; `verifyWebhookSignature` sempre `true`; JSON invalido lanca `AppError`.
  - `purge.test.ts` (5): cancelada <90d nao expurga; cancelada >90d anonimiza Lead/Touch/LeadNote e marca `purgedAt`; ja expurgada e idempotente; nunca toca outra org.
  - `src/lib/actions/billing.test.ts` (13): sem sessao -> "Sessao expirada"; `member` (nao-owner) -> "Sem permissao" em checkout/portal; owner -> sucesso; tentativa de "injetar" `orgId` de outra org no input e ignorada (campo nao existe no schema — impossivel assinar em nome de outra org, criterio de aceitacao); checkout funciona com a org suspensa (reativacao); signup cria trial ponta a ponta em modo mock sem nenhuma credencial externa, e-mail duplicado e plano `business` recusados, senha curta recusada.
  - `src/lib/auth/require-admin.test.ts` (4): `requireActiveProviderOrg` — active passa, suspended/cancelled lancam `OrgSuspendedError` (mas `requireProviderOrg`/leitura continua liberado), `platform_admin` nunca e bloqueado por este gate (D-33-4).
  - Suite pre-existente inteira (1195 testes de outras SPECs) permanece verde apos a retrofitagem do gate `requireActiveProviderOrg` nas actions de escrita (nenhuma regressao).
  - Observacao de ambiente: numa rodada anterior (banco de teste acumulado de sessoes passadas, nao recem-criado), `meeting-reminders.test.ts` (SPEC-028, nao tocado por esta SPEC) deu timeout isolado por causa do numero de `Organization` acumuladas no banco (o `sweepAlerts` varre todas as orgs ativas a cada chamada) — confirmado nao relacionado a esta SPEC (nenhum orgao "zz-" desta SPEC ficou orfao; o teste passa limpo com o banco de teste recem-recriado, como reportado acima).

### Decisoes arquiteturais
- Idempotencia do webhook reusa `WebhookEvent.eventId @unique` GLOBAL (nao composto com orgId) de proposito: `eventId` e SEMPRE gerado pelo provedor (Stripe garante unicidade global; o mock usa `crypto.randomUUID()`), nunca contem dado previsivel por org — elimina a classe de vazamento cross-tenant que ja apareceu 2x na SPEC-030 (colisao de campo unico global).
- Gate de escrita implementado como troca de import (`requireProviderOrg` -> `requireActiveProviderOrg`) nas ~55 chamadas de actions de escrita, em vez de um middleware/proxy global — aproveita a separacao ja existente `actions/` (escrita) vs `queries/` (leitura) do projeto; leitura nunca foi tocada.
- `Plan` e catalogo global (fora do `scopedPrisma`), consistente com o tratamento de `User`/`Organization` — sem endpoint de gestao nesta SPEC (cadastrado via seed, D-33-2).
- Job de expurgo (D-33-4) roda automaticamente a cada tick do scheduler (isolado, nunca derruba a rodada) + script manual (`npm run billing:purge`), em vez de um cron separado — reusa a cadencia ja existente (SPEC-013).

### Limitacoes conhecidas / trabalho futuro
- Adapter Stripe real (`providers/stripe.ts`) e stub: `createCheckoutSession`/`createPortalSession`/`parseWebhookEvent` lancam erro de configuracao ate serem implementados de verdade (falta `stripePriceId` cadastrado por Plan e o mapeamento evento-Stripe -> vocabulario proprio) — D-33-5 explicita que isso fica para quando o usuario tiver conta/chaves.
- Enforcement fino de `limits` por metrica (ex.: bloquear a 4a campanha) explicitamente fora do escopo (ver spec.md).
- UI de pricing/checkout/portal/banner de "assinatura pendente" fica para a SPEC-034 (aqui so o guard de backend, conforme o proprio spec.md pede).
- `signUpAndStartCheckout` roda num rate limit em memoria por processo (`SlidingLimiter`, 5/10min por IP) — mesma limitacao conhecida do rate limit de login do projeto (nao sobrevive a reinicio/nao e distribuido entre instancias).
- Regra transversal "HTTP de saida via axios com retry/backoff" (README): `providers/stripe.ts` usa o SDK oficial `stripe` (que tem seu proprio cliente HTTP interno), nao o wrapper `src/lib/http/client.ts`, para `verifyWebhookSignature` (`stripe.webhooks.constructEvent`, que e so verificacao HMAC local, sem chamada de rede). `createCheckoutSession`/`createPortalSession`/`parseWebhookEvent` (que fariam chamadas de rede de verdade) lancam erro ANTES de qualquer request sair — nenhuma chamada HTTP real acontece nesta SPEC. Quando o adapter for ativado de verdade (D-33-5), migrar essas chamadas para o padrao axios/retry do projeto (ou documentar explicitamente a excecao, ja que `stripe-node` tem seu proprio retry nativo) fica como decisao a revisitar nesse momento.

## Implementation Notes — rodada 2 (dev-backend, 2026-09-26, QA fix)

QA independente encontrou 1 achado CRITICO e 2 menores na rodada 1. `status` voltou para `IN_PROGRESS` ate o achado critico ser corrigido; agora todos os 3 estao corrigidos, suite completa verde, `status` volta para `IMPLEMENTED`.

### QA fix — achado CRITICO (Finding 1): webhook HTTP publico aceitava evento forjado em modo `mock`

**Problema confirmado pelo QA**: `POST /api/billing/webhook` e uma rota publica (sem sessao) cuja autenticacao deveria ser a assinatura HMAC do provedor real. Em modo `mock` (`PAYMENT_PROVIDER` default), `MockPaymentProvider.verifyWebhookSignature()` sempre retornava `true` e `parseWebhookEvent()` usava `orgId`/`status`/`planKey`/`cadence` crus do corpo HTTP sem nenhum vinculo com sessao/proveniencia. Qualquer chamador HTTP nao autenticado, sabendo o `orgId` de uma org, podia ativar a assinatura dela de graca ou suspende-la mandando `status:"canceled"`. A alegacao da rodada 1 ("`eventId` sempre gerado pelo provedor, nunca controlavel pelo chamador") so era verdadeira para o caminho INTERNO (`createCheckoutSession` -> `processBillingEvent` direto); nao valia para o Route Handler HTTP, que e o alvo real do risco (o proprio `webhook-handler.test.ts` da rodada 1 ja demonstrava esse comportamento sem reconhece-lo como vulnerabilidade).

**Correcao escolhida (opcao "a" do achado, segredo compartilhado, mesmo padrao ja usado no repo)**: quando o provider ativo e `mock`, o Route Handler HTTP exige ADICIONALMENTE `Authorization: Bearer <MOCK_WEBHOOK_SECRET>` (32+ chars) ANTES de sequer chamar `parseWebhookEvent`/`processBillingEvent` — mesmo padrao ja estabelecido no projeto para `CRON_SECRET` (`src/lib/scheduler/cron-endpoint.ts`, SPEC-013) e `INGEST_SECRET` (`src/lib/lead-ingest/config.ts`, SPEC-014): segredo lido do env (`getMockWebhookSecret()`), comparado em tempo constante (`secretsMatch`, SHA-256 + `timingSafeEqual`, reaproveitado de `cron-endpoint.ts`), ausente/curto => 503 `not_configured` (nunca fica aberta por omissao), presente mas errado => 401 sem vazar o segredo valido no corpo/log. Escolhida em vez da opcao "b" (correlacionar com `sessionId` de checkout) porque: (1) segue o padrao ja auditado e testado no proprio repo (3 outros webhooks/endpoints usam exatamente este mecanismo), (2) nao exige guardar estado de sessao de checkout do lado servidor so para o modo mock (que e transitorio ate o Stripe real ser ativado, D-33-5), (3) continua trivialmente substituivel pela assinatura HMAC real do Stripe quando `PAYMENT_PROVIDER=stripe` (o bloco novo so roda `if (provider.name === "mock")`, zero impacto no caminho Stripe).

O caminho INTERNO (`MockPaymentProvider.createCheckoutSession` chamando `processBillingEvent` direto, sem HTTP) continua funcionando sem esse segredo — nao e afetado pela mudanca, so o Route Handler HTTP publico.

**Arquivos**:
- `src/lib/env.ts` — `MOCK_WEBHOOK_SECRET` (opcional, sem tamanho minimo no schema zod — validado em runtime por `getMockWebhookSecret`, mesmo padrao de `CRON_SECRET`, para nao derrubar o app com env ausente).
- `src/lib/billing/config.ts` (novo) — `getMockWebhookSecret(env)`/`MIN_MOCK_WEBHOOK_SECRET_LENGTH` (32).
- `src/lib/billing/webhook-handler.ts` — bloco novo logo no inicio de `handleBillingWebhook`, antes de ler o corpo: `if (provider.name === "mock") { checa Bearer via bearerToken()/secretsMatch() (reaproveitados de cron-endpoint.ts) }`.
- `.env.example` — bloco de billing documentado com `MOCK_WEBHOOK_SECRET` (comentado, como os demais segredos opcionais do arquivo).
- `src/lib/billing/webhook-handler.test.ts` — `call()` agora inclui `Authorization: Bearer <secret-de-teste>` por padrao (`process.env.MOCK_WEBHOOK_SECRET` setado em `beforeAll`/limpo em `afterAll`, mesmo padrao de `process.env.CRON_SECRET` em `cron-endpoint.test.ts`); bloco novo de 4 testes (`describe("QA fix (achado critico, rodada 2)...")`) confirmando que payload sem `Authorization`, com `Authorization` errado, ou sem `MOCK_WEBHOOK_SECRET` configurado NUNCA muda `Organization.status` de nenhuma org (mesmo informando `orgId` real e `status:"canceled"`), e que o comportamento base (segredo correto -> `processed`) continua intacto.

### QA fix — achado menor (Finding 2): `getInstanceQr`/`refreshInstanceStatus` migradas para `requireActiveProviderOrg()`

Ambas fazem escrita no banco (`prisma.whatsAppInstance.update` com `lastError`/`status`/`lastConnectedAt`, via a funcao interna `record()`) e `getInstanceQr` chama o provider externo de WhatsApp — nao sao leitura pura. Decisao: migrar para `requireActiveProviderOrg()` (opcao preferida pelo QA, mais segura e consistente com o resto do gate de escrita/operacao da SPEC), em vez de documentar uma excecao. `src/lib/actions/whatsapp.ts`: as duas funcoes trocaram `requireProviderOrg()` -> `requireActiveProviderOrg()`; comentario inline explica o motivo (operacao, nao leitura). `getInstanceWebhookConfig` (so leitura, sem escrita) permanece em `requireProviderOrg()`, sem mudanca. Cobertura: `whatsapp-auth-coverage.test.ts` (aceita qualquer um dos guards validos, ja cobria) e `require-admin.test.ts`/`webhook-handler.test.ts` (comportamento generico de `requireActiveProviderOrg` ja testado); nenhum teste funcional quebrou (`whatsapp.test.ts` segue verde).

### QA fix — achado menor (Finding 3): `signUpAndStartCheckout` nao confirma mais existencia de conta

`src/lib/actions/billing.ts`: quando o e-mail ja esta cadastrado (`Prisma.PrismaClientKnownRequestError` P2002), a resposta trocou de erro de campo `email: ["Já existe uma conta com este e-mail."]` (confirmava existencia da conta, habilitando enumeracao num endpoint publico protegido so por rate-limit de IP) para um erro generico de formulario (`_form`): "Não foi possível concluir o cadastro com os dados informados. Verifique as informações e tente novamente, ou entre em contato com o suporte." — nao especifica o motivo, nao confirma nem nega a existencia da conta. `src/lib/actions/billing.test.ts` atualizado: confirma que a resposta e `ok:false` com `_form` preenchido e que a mensagem NAO contem "já existe"/variantes.

### Testes executados (rodada 2, VERIFIED)
- `npx tsc --noEmit` — sem erros.
- `npx eslint .` — 0 erros, mesmos 4 warnings pre-existentes de estilo (parametros de stub intencionalmente nao usados em `providers/mock.ts`/`providers/stripe.ts`/`webhook-handler.test.ts`; nenhum novo).
- `npx next build` — sucesso; `/api/billing/webhook` presente na lista de rotas dinamicas.
- `npm run test:db:reset` — sucesso (migrate deploy + seed, banco de teste recriado do zero).
- `npx vitest run` (suite completa, banco de teste recem-recriado): **1216/1216 testes passando, 95/95 arquivos** (1212 da rodada 1 + 4 novos do bloco "QA fix (achado critico, rodada 2)" em `webhook-handler.test.ts`; os testes de `whatsapp.test.ts`/`billing.test.ts` ajustados substituem casos existentes, sem alterar a contagem total de arquivos).

### Limitacoes conhecidas / trabalho futuro (adicionais a rodada 1)
- `MOCK_WEBHOOK_SECRET` e uma mitigacao para o modo `mock` (transitorio ate o Stripe real ser ativado, D-33-5); quando `PAYMENT_PROVIDER=stripe` for ligado, a autenticacao real passa a ser 100% a assinatura HMAC do Stripe (`verifyWebhookSignature`) — o bloco de `MOCK_WEBHOOK_SECRET` simplesmente nao roda (`provider.name !== "mock"`).
- Em producao, se alguem ligar `PAYMENT_PROVIDER=mock` sem configurar `MOCK_WEBHOOK_SECRET`, a rota fica 503 (nunca aberta) — mas o restante do fluxo de billing (checkout/trial via `signUpAndStartCheckout`/`createCheckoutSession`, caminho interno) continua funcionando normalmente, ja que nao depende da rota HTTP.
