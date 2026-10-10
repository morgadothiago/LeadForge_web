# SPEC-053 — Cancelamento e reativacao da assinatura pela app (+ e-mails)
- status: IMPLEMENTED (053a backend + 053b frontend, 2026-10-10) | domain: fullstack (## Backend, ## Frontend) | depende de: 033, 047, 052 (infra `sendOnce`/classificacao de evento) | catalogo: #10, #11, #12 (todos P0, #12 P1)

## Objetivo
Dar ao usuario uma ACAO de cancelar (e reativar) assinatura dentro do LeadForge e enviar os e-mails correspondentes: "pedido de cancelamento recebido (acesso ate DD/MM)", "cancelamento efetivado (retencao 90 dias, como reativar)" e "reativacao confirmada".

## Contexto (lido no repo)
- Nao existe acao de cancelar: `src/lib/actions/billing.ts` expoe so `createCheckoutSession` (:34), `createPortalSession` (:53) e `signUpAndStartCheckout` (:88). Cancelamento hoje so ocorre via portal do provedor/webhook.
- A interface `PaymentProvider` (`src/lib/billing/provider.ts:65-73`) nao tem `cancelSubscription`/`resumeSubscription`; o AbacatePay nao implementa gestao (`abacatepay.ts:208`: `subscriptions/cancel|change-plan` "nao implementados aqui"); Stripe e stub; mock so simula. PIX nao tem recorrencia no provedor (renovacao e do LeadForge: `pix-renewal.ts`) -> cancelar PIX = parar de gerar cobranca.
- `Subscription.cancelAtPeriodEnd` ja existe (`schema.prisma:1018+`) e e gravado de `event.cancelAtPeriodEnd` (`process-event.ts:76`); `canceledAt` ancora os 90 dias (`status-map.ts:19`). `computeOrgStatus` suspende IMEDIATAMENTE em `canceled` (`status-map.ts:31-33`, D-33-4 "soft-block imediato ao cancelar"): isso conflita com "acesso ate o fim do periodo" pedido no e-mail #10 - ver Q-053-1.
- E-mail atual `subscription-canceled` dispara quando `status === "canceled" && canceledAt` (`process-event.ts:108-116`) usando `currentPeriodEnd` como "acesso ate" e `purgeDate = canceledAt + 90d`; `canceledAt` e `existing?.canceledAt ?? now` (:68) - um segundo evento canceled nao reenvia por causa do eventId, mas cancelar -> reativar -> cancelar de novo reutiliza `canceledAt` nulo->now corretamente (reativar zera :68). Precisa revisao de texto ("acesso ate" so e verdadeiro se Q-053-1 mudar o soft-block).
- Aviso `purge_warning` aos 75 dias ja existe (`reminders.ts:129-140`).
- Destinatarios: owners da org ativa (`Membership.orgRole=owner`); acao so para owner (`requireOrgOwner` em `src/lib/actions/org.ts`).

## Escopo proposto
## Backend
1. Estender `PaymentProvider` com `cancelSubscription({orgId, atPeriodEnd})` e `resumeSubscription({orgId})` (mock implementado; stripe stub; abacatepay: cartao conforme API do provedor [Q-053-5], PIX = marcar no LeadForge e parar de gerar cobranca em `pix-renewal.ts`).
2. Server actions `cancelSubscription` / `reactivateSubscription` (owner da org ativa, `safeAction`, rate limit, confirmacao explicita, idempotente), aplicando o resultado pelo MESMO caminho `processBillingEvent`/`status-map.ts` (sem bloqueio paralelo).
3. Semantica "cancelar ao fim do periodo": `cancelAtPeriodEnd=true`, acesso mantido ate `currentPeriodEnd`, sem mudar `status-map` ate o fim do periodo (efetivacao pelo job/evento do provedor). Se escolhido imediato: usa o soft-block atual. Ver Q-053-1.
4. E-mails: `cancel-requested` (#10, imediato, com "acesso ate" e como reverter), revisar `subscription-canceled` (#11: efetivado + retencao 90 dias + como reativar + o que e apagado no expurgo), `subscription-reactivated` (#12). Cenarios novos (billing). Idempotencia via `sendOnce` (SPEC-052): `cancel_requested:<orgId>:<cancelRequestedAt|periodEnd>`, `reactivated:<orgId>:<ts>`.
5. Job de efetivacao para `cancelAtPeriodEnd` vencido quando o provedor nao envia evento (PIX/mock) - no tick, isolado.
6. Testes: cancelar ao fim do periodo mantem acesso e envia #10 uma vez; efetivacao envia #11 uma vez; reativar antes do fim limpa `cancelAtPeriodEnd` e envia #12; duplo clique/reentrega sem e-mail duplicado; nao-owner recusado; provider falhando nao reverte; PIX e cartao.
## Frontend
7. Em `configuracoes/assinatura`: botao "Cancelar assinatura" com modal de confirmacao (data de fim de acesso, retencao 90 dias, consequencias), estado "cancelamento agendado" com botao "Manter/reativar assinatura"; RHF + zod conforme padrao SPEC-042/045; acessibilidade e estados de loading/erro.

## Fora do escopo
- Reembolso proporcional automatico (so se Q-053-2 = sim -> SPEC propria); pesquisa de motivo de cancelamento/retencao; pausa de assinatura; exclusao de conta (SPEC-054).

## Criterios de aceitacao
- Owner cancela pela app, recebe #10 uma vez, mantem (ou perde, conforme Q-053-1) o acesso exatamente como o e-mail afirma; na efetivacao recebe #11 uma vez; reativa e recebe #12.
- Texto dos e-mails sempre coerente com o comportamento real do bloqueio (teste cruzando template x `computeOrgStatus`).
- Sem e-mail duplicado; sem regressao em 033/039/047; `tsc`, lint, vitest verdes.

## Seguranca / riscos
- Acao destrutiva: so owner, reautenticacao/confirmacao (Q-053-6), CSRF coberto por server actions, rate limit. Risco de divergencia estado local x provedor (cartao) ao cancelar; mitigar com webhook como fonte da verdade e reconciliacao. Cobranca indevida pos-cancelamento se o provedor falhar.

## Decisoes pendentes
- Q-053-1 (D1 do doc): cancelar ao FIM do periodo pago (padrao de mercado) ou imediato? O codigo atual faz soft-block imediato (D-33-4); ao fim do periodo exige reabrir D-33-4.
- Q-053-2 (D1): ha reembolso proporcional? (Recomendacao: nao; fora da SPEC.)
- Q-053-3: durante o trial, cancelar = efetivo imediato e retencao de 90 dias tambem?
- Q-053-4: reativacao dentro dos 90 dias mantem os dados (sim, ate o expurgo) - confirmar; apos expurgo, so novo cadastro?
- Q-053-5: AbacatePay tem endpoint de cancelar assinatura de cartao? (confirmar na doc do provedor; senao cancelamento de cartao depende de acao manual/portal).
- Q-053-6: exigir senha para confirmar o cancelamento?
- Q-053-7: dividir em SPEC backend + SPEC frontend (preferivel pelo fluxo SDD)?

## Decisoes registradas (2026-10-10, usuario aprovou com as recomendacoes do RETOMAR secao 3 item 4)
- D-053-1 (Q-053-1, CONFIRMED): cancelar = acesso ate o fim do periodo pago (`cancelAtPeriodEnd=true`; `status-map` so suspende apos `currentPeriodEnd`). Reabre e substitui D-33-4 (soft-block imediato) APENAS para cancelamento voluntario; retencao 90 dias passa a contar da efetivacao.
- D-053-2 (Q-053-2, CONFIRMED): sem reembolso proporcional.
- D-053-3 (Q-053-3, INFERRED, conservador): cancelar durante o trial = efetivo imediato, mesma retencao de 90 dias.
- D-053-4 (Q-053-4, INFERRED): reativacao dentro dos 90 dias mantem os dados; apos expurgo so novo cadastro.
- D-053-5 (Q-053-5, INFERRED): cancelamento de cartao no AbacatePay sem endpoint confirmado = marcado no LeadForge + parar de gerar cobranca; chamada ao provedor via adapter com fallback documentado.
- D-053-6 (Q-053-6, INFERRED): confirmacao explicita em modal (sem exigir senha).
- D-053-7 (Q-053-7, CONFIRMED): dividida em 053a (backend) e 053b (frontend).
- Decisoes transversais: (c) recibo = so e-mail informativo; (d) regua de cartao e PIX igual.

## Implementation Notes — 053a (backend)
- Sem migration (usa `cancelAtPeriodEnd`/`canceledAt`/`currentPeriodEnd` existentes). Banco de teste `leadforge_053_test` criado via `test:db:reset`; banco de dev NAO tocado.
- Arquivos: `src/lib/billing/provider.ts` (+`cancelSubscription`/`resumeSubscription`), `providers/{mock,stripe,abacatepay}.ts`, `status-map.ts` (`computeOrgStatus` aceita `cancelAtPeriodEnd`/`currentPeriodEnd`: suspende a partir do fim do periodo), `process-event.ts` (e-mails #10/#11/#12), `classify-event.ts`, `cancel-effective.ts` (job) + `scheduler/run-tick.ts`, `pix-renewal.ts` (ignora `cancelAtPeriodEnd`), `actions/billing.ts` (`cancelSubscription`, `reactivateSubscription`), templates `cancel-requested.ts`, `subscription-reactivated.ts`, `subscription-canceled.ts` (revisado: `accessEndedAt` + link), `email/scenario.ts` (+`cancel_requested`, `subscription_reactivated`), testes `actions/billing-cancel.test.ts`, `templates.test.ts`, `webhook-handler.test.ts`.
- Decisoes: provider falhando => action falha e NADA e gravado (sem divergencia); AbacatePay sem endpoint => fallback local (`providerConfirmed:false`); reativar apos efetivacao = novo checkout (`createCheckoutSession`), `reactivateSubscription` so desfaz cancelamento agendado; chave #10 = `cancel_requested:<orgId>:<now ISO>`, #12 = `reactivated:<orgId>:<now ISO>`.
- Verificacao: tsc limpo; eslint 0 erros; vitest completo 151 arquivos / 1888 testes VERIFIED.
- Limitacoes: cartao AbacatePay pode continuar cobrando ate cancelamento manual no provedor; Stripe e stub; reativar org ja expurgada nao e tratado aqui.

## Implementation Notes — 053b (frontend)
- Sem migration. Arquivos: `src/components/billing/CancelSubscriptionPanel.tsx` (novo: botao Cancelar + modal RHF+zod com checkbox de confirmacao, aviso "cancelamento agendado" + "Manter assinatura", aviso "cancelada" + "Reassinar" ancorado em `#planos`), `CancelSubscriptionPanel.test.tsx` (novo), `SubscriptionSummaryCard.tsx` (integra o painel; texto "Proxima cobranca" so quando nao ha cancelamento), `PlanSelectionSection.tsx` (`id="planos"`), `billing-format.ts` (`RETENTION_DAYS`, `cancelUiState`, `purgeDateFor`), `lib/schemas/billing.ts` (`cancelConfirmSchema`), `lib/queries/billing.ts` (`SubscriptionView.canceledAt`).
- Decisoes: botoes so para owner (mesmo gating da pagina; nao-owner ve apenas o aviso de estado); modal mostra data de fim de acesso, retencao 90 dias (com data de expurgo), "sem reembolso" e, em trial, efeito imediato; apos sucesso `router.refresh()` + toast; erros da action (incl. rate limit) no `role="alert"` do modal; reassinar = nova contratacao pelo fluxo de selecao de plano ja existente (`createCheckoutSession`), sem nova action; agendado com periodo vencido e tratado como "cancelada".
- Verificacao (VERIFIED): `tsc --noEmit` limpo; eslint 0 erros (18 warnings preexistentes); vitest completo 152 arquivos / 1896 testes (TEST_DATABASE_URL=leadforge_053_test).
- Limitacoes: interacao do modal (submit/foco) coberta por SSR + schema, nao por teste de browser; validacao visual em 375/768/1280 e dark mode feita so por revisao de classes (tokens do design system), nao em navegador.
