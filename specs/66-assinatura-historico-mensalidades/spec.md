# SPEC-066 — Assinatura por plano: historico de mensalidades (Starter/Pro) e cartao do teste (Free)

- id: SPEC-066
- status: **APPROVED** (2026-10-12, usuario: "APROVAR SPEC-066"; Q-066-1/2/3/9 respondidas, Q-066-4..8 = recomendacoes aceitas; PIX no checkout INCLUIDO; divisao 066a/066b/066c) | andamento: 066a em implementacao
- domain: **fullstack** (066a backend / 066b frontend; `## Backend`, `## Frontend`). Ordem: dev-backend -> qa-reviewer -> dev-frontend -> qa-reviewer.
- depende de: 033/034 (billing), 047 (PIX/renovacao), 052 (recibos), 053 (cancelar), 062/063 (AbacatePay v2), **065 (Free/trial; 065a/065b ja implementadas, aguardando QA/commit)**
- fonte: `docs/PROMPT_ASSINATURA_HISTORICO_COBRANCAS.md` (pedido do usuario, 2026-10-12)
- Classificacao: o PEDIDO (tela por plano; lista de mensalidades no lugar da grade "Trocar de plano" para Starter/Pro) e **CONFIRMED** (usuario). Tudo marcado D-066-n e **INFERRED** (recomendacao minha, revisavel). Q-066-n sao perguntas abertas; as **[BLOQUEANTE]** precisam de resposta antes de `APROVAR`.

## 1. Objetivo
A pagina `/configuracoes/assinatura` mostra conteudo diferente por situacao da organizacao:

| Situacao | O que mostra |
|---|---|
| Free (`trialing`, plano `free`) | Cartao do periodo de teste (dias restantes, data de termino, barra "dia X de 14", `UsageMeter`, aviso dos ultimos 3 dias, CTA "Fazer upgrade") + grade de planos. Sem "Cancelar"/"Gerenciar". |
| Starter / Pro (assinante) | Cartao do plano atual (como hoje) com botao secundario **"Trocar de plano"** (abre a grade num painel/modal, mesmos componentes da 065b). **No lugar da grade**, a lista **"Mensalidades"** (uma linha por mensalidade, ordem cronologica: competencia, vencimento, valor, status, data do pagamento; status Paga / A pagar / Atrasada / Falhou / Reembolsada / Cancelada), resumo no topo (total pago, proxima mensalidade, faixa de alerta de atraso), estado vazio, "carregar mais". |
| Trial expirado / bloqueado | Inalterado (painel da 065b). |
| Business / cortesia / sem assinatura (admin) | Inalterado; historico so se houver cobrancas. |

A lista e a mesma para qualquer plano pago (sem `if` por plano; muda so nome do plano e valor por linha).

## 2. Contexto: o que o codigo faz hoje (conferido lendo o repositorio, 2026-10-12)
1. **Nao existe modelo de cobranca/fatura.** `schema.prisma` tem `Subscription` (1 por org: `status`, `cadence`, `currentPeriodEnd`, `pastDueSince`, `pixManaged`, `pixChargeId`, `pixChargeExpiresAt`, `externalSubscriptionId`, `externalCheckoutId`), `Plan`, `BillingProduct`, `BillingReminderLog`, `WebhookEvent` (so `{type, planKey, status}` no `payload`) e `EmailDispatchLog`. Nada guarda valor/vencimento/pago por mensalidade.
2. `processBillingEvent` (`src/lib/billing/process-event.ts`): numa transacao Serializable grava `WebhookEvent` (idempotencia por `eventId` unico; P2002 -> `duplicate`), faz `upsert` da `Subscription` e atualiza `Organization.status`. O valor/`paidAt`/`externalPaymentId`/metodo/`cardLast4` chegam em `ParsedBillingEvent` (campos opcionais), mas **so alimentam e-mail de recibo**; **nada e persistido**.
3. **O que o AbacatePay v2 realmente envia** (fixtures literais em `src/lib/billing/providers/__fixtures__/abacatepay/`; parser em `providers/abacatepay-webhook.ts`; `metadata` NAO volta; a doc manda nao validar o payload inteiro, so ler com guardas):
   - `subscription.completed` e `subscription.renewed` (cartao): `subscription{id subs_, amount, currency, method, status, frequency}`, `payment{id char_, amount, paidAmount, status "PAID", receiptUrl, createdAt, updatedAt}`, `payerInformation{method, CARD{number(4 ultimos), brand}}`, `checkout{id bill_, url, ...}`. Tem **valor, pagamento, data e `receiptUrl`**.
   - `subscription.payment_failed`: **apenas** `subscription{id, amount, method, frequency, retryPolicy{maxRetry, retryEvery}}`, `installmentId` (`intl_...`), `installmentNumber`, `retryNumber`. **Nao** traz `payment.id`, vencimento, motivo da recusa nem link. O parser atual nao le `installmentId/Number` (so loga `retryNumber`).
   - `subscription.cancelled`: `subscription{..., canceledAt, cancelPolicy, cancelledDueTo}` (`max_payment_retries_exceeded` = por falhas).
   - `transparent.completed` (PIX avulso): `transparent{id char_, amount, paidAmount, status PAID, receiptUrl, updatedAt}`; sem `subscription`. Correlacao por `Subscription.pixChargeId` (aceita `pix_char_`/`char_`).
   - `transparents/create` (resposta da API, nao webhook): `id pix_char_..., amount, status PENDING, brCode, brCodeBase64, expiresAt, receiptUrl:null`.
   - Eventos reconhecidos e ignorados hoje: `checkout.refunded/disputed/lost`, `transparent.refunded/disputed/lost`, `subscription.trial_started`, `subscription.plan_changed` (**reembolso existe como evento, mas hoje e descartado**).
