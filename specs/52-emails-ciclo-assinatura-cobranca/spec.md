# SPEC-052 — E-mails do ciclo de assinatura e cobranca (trial, ativacao, recibo, falha/regua, recuperacao, proxima cobranca, troca de plano)
- status: DRAFT | domain: backend | depende de: 033, 039, 046, 047, 048 | catalogo: #3,#4,#5,#6,#7,#8,#9 (P0: 3,4,5,6; P1: 7,8,9)

## Objetivo
Separar os e-mails de cobranca por TIPO de evento (hoje um unico `subscription_success` dispara em todo evento active/trialing), criar recibo por mensalidade, notificar falha de cobranca no instante do evento e substituir o aviso unico do job diario por uma regua (D+0/D+3/D+5/D+7) - cobrindo mock, Stripe (stub) e AbacatePay (cartao e PIX). Esta SPEC tambem cria a infra de idempotencia generica reusada pelas SPECs 053-056.

## Contexto (lido no repo; o codigo venceu o diagnostico do doc)
- `processBillingEvent` (`src/lib/billing/process-event.ts:42-126`): a escrita de `WebhookEvent` (eventId `@unique`) e a 1a coisa da transacao (:56-64); reentrega do mesmo evento aborta com P2002 -> "duplicate" (:123) e NAO reenvia e-mail. Ou seja, o risco de duplicidade por reentrega do MESMO eventId nao existe; o risco real e de TEXTO ERRADO: o e-mail sai em todo evento distinto com status active/trialing (:99-107), sem olhar `event.type` nem a transicao anterior (renovacao `subscription.renewed` do cartao, PIX pago `transparent.completed` e troca de plano viram todos "Assinatura confirmada").
- O e-mail de "inicio do trial" praticamente nunca sai: o trial nasce direto no banco, sem evento de billing (`signUpAndStartCheckout`, `src/lib/actions/billing.ts:88-137`, subscription.create trialing; `createOrganization`, `src/lib/actions/org.ts:136-145`). Os adapters so emitem `status: "active"` (`providers/abacatepay.ts:225-243`, `providers/mock.ts:28-32`). O ramo `trialing` de `subscription-success.ts` so seria acionado por um evento trialing (stripe ainda stub, `providers/stripe.ts`).
- `payment.failed`/`payment.recovered` existem em `BillingEventType` (`provider.ts:49`) mas: so o PIX vencido gera `payment.failed` (`pix-renewal.ts:74-88`, eventId `abacatepay_pix_expired_<chargeId>`) e o mock; o AbacatePay NAO mapeia falha/recuperacao de cartao (`abacatepay.ts` so trata subscription.completed/renewed e transparent.completed). `payment.recovered` nao e produzido por nenhum adapter. process-event nao usa `event.type` para decidir e-mail.
- Falha de pagamento hoje: so `billing-reminder` `past_due_started` (`reminders.ts:97-106`) via job diario, 1 aviso por episodio (`BillingReminderLog @@unique([orgId,kind,anchorAt])`, `schema.prisma:1065-1080`); `auto_suspended` e `purge_warning` ja existem (:116-140). Enum `BillingReminderKind` tem 4 valores.
- `ParsedBillingEvent` (`provider.ts:51-63`) NAO carrega valor, metodo, final do cartao, n. do pedido/fatura: o recibo exigido no catalogo (valor/data/metodo/periodo/pedido) nao e montavel hoje; so da para derivar valor do `Plan.priceMonthlyCents/YearlyCents` (process-event.ts:100) - que pode divergir do valor realmente cobrado.
- Remetentes: `EmailScenario` (`src/lib/channels/email/scenario.ts:15`) e 2 tabelas (`SCENARIO_ENV_VAR` :17, `ACS_SCENARIO_ENV_VAR` :28); o doc diz "tres tabelas" - SMTP nao tem tabela propria, cai na do Resend (:44-50).
- `notifyOwners` esta DUPLICADO em `process-event.ts:17-27` e `reminders.ts:59-69` (mesma logica).
- Plano de cortesia/`selfServiceCheckout=false` nunca passa por esse fluxo (template ja ressalva `amountCents: null`).

