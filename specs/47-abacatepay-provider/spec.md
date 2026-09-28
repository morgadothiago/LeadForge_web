# SPEC-047 — AbacatePay como adapter adicional de PaymentProvider
- status: IMPLEMENTED (dev-backend, 2026-09-27; QA APPROVED) | domain: backend | depende de: 033 (billing, interface PaymentProvider/D-33-5)

## Objetivo
Adicionar AbacatePay (gateway brasileiro, foco em PIX) como MAIS UM adapter da interface `PaymentProvider` (`src/lib/billing/provider.ts`, mesmo padrao ja usado pro `stripe.ts` stub, D-33-5): implementacao pronta, SEM chave configurada, documentada pra ativar via `PAYMENT_PROVIDER=abacatepay` quando o usuario tiver conta. NAO substitui `mock`/`stripe` — vira uma 3a opcao. Nenhuma mudanca no resto do fluxo (checkout/webhook/gating, SPEC-033/034).

## Levantamento da API do AbacatePay (pesquisa na documentacao oficial, docs.abacatepay.com — nao inventado)
- **Auth**: header `Authorization: Bearer <API_KEY>` (`ABACATEPAY_API_KEY`). Sem URL de sandbox separada — o ambiente (dev/producao) e determinado pela propria chave usada; toda resposta traz `devMode: true/false`.
- **Checkout hospedado** (equivalente a `createCheckoutSession`): `POST /v2/payment/create` com `items` (id de produto + quantidade cadastrado no dashboard AbacatePay), retorna `data.url` — redireciona o cliente pra la, ele paga (PIX ou cartao) e volta.
- **Assinatura/recorrencia REAL** (cobranca automatica recorrente gerenciada pela AbacatePay, sem o LeadForge precisar reimplementar logica de ciclo): `POST /v2/subscriptions/create` — **CRITICO, achado da pesquisa: suporta SO cartao de credito tokenizado, PIX NAO e suportado para ciclos recorrentes nesse endpoint** (confirmado na doc oficial). Gestao: `subscriptions/cancel`, `subscriptions/change-plan`, `subscriptions/get`/`list`. Suporta `trialDays` e `retryPolicy` configuravel pra falha de cobranca.
- **PIX avulso** (sem recorrencia nativa): `POST /v2/transparents/create` (`method: "PIX"`) — retorna `brCode` (copia-e-cola) + `brCodeBase64` (QR pronto) + `expiresAt`; cobranca UNICA, sem vinculo a ciclo/assinatura.
- **Webhook**: payload `{id, event, apiVersion, devMode, data}`; eventos incluem `checkout.completed`, `subscription.completed`, `subscription.renewed`, entre outros. Autenticacao em 2 camadas: (1) `webhookSecret` definido por voce, sempre enviado como QUERY PARAM na URL de callback (essa e a autenticacao REAL, por conta); (2) header `X-Webhook-Signature` (HMAC-SHA256) calculado com uma chave PUBLICA documentada, igual pra todas as contas — nao e um segredo por conta, e so uma camada extra, nao substitui o `webhookSecret`. Retry com backoff (5s a 10h, ate 7 tentativas em ~18h); sucesso = qualquer 2xx.
- **Portal do cliente/self-service**: NAO EXISTE (confirmado — nenhuma pagina hospedada tipo Stripe Billing Portal). Cancelar/trocar plano/ver faturas so via chamada de API que o BACKEND do LeadForge faz, nunca uma pagina que o cliente final acessa direto.
- **PIX**: `expiresIn` configuravel (segundos) na criacao; resposta traz `brCode`/`brCodeBase64` prontos (nao precisa gerar QR); endpoint de "simular pagamento" so em dev mode, util pra testar o fluxo de webhook sem esperar pagamento real.

## Implicacao critica pro desenho (por isso a decisao abaixo e obrigatoria antes de implementar)
O LeadForge hoje (SPEC-033) e um SaaS de assinatura RECORRENTE (mensal/anual). O AbacatePay so tem recorrencia automatica de verdade via CARTAO — PIX e so cobranca avulsa. Ou seja, "PaymentProvider AbacatePay com foco em PIX" tal como pedido choca com "assinatura recorrente": ou (a) o adapter usa `subscriptions/create` do AbacatePay mas isso so funciona com cartao (perde o foco em PIX que motivou a escolha), ou (b) o adapter usa PIX avulso e o LeadForge PRECISA implementar a logica de recorrencia (gerar uma nova cobranca PIX a cada ciclo, checar vencimento, etc. — trabalho extra que o Stripe/o proprio conceito de `Subscription` do LeadForge nao precisa fazer hoje, porque o provedor cuida disso).

## Escopo proposto (para a opcao escolhida em D-047-1)
- `src/lib/billing/providers/abacatepay.ts` implementando `PaymentProvider`: `createCheckoutSession` (`POST /payment/create` ou `subscriptions/create`, conforme D-047-1), `createPortalSession` — **NAO EXISTE equivalente no AbacatePay** (confirmado na pesquisa); documentar como limitacao/fora de escopo, retornar erro tratado "Gestao de assinatura indisponivel para este provedor" em vez de quebrar, `verifyWebhookSignature` (validar o `webhookSecret` da query string — a autenticacao real — e/ou o `X-Webhook-Signature`, documentando que a chave HMAC e publica/nao e segredo por conta), `parseWebhookEvent` (mapear `checkout.completed`/`subscription.completed`/`subscription.renewed`/etc. pro vocabulario interno do LeadForge, `status-map.ts`).
- `ABACATEPAY_API_KEY` + `ABACATEPAY_WEBHOOK_SECRET` no `.env.example`, sem valor real, stub inativo (igual ao Stripe — nenhuma chamada de rede real ate a chave existir).
- Testes com mock/fixture da API do AbacatePay (nunca chamar API real), mesmo padrao do stub Stripe (`src/lib/billing/providers/stripe.test.ts` se existir, ou o padrao de teste ja usado nos outros adapters).