4. **PIX** (`pix-renewal.ts`, AbacatePay nao tem recorrencia PIX): o job so guarda `pixChargeId` + `pixChargeExpiresAt` na `Subscription` (1 pendente por vez); **o `brCode`/QR NAO e persistido** (so existe na resposta do `createPixCharge`; hoje ninguem o mostra depois). Expirada sem pagar -> `processBillingEvent` com `eventId abacatepay_pix_expired_<chargeId>` (`payment.failed`, `past_due`), limpa o `pixChargeId`.
5. **Link de pagamento:** `createPortalSession` do AbacatePay **lanca "Gestao de assinatura indisponivel"** (nao ha portal). O checkout de cartao (`bill_...url`) so aparece no webhook e na criacao; nao e persistido. Logo, **"Pagar agora" so e possivel de forma real para PIX** (gerando nova cobranca via `createPixCharge`/`createCheckoutSession({method:"pix"})`, que ja existem) e para recontratar cartao via novo checkout (`createCheckoutSession`). Para cartao `past_due` o provedor reprocessa sozinho (`retryPolicy`); nao ha "tentar de novo" por API conhecida.
6. **Regua existente** (`status-map.ts`, `reminders.ts`): `past_due` com grace de 7 dias, soft-block, lembretes D+3/D+5/D+7, cancelamento por `max_payment_retries_exceeded`. A UI nao pode contradizer isso.
7. **Papeis:** `OrgRole` so tem `owner` e `member` (nao ha `admin` de organizacao; "admin" no prompt = `platform_admin`). `requireOrgOwner`/`getBillingSummary` ja expoem `isOwner`.
8. Tela atual (`assinatura/page.tsx`): `SubscriptionSummaryCard` + `UsageMeter` + `PlanSelectionSection` sempre visivel (grade + toggle mensal/anual); `TrialBlockedPanel` no bloqueio.

## 3. Escopo
- Persistir cada cobranca em novo modelo `BillingCharge`, alimentado por `processBillingEvent` (cartao e PIX) + job PIX.
- `getBillingHistory` (query com cursor, filtro, resumo) e permissao por papel.
- Reorganizar a pagina por situacao (tabela da secao 1); componentes novos de lista/resumo/badges; painel "Trocar de plano".
- Cartao do teste (Free) lendo `trialEndsAt` no servidor (afinar o da 065b; nao refazer).
- Testes, docs (RETOMAR secao 0, ROTEIRO, PRIMEIROS_PASSOS).

## 4. Fora do escopo
- Emissao de recibo/nota fiscal (so link "Ver recibo" quando `receiptUrl` existir).
- Reconciliacao em massa com a API do AbacatePay e backfill retroativo (D-066-7; etapa futura se pedida).
- 063b (cancelar/reativar/trocar plano no provedor, HMAC, achados do QA 063a); reembolso iniciado pelo usuario; exportar historico (CSV/PDF).
- Mudar precos/limites, o fluxo de checkout, a regua de lembretes e o `status-map`.
- App movel; admin/cobrancas de todas as orgs (visao de plataforma).
- Disputa/chargeback alem de marcar a linha (D-066-9).

