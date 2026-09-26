# SPEC-033 — Billing/assinatura: backend (planos, checkout, webhook, gating)
- status: APPROVED (usuario, 2026-09-25) | domain: backend | depende de: 030

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
- [ ] Checkout (modo `mock`) cria `Subscription` e reflete em `Organization.status`, com idempotencia por `eventId`.
- [ ] `owner` de uma org inicia checkout so para a propria org; nao ha como assinar em nome de outra org (teste).
- [ ] Webhook valida assinatura do provedor quando `PAYMENT_PROVIDER=stripe`; payload/erro nunca vaza segredo (chave do provedor) em log/toast/RSC. Em modo `mock`, sem assinatura externa a validar, mas o mesmo parser/handler e exercitado.
- [ ] Suspensao por assinatura cancelada/falha bloqueia escrita/operacao (reusa gate de `Organization.status` da SPEC-030), sem apagar dado (a menos que D-33-4 decida o contrario).
- [ ] `PaymentProvider` trocavel por env sem mudar chamadores (`createCheckoutSession`/etc. nao sabem se estao em mock ou Stripe).
- [ ] build/lint/typecheck/testes OK, incluindo testes de webhook com assinatura valida/invalida, evento duplicado, e todos os status de transicao definidos no mapeamento.

## Ordem de execucao
dev-backend, apos 030 `IMPLEMENTED`. Todas as decisoes (D-33-1..D-33-5) ja fechadas — pode implementar direto, com os precos de D-33-2 marcados como placeholder no seed e `PAYMENT_PROVIDER=mock` como default (Stripe real fica stub ate o usuario ter conta, D-33-5).