## Escopo proposto
1. Infra generica de idempotencia: modelo aditivo `EmailDispatchLog { id, scenario, dedupeKey @unique, orgId?, userId?, createdAt }` (migration aditiva escrita a mao) e helper `sendOnce({dedupeKey, ...})` que INSERE a chave ANTES de enviar (padrao `BillingReminderLog`), P2002 = ja enviado. Helper unico `notifyOrgOwners` substituindo as 2 copias. Best-effort, nunca lanca.
2. Classificar o evento aplicado em `processBillingEvent` comparando estado ANTERIOR x NOVO (lido na propria transacao) + `event.type`: `trial_started`, `activated` (1a vez active), `renewed` (periodo avancou estando active), `recovered` (past_due -> active), `plan_changed` (planId/cadence mudou), `payment_failed`, `noop` (sem e-mail). Dedupe key = `eventId:<classe>`.
3. Enriquecer `ParsedBillingEvent` com campos OPCIONAIS `amountCents`, `paymentMethod` (`card|pix`), `cardLast4`, `externalPaymentId`, `paidAt` (preenchidos quando o provedor informa; fallback: preco do `Plan`, marcado como "valor do plano" internamente). Ver Q-052-3.
4. Templates novos (PT-BR, html+texto, `templates/layout.ts`): `trial-started`, `payment-receipt` (recibo: valor, data, metodo, final do cartao so 4 digitos, periodo, n. do pedido), `payment-failed` (com link absoluto `APP_BASE_URL/configuracoes/assinatura`), `payment-recovered`, `renewal-upcoming`, `plan-changed`; revisar `subscription-success` para so ativacao inicial. Cenarios novos em `EmailScenario` + tabelas Resend/ACS (todos `billing`).
5. Inicio do trial: disparado no signup/createOrganization apos o commit (nao via webhook), idempotente por `trial_started:<orgId>`. (Coordenar com boas-vindas da SPEC-055: um unico e-mail ou dois? Q-052-6.)
6. Regua de cobranca: novos `BillingReminderKind` (`past_due_d3`, `past_due_d5`, `past_due_d7`) ancorados em `pastDueSince` (mesmo padrao de `reminders.ts`); D+0 passa a sair NO evento (`payment_failed`) e o `past_due_started` do job vira fallback idempotente (mesma chave, sem duplicar). Datas e numero de tentativas por provedor: Q-052-4.
7. PIX: recibo ao `transparent.completed`; falha PIX ja cai em `payment.failed` (pix-renewal.ts:74); aviso "PIX da proxima cobranca gerado/vence em N dias" (usa `pixChargeId/pixChargeExpiresAt`, `pix-renewal.ts:99`) como item #8 para PIX.
8. Cartao AbacatePay: mapear eventos de falha/recuperacao (nomes a confirmar na documentacao do provedor; hoje nao suportados) - ver Q-052-5. Sem isso, a regua de cartao no AbacatePay so dispara pelo grace/estado.
9. "Proxima cobranca em N dias" (#8) em job diario via novo `BillingReminderKind` (`renewal_upcoming`), 7 dias antes para anual e PIX (Q-052-4).
10. Testes: snapshot de assunto/corpo por template; cenario->remetente (Resend+ACS); classificacao do evento (ativacao/renovacao/recuperacao/troca/falha); idempotencia sob reentrega do webhook, retry do job e corrida entre evento e job; falha do provider nao propaga/nao reverte a transacao; mocks, nunca provedor real.

## Fora do escopo
- Acao de cancelar/reativar (SPEC-053); PDF/nota fiscal (Q-052-1: so e-mail por padrao); cartao expirando (#18, P2 - adiado, depende de dado de cartao que o provedor nao expoe hoje); mudanca de timing de bloqueio (D-039-3 intacto: grace 7d, status-map.ts); novos provedores; SPEC de preco/reembolso.

## Criterios de aceitacao
- Renovacao mensal (cartao e PIX) envia 1 recibo (e nao "Assinatura confirmada"); 1a ativacao envia 1 confirmacao; trial novo envia 1 aviso de inicio; troca de plano envia aviso de troca.
- Reentrega do mesmo webhook, retry do tick e execucao concorrente evento x job nao geram e-mail duplicado.
- Falha de cobranca envia e-mail imediato; regua envia os passos configurados ate a suspensao e para ao recuperar (nenhum aviso apos `active`).
- Falha de provider/SMTP nunca propaga nem reverte a transacao; sem dado sensivel (so 4 ultimos digitos); links absolutos de `APP_BASE_URL`.
- `tsc`, lint e vitest verdes (incl. testes existentes 033/039/046/047).

## Seguranca / riscos
- Valor do recibo divergente do cobrado se vier so do `Plan` (risco fiscal/confianca) - mitigar com Q-052-3. Corrida evento x job na reserva de dedupe. Mudar a semantica de `subscription_success` afeta testes de `process-event-email.test.ts`. Migration aditiva escrita a mao (banco `leadforge` com drift: nunca `prisma migrate dev` nele).

## Decisoes pendentes
- Q-052-1 (D3 do doc): recibo = so e-mail com dados, ou PDF/nota fiscal (quem emite)? Recomendacao: so e-mail agora; PDF/NF em SPEC propria.
- Q-052-2: o recibo vale como comprovante legal ou apenas informativo ("nao e nota fiscal")? Define o rodape.
- Q-052-3: aceitar valor derivado do `Plan` quando o provedor nao informa valor, ou exigir valor do provedor (e omitir o recibo se ausente)?
- Q-052-4 (D4 do doc): regua D+0/D+3/D+5/D+7 igual para cartao e PIX? Cartao: provedor reintenta; PIX: LeadForge gera novo PIX a cada rodada. Grace atual e 7 dias (status-map.ts:16) - D+7 coincide com a suspensao; confirmar que o 4o aviso e "ultimo aviso antes de suspender".
- Q-052-5: confirmar nomes dos eventos de falha/recuperacao de cartao do AbacatePay (hoje nao mapeados) antes de implementar #6/#7 para cartao.
- Q-052-6: "inicio do trial" e "boas-vindas" (SPEC-055) sao e-mails separados ou um so no signup?
- Q-052-7: dividir esta SPEC em duas (052a recibo/ativacao/trial; 052b falha/regua/proximo/troca) para facilitar aprovacao?