## 5. Decisoes (INFERRED, com recomendacao)
- **D-066-1 — Modelo `BillingCharge` persistido.** Recomendo: tabela propria (secao 7), 1 linha por tentativa/mensalidade, alimentada pelos webhooks. Alternativa descartada: derivar so da `Subscription` (perde valor, datas e historico).
- **D-066-2 — Identidade/idempotencia.** `externalId` por origem: `payment.id` (`char_...`) para cartao pago e PIX pago; `installmentId` (`intl_...`) para falha de cartao; `pixChargeId` normalizado (sem prefixo `pix_`) para PIX pendente/expirado. `@@unique([provider, externalId])`. Falha de cartao e depois pagamento da mesma parcela devem **convergir na mesma linha**: o `subscription.renewed` nao traz `installmentId` (nao inventar correlacao); regra: pagamento cartao/renovacao localiza a linha `failed|pending` aberta da mesma `subscriptionId` com `periodEnd` igual e a promove a `paid`, senao cria. Se ambiguo, cria nova linha `paid` e deixa a falha como historico de tentativa (D-066-5).
- **D-066-3 — Escrita dentro de `processBillingEvent`, mesma transacao** (apos `WebhookEvent.create`, antes do commit). Estende-se `ParsedBillingEvent` com campos **opcionais** (`installmentId`, `installmentNumber`, `retryNumber`, `receiptUrl`, `chargeStatus`, `failureCode`), preenchidos pelo parser so se o provedor enviar (guardas defensivas, como hoje). Evento sem `externalId` utilizavel nao grava cobranca (log sem PII) e nao quebra o resto.
- **D-066-4 — Monotonia de status:** ordem `pending < overdue < failed < paid`; `paid`, `refunded` e `canceled` nunca regridem por evento atrasado/reenviado (resolve tambem o achado de fora-de-ordem da 063a no historico; o efeito na `Subscription` e escopo da 063b).
- **D-066-5 — Falha de cartao:** cada `payment_failed` (com `retryNumber`) **atualiza a mesma linha** da parcela (`failed`, `retryCount`), nao cria uma por retentativa. Motivo: o provedor nao envia motivo; `failureReason` fica **null** e a UI mostra texto generico fixo ("Cartao recusado ou sem limite; nova tentativa automatica") — nunca inventar motivo.
- **D-066-6 — "A pagar" e "Atrasada" derivados na leitura, nao gravados.** Gravamos `pending|paid|failed|refunded|canceled`; `overdue` e **calculado**: `pending` com `dueAt < agora` (relogio injetado). Sem job novo, sem divergencia com a regua. Para nao contradizer: se `Subscription.status = canceled`, pendentes viram `canceled` na leitura; se a org esta `past_due`, a faixa de alerta usa `pastDueSince` e o prazo do grace.
- **D-066-7 — Mensalidade futura:** a **proxima** mensalidade e **projetada na leitura** (valor do plano x cadencia vigentes, vencimento = `currentPeriodEnd`), marcada "prevista", sem gravar e sem botao de pagar (cartao e cobrado pelo provedor). Nao projetar 2-3 meses (preco pode mudar; `cancelAtPeriodEnd` zera a projecao). PIX: a linha pendente real (com `dueAt = pixChargeExpiresAt`) substitui a projecao quando o job gerar a cobranca. Nao ha "mensalidades futuras gravadas".
- **D-066-8 — Pagar/regularizar (so o que existe de verdade):** botao **"Pagar agora"** so em linha PIX `pending` da org com `pixManaged`, gerando **nova** cobranca/QR via `createPixCharge`/`createCheckoutSession({method:"pix"})` existentes (o `brCode` antigo nao e guardado: D-066-12). Para cartao `failed`/`overdue`: **"Atualizar cartao" = novo checkout** (`createCheckoutSession`, ja existe) so se o provedor aceitar re-assinar sem duplicar cobranca (**Q-066-3**); caso contrario, texto informativo e **sem botao**. Sem link do provedor, sem botao (nunca inventar). "Tentar de novo" para cartao **nao entra** (sem API conhecida).
- **D-066-9 — Reembolso/disputa:** passar a **tratar** `transparent.refunded`, `checkout.refunded` (e `*.disputed/lost` apenas marcam `refunded`/nota) **somente para atualizar a linha** (`BillingCharge.status=refunded`), sem alterar `Subscription`/org (continua escopo 063b). Pre-requisito: fixtures reais desses payloads (nao temos hoje; **Q-066-5**). Sem fixture, o status `refunded` existe no modelo mas fica sem alimentacao (UI pronta, sem prometer).
- **D-066-10 — Backfill:** nao retroagir; historico nasce da primeira cobranca apos a migration. Opcional barato: ao gerar `getBillingHistory` para assinatura `active` sem nenhuma cobranca, mostrar estado vazio com a frase "O historico comeca a partir da proxima mensalidade". Nenhuma linha sintetica no banco (nao fabricar dado financeiro). Reconciliacao via API do provedor: etapa futura (**Q-066-4**).
- **D-066-11 — Visibilidade:** valores e historico so para **owner** da org (`Membership.orgRole = owner`); `member` ve plano/status/proxima data sem valores, com a mensagem "Peca ao proprietario". Isolamento sempre por `orgId` da sessao; nenhum `orgId` aceito do cliente. (Prompt falava "owner/admin": nao existe admin de org; **Q-066-2**.)
- **D-066-12 — Dados guardados:** nunca numero de cartao, CVV, `taxId`, e-mail do pagador nem payload bruto. Guardar so: ids do provedor, valor, status, datas, metodo, `cardBrand`/`cardLast4` (ja usados nos recibos), `receiptUrl` (URL do provedor, validada como `https` e dominio `abacatepay.com`). `brCode` **nao** e persistido (e um segredo de pagamento de curta duracao).
- **D-066-13 — Competencia:** `periodStart/periodEnd` do ciclo pago (mesma regra do recibo em `process-event.ts`: `periodStart` = `currentPeriodEnd` anterior se menor, senao `paidAt`); rotulo "nov/2026" derivado de `periodEnd`... em `America/Sao_Paulo` (a definir exatamente na implementacao com teste de virada de mes/fuso).
- **D-066-14 — Paginacao por cursor** `(createdAt desc, id)`; 12 por pagina; filtro por status (Todas / Em aberto / Pagas / Problemas). A ordem de exibicao pedida ("cronologica") = **mais recente primeiro**, com a proxima prevista fixada no topo (**Q-066-6**).
- **D-066-15 — Painel "Trocar de plano":** reaproveitar `PlanSelectionSection` dentro de `Dialog` (base ui existente), foco preso, `Esc`, retorno de foco; nao duplicar logica. Em Free e bloqueado a grade continua inline (como na 065b).
- **D-066-16 — Sem componente de cliente importando servidor** (`prisma`/`pg`): dados via props de Server Components; teste de regressao de build (`next build` so com o dev parado e aviso previo).

