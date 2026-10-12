# Prompt: tela Assinatura por plano (Free = teste; Starter/Pro = histórico de mensalidades)

Cole no `project-orchestrator` (ele cria a SPEC antes de qualquer código). Criado em 2026-10-12.

---

## Prompt

Você é o `project-orchestrator` do LeadForge (`/Users/thiagomorgado/Desktop/LeadForge_web`). Responda em pt-BR. Siga Spec-Driven
Development: **crie a SPEC (próximo número livre em `specs/`), pare, e peça `APROVAR SPEC-0NN`** antes de qualquer código.
Depois: `dev-backend` (backend) → `qa-reviewer` → `dev-frontend` (frontend) → `qa-reviewer`. Leia antes `AGENTS.md` (este Next.js
tem breaking changes), `docs/RETOMAR.md` (seção 0) e a SPEC-065 (`specs/65-free-trial-7-dias-limites/spec.md`, com as Implementation Notes).

### Objetivo
A página `/configuracoes/assinatura` deve mostrar conteúdo **diferente conforme o plano da organização**, de forma profissional:

| Situação da organização | O que a página mostra |
|---|---|
| **Free (`trialing`, plano `free`)** | Cartão do **período de teste**: dias restantes, data de término, barra de progresso (dia X de 14), `UsageMeter` (uso x limite do Free), aviso dos últimos 3 dias, CTA "Fazer upgrade" e a grade de planos para assinar. Sem "Cancelar" nem "Gerenciar assinatura". |
| **Starter ou Pro (assinante)** | Cartão do plano atual (status, cadência, próxima cobrança, cancelar/gerenciar, como hoje). **No lugar onde hoje aparece a grade "Trocar de plano" (cartões Starter/Pro/Business + toggle Mensal/Anual), passa a aparecer a lista "Mensalidades"**: uma linha por mensalidade, em ordem cronológica, mostrando **competência (ex.: nov/2026), vencimento, valor, status e data do pagamento**. Status: **Paga**, **A pagar** (a vencer, com "vence em N dias" e botão **"Pagar agora"** quando houver link/PIX do provedor), **Atrasada** (vencida e não paga, destaque forte + botão "Regularizar"), **Falhou** (cartão recusado, com motivo curto e "Atualizar cartão"/"Tentar de novo"), **Reembolsada** e **Cancelada**. Resumo no topo: total pago, próxima mensalidade (valor e data) e faixa de alerta quando houver atraso. Estado vazio amigável. Paginação ("carregar mais"). **Trocar de plano** deixa de ocupar a tela: vira um botão secundário "Trocar de plano" no cartão do plano atual, que abre a grade num painel/modal (mesmos componentes da 065b). |
| **Trial expirado / bloqueado** | Mantém o painel de bloqueio da 065b (não mexer). |
| **Business / courtesy / sem assinatura (admin)** | Mantém o comportamento atual; histórico só se houver cobranças. |

A mesma lista de mensalidades serve para Starter e Pro (e qualquer plano pago futuro), sem código por plano: muda só o valor e o nome do plano em cada linha.

### Fato importante (já conferido no repositório)
**Não existe hoje modelo de cobrança/fatura** (`Invoice`/`Payment`): o schema só tem `Subscription`, `Plan`, `BillingProduct`,
`BillingReminderLog` e `WebhookEvent`. Logo, a lista de mensalidades **exige persistir cada cobrança**, alimentada pelos webhooks do
AbacatePay já tratados em `processBillingEvent` (`subscription.completed`, `subscription.renewed`, `subscription.payment_failed`,
`subscription.cancelled`, `transparent.completed`) e pelo PIX avulso da renovação (`pix-renewal.ts`, `Subscription.pixChargeId`).
Confirme isso lendo o código e **não invente** campos que o provedor não envia (o `metadata` NÃO volta no webhook; a correlação é por IDs).

