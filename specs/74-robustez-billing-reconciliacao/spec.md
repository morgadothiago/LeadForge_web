# SPEC-074 — Robustez de billing: reconciliação de checkouts, estado "ativando plano" e alerta ao admin — fullstack

- id: SPEC-074
- status: **DRAFT** (aguardando `APROVAR SPEC-074`) | domain: fullstack | criada em 2026-10-14 | depende de: 033/047/063 (billing/AbacatePay), 066 (cobranças), 065 (trial), 053 (cancelamento), 069 (planos), 056 (avisos a owners)
- Classificação: D-074-n = INFERRED. Nenhum código escrito.

## 1. Objetivo
Hoje o plano da organização só muda quando o **webhook** do AbacatePay chega. Em 2026-10-14 o webhook de dev apontava para um túnel morto: o cliente pagou (R$ 697 no AbacatePay), o app nunca soube, e o tenant ficou em Free com a tela girando "Confirmando seu pagamento…". Esta SPEC remove a dependência única do webhook e torna a falha visível.

## 2. Contexto (lido do código, 2026-10-14)
- `src/lib/billing/webhook-handler.ts`: autentica por `?webhookSecret=`; sem log de 401 até 2026-10-14 (agora há logs `[billing-webhook]`).
- `PaymentProvider` (`src/lib/billing/provider.ts`) **não tem** método para consultar checkout/assinatura/cobrança; o adapter AbacatePay (`providers/abacatepay.ts`) já tem cliente HTTP (`client`) usado na correlação do webhook (D-063-12).
- `Subscription.externalCheckoutId` guarda o checkout aberto; `BillingCharge` (066a) guarda cobranças; `processBillingEvent` (`process-event.ts`) é o caminho único que aplica o plano; `WebhookEvent` registra eventos recebidos.
- Tick de cron em `src/app/api/cron/tick/route.ts` + `src/lib/billing/shell-jobs.ts`, `reminders.ts`, `pix-renewal.ts` (padrão de jobs isolados com `.catch`).
- Tela `/configuracoes/assinatura` mostra "Confirmando seu pagamento…" (retorno `?checkout=success`) sem limite de tempo nem saída.

## 3. Escopo
### Backend
1. **`PaymentProvider.getCheckoutStatus(externalCheckoutId)`** (e/ou `listSubscriptions`) — mock, stripe (se aplicável) e abacatepay; só leitura, timeout, anti-SSRF no host fixo, erros mapeados (`provider-errors.ts`), nunca loga chave.
2. **Job de reconciliação no tick** (`reconcile-checkouts.ts`): para assinaturas com `externalCheckoutId` e sem `externalSubscriptionId`/período pago há mais de N minutos (padrão 10) e menos de M dias (padrão 7), consultar o provedor; se **pago**, sintetizar o mesmo evento que o webhook geraria e passar por `processBillingEvent` (idempotente: mesma chave de `WebhookEvent.eventId` com prefixo `reconcile:`). Limite por tick, isolado, sem lançar.
3. **Idempotência e isolamento:** nunca aplicar plano duas vezes (webhook tardio + reconciliação); nunca mexer em outra org; respeitar `lockOrg`.
4. **Alerta ao admin:** quando um checkout está pago no provedor mas sem evento local após N minutos, registrar em `PlatformAuditLog` e criar notificação para `platform_admin` (padrão do sino do admin, `docs/PROMPT_ADMIN_NOTIFICACOES_SIDEBAR.md`) — sem dados do cartão.
5. **Diagnóstico do webhook:** contador/último evento recebido por provedor (data do último `WebhookEvent` billing) exposto ao admin para ver "webhook mudo".

### Frontend
1. Em `/configuracoes/assinatura` com `?checkout=success`: estado "Pagamento recebido, ativando o plano" com **tempo máximo** (ex.: 90 s) e depois mensagem honesta com ação "Verificar agora" (dispara uma reconciliação pontual da própria org, com rate limit) e "Falar com o suporte". Sem girar para sempre.
2. Chip/banner coerentes durante a janela (não mostrar "Teste grátis" sem contexto quando há checkout pendente? decisão Q-074-3).
3. Admin: indicador "último webhook recebido há X" e lista de checkouts pagos sem evento, com botão "Reconciliar" (motivo, auditoria).
4. A11y/responsivo (390/1280, claro/escuro, alvos >= 44 px, `role=status`).

## 4. Fora do escopo
Trocar de provedor; reembolso/estorno; cobrança de PIX recorrente nova; mudar preços; túnel fixo (item de infra de dev, ver RETOMAR); reconciliar renovações antigas (histórico).

## 5. Critérios de aceitação
- AC-1: com webhook desligado, um checkout pago vira plano ativo em <= N minutos pelo tick, sem intervenção.
- AC-2: webhook + reconciliação juntos aplicam o plano **uma vez** (teste de corrida; uma `BillingCharge` por pagamento; um e-mail de confirmação).
- AC-3: checkout não pago/expirado não altera plano; org errada nunca é afetada (isolamento A/B/C).
- AC-4: admin é avisado de checkout pago sem evento e vê o último webhook recebido; tenant não vê dados de outras orgs.
- AC-5: tela de assinatura nunca fica girando indefinidamente; "Verificar agora" tem rate limit e só atua na própria org.
- AC-6: nenhuma chave/segredo/dado de cartão em log, props ou auditoria. tsc, eslint (0 erros), vitest verdes em banco `*_test` novo; E2E com webhook desligado propositalmente.

## 6. Testes
Provider mock com respostas pago/pendente/expirado/erro; reconciliação idempotente (duas execuções, webhook depois); corrida webhook x job; limites por tick; auditoria e notificação do admin; rate limit do "Verificar agora"; renderização dos estados da tela; sem rede real.

## 7. Riscos
Aplicar plano por engano (pagamento de outro cliente com mesmo e-mail): correlacionar **só** por `externalCheckoutId`/metadata da org, nunca por e-mail; custo/quota da API do provedor (limitar por tick e janela); divergência de contrato do AbacatePay (cobrir com fixtures da doc, padrão `abacatepay.test-helper.ts`); concorrência com `processBillingEvent` (usar o mesmo lock/idempotência).

## 8. Decisões e perguntas
- D-074-1 (INFERRED): a reconciliação **reutiliza `processBillingEvent`** (um só caminho de escrita de plano).
- Q-074-1 [BLOQUEANTE] Janela de reconciliação (idade mínima / máxima do checkout) e limite por tick? Recomendação: **10 min / 7 dias / 20 por tick**.
- Q-074-2 [BLOQUEANTE] O botão "Verificar agora" do tenant entra? Recomendação: **sim**, com rate limit (1 por 30 s por org).
- Q-074-3 Durante checkout pendente, esconder o chip "Teste grátis"? Recomendação: **manter o chip** e mostrar o estado "ativando plano" na assinatura.
- Q-074-4 Canal do alerta ao admin: sino interno apenas ou também e-mail? Recomendação: **sino + auditoria** (e-mail depois).