## 6. Perguntas abertas
- **Q-066-1 — RESPONDIDA (usuario, 2026-10-12):** o vencimento segue **a data em que o pagamento foi efetuado**, nas duas cadencias: **mensal** (vence todo mes no mesmo dia do 1o pagamento) e **anual** (vence todo ano na data do 1o pagamento). Implementacao: `dueAt` = fim do periodo anterior (`currentPeriodEnd`), ancorado em `paidAt` da 1a cobranca + cadencia; cada linha mostra a cadencia (Mensal/Anual) e o plano. Falha de cartao: data do 1o `payment_failed` do ciclo.
- **Q-066-2 — RESPONDIDA (usuario, 2026-10-12):** **dono E membros** veem os valores das mensalidades (sem distincao de papel na leitura; **acoes de pagar/regularizar continuam so para o dono**). Revisar D-066 e testes de permissao (nao ha mais mascaramento de valores para `member`); registrar o risco de dado financeiro visivel a todos os membros.
- **Q-066-3 — RESPONDIDA PARCIALMENTE (usuario, 2026-10-12):** usuario quer **PIX tambem**. Conferido no codigo: e possivel — o adaptador ja suporta `method:"pix"` (SPEC-047: PIX avulso `transparents/create`, sem recorrencia no provedor; o LeadForge gera uma cobranca/QR a cada ciclo e o cliente paga, com renovacao e `payment_failed` controlados por `pix-renewal.ts`). Mantido: **"Pagar agora" (PIX)** na linha pendente. **Cartao** que falhou: continua **sem botao** ate a 063b (novo checkout pode duplicar assinatura). Ver Q-066-9.
- **Q-066-4 — Backfill/reconciliacao:** manter "nao retroagir" (recomendado) ou incluir script de leitura da API do provedor depois?
- **Q-066-5 — Reembolso:** prosseguir com o status `refunded` sem fixture (UI/modelo prontos, sem alimentacao) e capturar o payload real no sandbox depois (recomendado), ou bloquear ate ter o payload?
- **Q-066-6 — Ordem da lista:** mais recente primeiro (recomendado, com "proxima" fixa no topo) ou cronologica crescente?
- **Q-066-7 — Janela de dados:** mostrar todo o historico (recomendado) ou so os ultimos 12 meses?
- **Q-066-8 — Politica de retencao** das cobrancas apos cancelamento/expurgo da org: seguir o expurgo de 90 dias (FK `Cascade`, recomendado) ou reter para fins fiscais (exige parecer juridico; ja pendente na 065)?
- **Q-066-9 — RESPONDIDA (usuario, 2026-10-12): INCLUIR NA 066.** A SPEC passa a incluir o **seletor "Cartao / PIX" no checkout** (`/assinar` e troca/upgrade; mensal e anual), geracao do QR/copia-e-cola (`createPixCharge`, `pixManaged=true`), tela/painel de pagamento PIX com expiracao e polling de confirmacao (reusar o polling da 065b), e a lista de mensalidades PIX. **Impacto:** escopo maior; dividir em 066a (modelo `BillingCharge` + alimentacao webhook/job), 066b (checkout PIX: action, QR, expiracao) e 066c (UI: lista de mensalidades + seletor). Pendente de revisao: D-066-8 e o plano de testes devem cobrir o fluxo PIX de ponta a ponta no sandbox (o dev mode do AbacatePay pode nao simular o pagamento PIX: confirmar).