## Fora do escopo
- Portal de gestao de assinatura pelo cliente final (nao existe no AbacatePay — se o usuario quiser isso especificamente pro AbacatePay, precisaria ser construido do zero no LeadForge, fora desta SPEC).
- Qualquer coisa em `../mobile/`.

## Decisoes fechadas (usuario, 2026-09-27)

D-047-1: HIBRIDO — o Provider escolhe cartao OU PIX no checkout. Cartao usa `subscriptions/create` do AbacatePay (recorrencia REAL nativa, gerenciada por eles: cobranca automatica, `retryPolicy`, `trialDays`). PIX usa `transparents/create` (cobranca avulsa) com a RENOVACAO controlada pelo LeadForge: um job (reaproveitar o cron/tick, SPEC-013/030) gera uma nova cobranca PIX a cada periodo de cobranca da `Subscription` (mensal/anual conforme o plano), acompanha a confirmacao via webhook (`transparent.completed` -> marca o periodo pago, atualiza `currentPeriodEnd`), e trata a falta de pagamento no vencimento com o MESMO mapeamento de `past_due`/grace period/suspensao ja existente em `status-map.ts` (SPEC-033) — nao criar um mecanismo de bloqueio paralelo, reaproveitar o que ja existe tratando "PIX vencido sem pagamento" como equivalente a "cartao recusado" no fluxo de `past_due`.

D-047-2: Usar o padrao de webhook do AbacatePay como esta (`webhookSecret` na query string, comparacao em tempo constante) — e o unico oferecido pela plataforma. Mitigacao: nunca logar a URL completa do webhook (callback URL com o secret) em nenhum lugar do sistema (log, erro, auditoria) — mesmo cuidado ja aplicado aos demais webhooks do projeto.

## Riscos
- Documentacao publica do AbacatePay e menos completa que a do Stripe em alguns pontos (ex.: nao foi possivel confirmar o valor DEFAULT de expiracao de PIX, alguns endpoints so foram vistos por resumo de busca, nao fetch direto) — o dev-backend deve revalidar os contratos exatos de request/response direto na doc interativa deles antes de fechar o adapter, nao confiar so nesta spec.
- Sem portal de self-service: qualquer fluxo de cancelamento/troca de plano pro Provider que escolher AbacatePay precisa passar pelo backend do LeadForge chamando a API deles — isso e mais trabalho que simplesmente redirecionar pro Stripe Billing Portal (Stripe) e deve ser considerado se/quando o usuario decidir ativar este provedor de verdade.

## Ordem de execucao
Backend (dev-backend), unica frente, depois QA. Aprovada, decisoes fechadas — pode implementar direto. Escopo do job de renovacao PIX (D-047-1) faz parte desta mesma SPEC, nao uma spec separada.

## QA (2026-09-27) — QA APPROVED (com QA fix aplicado)

Verificado: adapter `abacatepay.ts` (D-047-1 hibrido — cartao via `subscriptions/create`, PIX via `transparents/create` + `createPixCharge`); `createPortalSession` devolve erro tratado `AppError(config)` sem quebrar; `verifyWebhookSignature` compara em tempo constante (`timingSafeEqual`) e nunca loga o segredo/URL; `parseWebhookEvent` mapeia `subscription.completed`/`subscription.renewed`/`transparent.completed` pro vocabulario interno (sem `metadata.orgId/planKey/cadence` → null, nunca 500); `provider-factory.ts` so instancia com `PAYMENT_PROVIDER=abacatepay` + as 2 envs (ausentes → erro claro, app segue em mock); job `runPixRenewalJob` ligado no `run-tick.ts` (renova PIX por ciclo; PIX vencido vira `past_due` pelo MESMO `status-map.ts`, idempotente por eventId; erro de uma org nao derruba o tick); `.env.example` documenta as envs e o D-047-2; `abacatepay.test.ts` + `pix-renewal.test.ts` com fixtures/mocks, zero chamada de rede.

**QA fix (critico):** o receiver compartilhado (`webhook-handler.ts`) so extraiava o header `stripe-signature` — o `?webhookSecret=` da URL de callback (unica autenticacao real por conta, D-047-2) nunca chegava em `verifyWebhookSignature` e TODO webhook do AbacatePay receberia 401 em producao, inviabilizando a confirmacao de PIX do D-047-1. Fix aplicado: fallback `header ?? searchParams.get("webhookSecret")` (header Stripe mantem precedencia — fluxo Stripe inalterado; URL completa continua nunca logada). Novos testes em `webhook-handler.test.ts`: secret correto → 200, errado → 401 sem vazar o segredo, ausente → 401, precedencia do header sobre a query.

**Evidencia:** `npx vitest run src/lib/billing` → 10 arquivos / 106 testes verdes; suite completa `npm test` → 123 arquivos / 1489 testes verdes; `tsc --noEmit` 0 erros; `eslint` 0 erros; `next build` OK.

**Limitacao de producao mantida:** nunca testado contra a API real do AbacatePay (sem credenciais) — campos marcados ASSUMIDO no adapter precisam de revalidacao na doc interativa antes de ativar de verdade (ja previsto em "Riscos").