### O que a SPEC deve decidir (com recomendação em cada ponto; as bloqueantes viram pergunta)
1. **Modelo `BillingCharge`** (nome sugerido; migration **aditiva, escrita à mão, nunca `migrate dev`**): `id`, `orgId` (FK, `onDelete: Cascade`), `subscriptionId?`, `provider`, `externalId` (`@@unique([provider, externalId])` para idempotência), `amountCents`, `currency`, `status` (`paid|pending|overdue|failed|refunded|canceled`; "A pagar" = `pending` com `dueAt` futuro, "Atrasada" = `pending`/`overdue` com `dueAt` passado), `periodStart/periodEnd`, `dueAt`, `paidAt?`, `method` (`card|pix`), `planKey`/`cadence` (cópia do momento), `failureReason?` (texto curto, sem dado de cartão), `createdAt/updatedAt`. Nunca guardar número de cartão, CVV nem payload bruto do provedor com dados sensíveis.
2. **Alimentação:** gravar/atualizar a cobrança dentro do mesmo `processBillingEvent` (transação, idempotente por `eventId` e por `externalId`; evento fora de ordem não pode regredir `paid` para `pending`). Tratar também o PIX avulso (`pixChargeId`).
3. **"A pagar" e "Atrasada":** a lista precisa mostrar também **mensalidades futuras** (a próxima, e opcionalmente as próximas 2-3 já projetadas pelo `currentPeriodEnd`/`cadence`), não só as já cobradas: decidir se são gravadas (cobrança criada pelo provedor/`pix-renewal`) ou calculadas na leitura. "Atrasada" = derivar (pendente com `dueAt` < agora) em vez de gravar, ou gravar via job; escolher e justificar. Alinhar com a régua existente (`past_due`, grace de 7 dias, soft-block, lembretes D+3/D+5/D+7) para a UI nunca contradizer o estado da assinatura.
3b. **Pagar/regularizar:** definir de onde vem o link de pagamento (PIX `pixChargeId`/QR do AbacatePay, ou checkout do cartão) e se "Pagar agora" reutiliza `createCheckoutSession`/portal já existentes; sem link do provedor, o botão não aparece (nunca inventar).
4. **Backfill:** orgs que já pagaram antes não têm histórico. Recomendar: **não retroagir**, mostrar a partir da 1ª cobrança nova, e (opcional) criar a cobrança inicial a partir da `Subscription` ativa; decidir se vale reconciliar via API do AbacatePay (leitura) numa etapa posterior.
5. **Query:** `getBillingHistory(orgId, cursor)` com **paginação por cursor**, filtro por status, isolamento multi-tenant (sempre `requireProviderOrg`/owner; **membro vê?** recomendar só `owner`/`admin`, membro vê o plano e não os valores) e resumo (total pago, próxima cobrança, em atraso).
6. **UI (frontend, depois do backend):** reaproveitar os componentes da 065b (`UsageMeter`, `TrialBanner`, `PlanSelectionSection`, `SubscriptionSummaryCard`) e o design system existente; tabela no desktop e **cards empilhados no celular (390px)**; badges de status com **texto + ícone (não só cor)**, contraste AA nos temas claro/escuro, alvos ≥ 44px no toque, `role`/`aria` corretos, foco visível, skeleton de carregamento, estado vazio e erro com toast PT-BR (helper `notifyActionError`). Valores em R$ com `Intl.NumberFormat("pt-BR")`, datas em `America/Sao_Paulo`. Sem promessas que só existem em mock.
7. **Recibo/nota:** fora do escopo (só listar). Se o provedor devolver URL de recibo, mostrar link "Ver recibo" apenas quando existir.
8. **Segurança/LGPD:** a lista contém dado financeiro: só a própria organização, só papéis permitidos, nada em log, nada em URL. Registrar em Riscos.
9. **Free:** o cartão do teste deve ler `trialEndsAt` no servidor (nunca confiar em URL), tratar "último dia", "termina hoje" e "expirado" sem flash de conteúdo errado.

### Testes exigidos (vitest, banco `*_test` NOVO; relógio injetado)
- Webhook → cobrança criada/atualizada uma única vez (reenvio do mesmo evento não duplica; evento fora de ordem não regride o status; falha seguida de pagamento fica `paid`).
- `getBillingHistory`: paginação por cursor, filtros, ordenação, resumo, **isolamento entre orgs A/B/C**, permissão por papel, org Free sem cobranças.
- Componentes (SSR/RTL): Free vs Starter vs Pro renderizam as seções certas (**a grade de planos NÃO aparece mais para assinante; o botão "Trocar de plano" abre o painel**); estado vazio; mensalidade "A pagar", "Atrasada" e "Paga" com os selos e botões certos; atraso destacado; paginação; acessibilidade (rótulos, `aria-live` ao carregar mais).
- Responsivo 390px/1280px e claro/escuro; teste de regressão para o erro de build de **componente de cliente importando módulo de servidor** (`prisma`/`pg`): rodar `next build` com o dev parado e confirmar.

### Regras do projeto (valem na implementação)
- Nunca `prisma migrate dev` (só `migrate deploy`, aplicado pelo usuário); testes só em banco `*_test` novo, com
  `PAYMENT_PROVIDER=mock ABACATEPAY_API_KEY= ABACATEPAY_WEBHOOK_SECRET= APP_BASE_URL=http://app.test APP_URL=http://app.test TEST_DATABASE_URL=...`.
- Pronto só com `tsc`, `eslint` (0 erros) e vitest verdes + QA independente. Não rodar `next build`/derrubar o `npm run dev` sem avisar.
- Nunca imprimir segredos. Não commitar `next.config.ts` (mudança local do túnel), `.claude/`, `skills-lock.json`.
- Ao fechar: atualizar `docs/RETOMAR.md` (seção 0), `docs/ROTEIRO_DE_TESTES.md` e `docs/PRIMEIROS_PASSOS.md` (linguagem simples), commit e push.

### Entrega agora (e pare)
1. A SPEC completa (`DRAFT`) com decisões, perguntas abertas (recomendação em cada), divisão backend/frontend, plano de testes e critérios de aceitação.
2. Um resumo de até 8 linhas e **a pergunta**: "Posso considerar aprovada com as recomendações?". Não escreva código sem `APROVAR SPEC-0NN`.