## 7. Modelo de dados proposto (migration ADITIVA, escrita a mao, so `migrate deploy`; NUNCA `migrate dev`)
```prisma
enum BillingChargeStatus { pending paid failed refunded canceled }   // "overdue" e derivado na leitura (D-066-6)
enum BillingChargeMethod { card pix }

model BillingCharge {
  id             String              @id @default(uuid())
  orgId          String
  org            Organization        @relation(fields: [orgId], references: [id], onDelete: Cascade)
  subscriptionId String?             // sem FK dura: a cobranca sobrevive a recriacao da Subscription
  provider       String              // "abacatepay" | "mock" | "stripe"
  externalId     String              // D-066-2
  amountCents    Int
  currency       String              @default("BRL")
  status         BillingChargeStatus
  method         BillingChargeMethod
  planKey        String              // copia do momento
  cadence        BillingCadence
  periodStart    DateTime?
  periodEnd      DateTime?
  dueAt          DateTime?
  paidAt         DateTime?
  retryCount     Int                 @default(0)
  failureReason  String?             // texto curto sem dado de cartao; hoje sempre null (D-066-5)
  cardBrand      String?
  cardLast4      String?
  receiptUrl     String?
  createdAt      DateTime            @default(now())
  updatedAt      DateTime            @updatedAt

  @@unique([provider, externalId])
  @@index([orgId, createdAt(sort: Desc), id])
  @@index([orgId, status])
}
```
Valores em centavos inteiros (padrao do projeto). Sem `payload` bruto. Migration: so `CREATE TYPE`/`CREATE TABLE`/indices; sem alterar tabelas existentes (alem da relacao inversa em `Organization`, que nao gera DDL).

## 8. Backend (066a — dev-backend)
1. Migration + schema (secao 7), aplicada em banco `*_test` NOVO; nada em dev/producao sem o usuario rodar `migrate deploy`.
2. Parser AbacatePay: extrair campos opcionais (D-066-3) de `completed/renewed/payment_failed/transparent.completed`; (se Q-066-5 ok) tratar `*.refunded` so como evento de cobranca. Mock e Stripe preenchem o minimo (`externalPaymentId`, `amountCents`, `paidAt`) para o historico funcionar em dev.
3. `processBillingEvent`: `upsertCharge(tx, event, now)` com monotonia (D-066-4) e convergencia (D-066-2); idempotente por `eventId` (ja) e `externalId`. Falha ao gravar cobranca **nao** deve derrubar o evento? **Decisao:** ela roda na mesma transacao (consistencia > disponibilidade); um erro aborta e o provedor reenvia (comportamento ja existente para falhas de transacao).
4. `pix-renewal.ts`: ao gerar `createPixCharge`, criar `BillingCharge pending` (`externalId = chargeId` normalizado, `dueAt = expiresAt`, `periodEnd = currentPeriodEnd`); ao expirar, marcar `failed`/`canceled` na mesma chamada que ja dispara o `payment.failed`.
5. `src/lib/queries/billing-history.ts`: `getBillingHistory({cursor, status})` com `requireProviderOrgAllowExpired` + owner (D-066-11), isolamento por `orgId`, resumo `{totalPaidCents, next{amountCents,date,predicted}, overdue{count,totalCents,since}}`, derivacao de `overdue`/`canceled` (D-066-6) com `now` injetavel; DTO sem ids internos alem do necessario.
6. Server action `payChargeWithPix` (owner; reusa `createCheckoutSession({method:"pix"})`; rate limit existente; nunca loga QR/brCode).
7. Nada de PII em log (so `orgId`, tipo, status).

## 9. Frontend (066b — dev-frontend; so apos 066a aprovada no QA)
Ler `AGENTS.md` e `node_modules/next/dist/docs/` antes. Reaproveitar `UsageMeter`, `TrialBanner`, `PlanSelectionSection`, `SubscriptionSummaryCard`, `LimitNotice` e o design system.
1. `page.tsx` ramifica por situacao (secao 1); Free = cartao do teste (barra "dia X de 14", "termina hoje", "ultimo dia", expirado) lendo `trialEndsAt` no servidor, sem flash de conteudo errado.
2. Novos: `BillingHistorySection` (server) + `ChargeRow/ChargeCard` + `ChargeStatusBadge` + `BillingHistorySummary` + `ChangePlanDialog` + `LoadMoreCharges` (client minimo). Tabela >= 768px; **cards empilhados em 390px**.
3. Badges com **texto + icone** (nao so cor), contraste AA claro/escuro, alvos >= 44px, foco visivel, `role="table"`/cabecalhos corretos, `aria-live="polite"` ao carregar mais, skeleton, estado vazio, erro com `notifyActionError`.
4. R$ via `Intl.NumberFormat("pt-BR")`; datas em `America/Sao_Paulo`; "vence em N dias" calculado no servidor (relogio injetavel).
5. Membro: sem valores (D-066-11). "Ver recibo" so com `receiptUrl` valida. Sem promessa de recurso inexistente (D-066-8: sem "Tentar de novo").

## 10. Plano de testes (vitest; banco `*_test` NOVO; relogio injetado; `PAYMENT_PROVIDER=mock ABACATEPAY_API_KEY= ABACATEPAY_WEBHOOK_SECRET= APP_BASE_URL=http://app.test APP_URL=http://app.test TEST_DATABASE_URL=...`)
- **Webhook -> cobranca** (fixtures reais): `completed`/`renewed`/`transparent.completed` criam 1 linha `paid` com valor, `paidAt`, `receiptUrl`, metodo; reenvio do mesmo evento nao duplica (nem por `eventId` nem por `externalId`); `payment_failed` cria/atualiza 1 linha `failed` (`retryCount`); falha seguida de pagamento fica `paid`; evento fora de ordem (falha depois de paga) nao regride; PIX gerado -> `pending`, expirado -> `failed/canceled`; evento sem `externalId` nao quebra; migration so aditiva.
- **`getBillingHistory`:** cursor (sem repeticao/lacuna com `createdAt` igual), filtros, ordem, resumo, derivacao de `overdue`/`canceled`/proxima prevista, `cancelAtPeriodEnd` sem projecao, org Free sem cobrancas, **isolamento entre orgs A/B/C**, owner x member, usuario sem org, nada de `orgId` do cliente.
- **Componentes (SSR/RTL):** Free vs Starter vs Pro (grade **ausente** para assinante; botao "Trocar de plano" abre dialogo com foco/Esc); vazio; "A pagar" (com/sem botao), "Atrasada" (destaque), "Paga", "Falhou" (texto generico), "Reembolsada"/"Cancelada"; membro sem valores; paginacao + `aria-live`; axe/rotulos.
- **Responsivo** 390/1280 e claro/escuro (checagem manual documentada); regressao do build "client importando servidor" (`next build` com dev parado, avisando antes).
- Gate: `tsc`, `eslint` (0 erros), vitest verdes + QA independente por etapa.

## 11. Criterios de aceitacao
1. Org Starter/Pro ve a lista "Mensalidades" **no lugar** da grade; a grade so aparece ao clicar "Trocar de plano" (dialogo acessivel).
2. Cada pagamento real (cartao ou PIX) recebido por webhook aparece **uma unica vez** com valor, competencia, status e data corretos; reenvio/fora de ordem nao duplica nem regride.
3. "Atrasada"/"A pagar" coerentes com `past_due`/grace/soft-block (nunca "Paga" para org suspensa por falta de pagamento do mesmo ciclo; nunca "Atrasada" para org cancelada).
4. Botao "Pagar agora" so existe quando ha forma real de pagar (PIX); nenhum botao ou texto promete recurso inexistente.
5. Membro nao ve valores; org B nunca ve cobranca da org A (teste automatizado).
6. Free mostra cartao do teste correto (dias, progresso, ultimo dia, expirado) lido no servidor; bloqueado inalterado; Business/cortesia inalterados.
7. Estados vazio/carregando/erro, paginacao, 390px, tema claro/escuro, AA, teclado e leitor de tela ok.
8. Nenhum dado de cartao/`taxId`/payload bruto no banco, em log ou na URL; migration so aditiva e escrita a mao; `tsc`/`eslint`/vitest verdes; QA aprovado; docs atualizados.

## 12. Riscos
- **LGPD/dado financeiro:** valores e datas sao dado financeiro da org; restringir a owner, `Cascade` na exclusao/expurgo, nada em log/URL/analytics, `receiptUrl` validada; nao armazenar dado de pagador. Retencao fiscal depende de parecer (Q-066-8).
- **Dado incompleto do provedor:** sem vencimento, motivo de recusa nem link de cartao; a UI so mostra o que existe (D-066-5/6/8). Risco de a lista parecer "pobre" para falhas; mitigado com texto honesto.
- **Correlacao falha x pagamento** (parcela sem `installmentId` no `renewed`): pode gerar linha extra de tentativa; mitigado por D-066-2 e teste.
- **Divergencia com a regua de cobranca** se "overdue" fosse gravado; mitigado por derivar na leitura.
- **Regressao no `processBillingEvent`** (caminho critico de pagamento): escrita extra na transacao Serializable; cobrir com os testes existentes (052a/b, 063, 065) rodando verdes.
- **Reembolso sem fixture** (D-066-9) e **063b pendente** (cancelar no app nao cancela a recorrencia no provedor: a lista pode mostrar cobranca de assinatura "cancelada" no app).
- **Historico vazio de quem ja pagou** (D-066-10): expectativa a comunicar na UI.
- Colisao de mudancas locais nao commitadas da 065 nos mesmos arquivos (`assinatura/page.tsx`, `SubscriptionSummaryCard`, `process-event.ts`): **066 so deve comecar depois do commit da 065 ou na mesma arvore com cuidado**.

## 13. Restricoes de implementacao
Nunca `prisma migrate dev`; migration a mao; testes so em banco `*_test` novo; nunca imprimir segredos; nao commitar `next.config.ts`/`.claude/`/`skills-lock.json`; nao rodar `next build`/derrubar `npm run dev` sem avisar. Ao fechar: atualizar `docs/RETOMAR.md` (secao 0), `docs/ROTEIRO_DE_TESTES.md`, `docs/PRIMEIROS_PASSOS.md` (linguagem simples), commit e push (regra do projeto).

## 14. Arquivos esperados
Backend: `prisma/schema.prisma` + `prisma/migrations/<ts>_billing_charge_066a/migration.sql`; `src/lib/billing/process-event.ts` (+ `billing-charge.ts`), `provider.ts` (campos opcionais), `providers/abacatepay-webhook.ts`, `providers/mock.ts`, `pix-renewal.ts`; `src/lib/queries/billing-history.ts`; `src/lib/actions/billing.ts` (`payChargeWithPix`); testes `*.test.ts` ao lado. Frontend: `src/app/(app)/configuracoes/assinatura/page.tsx`; `src/components/billing/{BillingHistorySection,ChargeRow,ChargeStatusBadge,BillingHistorySummary,ChangePlanDialog,LoadMoreCharges}.tsx` + testes; ajustes em `SubscriptionSummaryCard.tsx`/`PlanSelectionSection.tsx`.
