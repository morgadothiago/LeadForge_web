# SPEC-039 — Bloqueio manual de inadimplencia + lembretes de cobranca
- status: IMPLEMENTED (dev-backend, 2026-09-27, correção QA aplicada) | domain: backend | depende de: 030 (multi-tenant), 031/032 (admin cross-tenant), 033 (billing), 038 (system-mail)

## Objetivo
Hoje (SPEC-033) o `Organization.status` ja reflete o `Subscription.status` automaticamente (trial/active/past_due/canceled -> active|suspended, D-33-3/D-33-4) e o `platform_admin` ja pode suspender/reativar qualquer org manualmente (SPEC-031/032, `suspendOrganization`/`reactivateOrganization`, com motivo obrigatorio e auditoria). O usuario pediu, alem disso: (1) e-mails de lembrete de cobranca antes/durante a inadimplencia, (2) bloqueio manual explicito de usuario inadimplente (possivelmente redundante com o que ja existe — precisa esclarecer o que falta).

## Contexto (o que ja existe, para nao duplicar)
- `suspendOrganization({orgId, reason})`/`reactivateOrganization({orgId})`: ja E o bloqueio manual, feito pelo `platform_admin`, com auditoria (`PlatformAuditLog`).
- `status-map.ts` (SPEC-033): grace period de 7 dias em `past_due` antes de soft-block automatico; retencao 90 dias apos cancelamento + expurgo.
- NAO existe hoje: nenhum e-mail e enviado em nenhuma etapa desse fluxo (nem lembrete de vencimento, nem aviso de `past_due`, nem aviso de suspensao, nem aviso de expurgo proximo — a SPEC-033 menciona um aviso "15 dias antes do expurgo" no proprio banner do produto, mas nao por e-mail).

## Escopo proposto
- Job/rotina (reaproveitando o cron/tick ja existente, SPEC-013/030) que dispara e-mails via a infraestrutura ja existente (SPEC-010/038, `sendSystemEmail`) em pontos-chave: N dias antes do vencimento (trial acabando ou cobranca recorrente), quando a assinatura entra em `past_due` (inicio do grace period), quando a org e suspensa automaticamente por falta de pagamento, e um aviso antes do expurgo (75 dias apos cancelamento, D-33-4 ja previa esse aviso no banner — estender para e-mail).
- Nenhuma mudanca no mecanismo de bloqueio em si (ja existe, manual via admin + automatico via `status-map.ts`) — a menos que as decisoes abaixo revelem outra necessidade.

## Decisoes fechadas (usuario, 2026-09-27)

D-039-1: O mecanismo de bloqueio (manual via `platform_admin`, SPEC-031/032; automatico via `status-map.ts`, SPEC-033) JA EXISTE e NAO muda. O que faltava, e e o escopo real desta SPEC, e SO o envio de e-mails de lembrete/aviso nos pontos-chave do fluxo — nenhuma acao de bloqueio nova.

D-039-2: Cadencia fixa (recomendacao do orquestrador): N dias antes do fim do trial (usar N=3), no inicio do `past_due` (aviso de grace period), na suspensao automatica por falta de pagamento, e 15 dias antes do expurgo (75 dias apos cancelamento, D-33-4).

D-039-3: O gatilho automatico de suspensao (7 dias de grace period em `past_due`, D-33-3) NAO muda — esta SPEC so adiciona e-mail em cima do fluxo existente, sem alterar timing/logica de bloqueio.

## Fora do escopo
- Bloqueio por usuario individual dentro de uma org multi-membro (D-30-4 nao implementado).
- Qualquer coisa em `../mobile/`.

## Ordem de execucao
dev-backend, apenas — D-039-1 confirmou que o mecanismo de bloqueio ja existe (SPEC-031/032/033); esta SPEC so adiciona envio de e-mail nos pontos-chave do cron/tick existente. Aprovada, decisoes fechadas — pode implementar direto.

## Implementation Notes (dev-backend, 2026-09-27)

### Resumo
Nenhuma logica/timing de bloqueio foi alterada (D-039-1/D-039-3). Foi adicionado SOMENTE um job de
e-mail (`sendBillingReminders`, chamado pelo tick existente) que LÊ o estado ja persistido por
`status-map.ts`/`process-event.ts` e dispara os 4 avisos da cadencia (D-039-2), reaproveitando
`sendSystemEmail` (SPEC-038) sem criar client de e-mail novo.

### Modelo/migration
- `prisma/schema.prisma`: novo model `BillingReminderLog` (`orgId`, `kind: BillingReminderKind`,
  `anchorAt`, `sentAt`) com `@@unique([orgId, kind, anchorAt])` — mecanismo de idempotencia escolhido.
  `anchorAt` e o timestamp que ANCORA o episodio (`trialEndsAt` para `trial_ending`; `pastDueSince`
  para `past_due_started`/`auto_suspended` — mesmo episodio de past_due gera os dois avisos com a
  MESMA ancora, kinds diferentes; `canceledAt` para `purge_warning`). Reprocessar o MESMO episodio
  (cron rodando de novo) bate no `@@unique` e nao duplica; um NOVO episodio (ex.: org volta a ficar em
  dia e cai em `past_due` de novo depois) tem ancora diferente e gera aviso novo. Relacao com
  `Organization` (`onDelete: Cascade`) — nao precisou de limpeza manual em `org-fixture.ts`.
  Migration: `prisma/migrations/20260927055725_billing_reminder_log/` (aplicada no banco local via
  `npx prisma migrate dev`; `npx prisma generate` reexecutado para o client pegar o novo model).

### Arquivos alterados/criados
- `prisma/schema.prisma` — model `BillingReminderLog` + enum `BillingReminderKind`, relacao em `Organization`.
- `prisma/migrations/20260927055725_billing_reminder_log/migration.sql` — novo.
- `src/lib/billing/reminders.ts` — novo. Exporta `sendBillingReminders(now)`, chamado 1x por tick,
  isolado (nunca lança). Le `Subscription`/`Organization` (nunca escreve nelas), reserva o envio via
  `BillingReminderLog.create` (idempotencia: `P2002` = ja enviado, pula) e so DEPOIS chama
  `sendSystemEmail` para cada `Membership.orgRole === "owner"` da org (mesma audiencia que hoje
  gerencia assinatura em `src/lib/actions/billing.ts`). Trade-off documentado no arquivo: a reserva
  acontece ANTES do envio (prioriza "nunca duplica" sobre "nunca perde" — falha pontual de SMTP nesse
  aviso especifico nao e retentada na proxima rodada, mesmo espirito best-effort do resto do fluxo de
  billing que tambem nao lança/retenta em cima de canal externo).
- `src/lib/scheduler/run-tick.ts` — 1 linha de import + 1 chamada `await sendBillingReminders(new Date()).catch(...)`
  logo antes de `purgeCanceledOrgs` (mesmo padrão de isolamento: erro só é logado, nunca derruba o tick).
- `src/lib/billing/reminders.test.ts` — novo, 12 testes (ver abaixo).

### Testes executados (VERIFIED)
- `npx vitest run src/lib/billing/reminders.test.ts` → 12/12 passed.
- `npx vitest run src/lib/billing src/lib/scheduler src/lib/actions/auth.test.ts src/lib/actions/admin/organizations.test.ts` → 126/126 passed (garante que nada em SPEC-031/032/033/038 regrediu).
- `npx tsc --noEmit` → sem erros.
- `npm run lint` → 0 erros (4 warnings pré-existentes, arquivos não tocados por esta SPEC).
- `npm test` (suíte completa) → 109 arquivos / 1360 testes passed.
- Confirmado via `ps aux` antes e depois: nenhum processo `vitest`/`next dev` concorrente; nenhum servidor foi iniciado ou derrubado por este trabalho.

### Critérios de aceitação

| Critério | Status | Evidência |
|---|---|---|
| AC-1: e-mail 3 dias antes do fim do trial | PASS | `reminders.test.ts` "trial_ending: trialEndsAt a <= 3 dias..." e "...a > 3 dias -> não envia ainda" |
| AC-2: e-mail no início do past_due (grace period) | PASS | `reminders.test.ts` "past_due_started: subscription entra em past_due..." |
| AC-3: e-mail na suspensão automática por falta de pagamento (nunca na suspensão manual) | PASS | `reminders.test.ts` "auto_suspended: grace period expirado..." e "...NÃO dispara para suspensão manual..." |
| AC-4: e-mail 15 dias antes do expurgo (75 dias após cancelamento) | PASS | `reminders.test.ts` "purge_warning: 75 dias após canceledAt..." + "...ainda < 75 dias -> não envia" + "...org já expurgada -> não envia" |
| AC-5: nunca reenvia o mesmo aviso (idempotência) | PASS | `reminders.test.ts` "idempotência: rodar o tick de novo no mesmo dia NÃO reenvia..." + "novo episódio de past_due... gera um NOVO aviso" |
| AC-6: falha de SMTP não trava o cron | PASS | `reminders.test.ts` "falha no envio de e-mail (SMTP indisponível) NÃO lança..." |
| AC-7: sem vazamento cross-tenant | PASS | `reminders.test.ts` "nunca toca dado de outra org..." |
| AC-8: mecanismo de bloqueio (manual/automático) inalterado | PASS | suíte completa de SPEC-031/032/033 (126 testes) passou sem alteração de código nesses arquivos; `status-map.ts`/`process-event.ts`/`organizations.ts` (admin) não foram tocados |

### Decisões arquiteturais (implementação)
- Recipiente do e-mail: todos os `Membership.orgRole === "owner"` da org (hoje sempre 1 por org no
  fluxo de signup, `src/lib/actions/billing.ts`) — mesma audiência que já gerencia assinatura/billing;
  não mencionado explicitamente na SPEC, decisão de implementação (não é `[NEEDS_DECISION]`, é detalhe
  de execução dentro do escopo já aprovado).
- Local de disparo no tick: fora do loop por-org-ativa (mesmo bloco de `purgeCanceledOrgs`, após o
  `try/finally` do lock) — necessário porque `auto_suspended`/`purge_warning` precisam alcançar orgs
  que JÁ estão fora de `status: "active"` (o loop principal só itera orgs ativas).
- Idempotência por `(orgId, kind, anchorAt)` em vez de um booleano simples por org: permite reenviar o
  aviso em um NOVO episódio (ex.: org sai de `past_due` e volta a cair depois) sem duplicar dentro do
  MESMO episódio — mais robusto que um flag único por `kind`.

### Limitações conhecidas
- Se o `sendSystemEmail` falhar (SMTP fora do ar) no momento exato do disparo, o aviso não é
  reenviado automaticamente na próxima rodada (a reserva em `BillingReminderLog` já foi feita). Trade-off
  aceito e documentado no código — mesma filosofia best-effort do restante do fluxo de billing.
- Não há UI/banner para esses avisos (fora de escopo desta SPEC — SPEC-034 já cobre o banner de
  produto para o aviso pré-expurgo; esta SPEC cobre apenas o canal de e-mail).

### Correção QA (dev-backend, 2026-09-27) — achado bloqueante

**Causa raiz**: o gatilho `auto_suspended` (`remindAutoSuspended`, `src/lib/billing/reminders.ts`)
decidia se a suspensão foi automática **re-derivando isso do estado atual**
(`Organization.status: "suspended"` + `Subscription.status: "past_due"` + `pastDueSince` setado). Isso é
ambíguo por dois motivos: (1) uma suspensão **manual** feita pelo `platform_admin`
(`suspendOrganization`, SPEC-031) enquanto a `Subscription`, por coincidência, também está em
`past_due` batia no mesmo filtro — violando D-039-1 (fluxo manual do admin não deve ganhar
e-mail/comportamento que não foi pedido); (2) a query nem verificava se o grace period de 7 dias
(`PAST_DUE_GRACE_MS`, `status-map.ts`) de fato tinha expirado, só que `pastDueSince` estava setado
(mesmo que há poucas horas). QA reproduziu os dois problemas simulando exatamente esse cenário.

**Abordagem escolhida**: opção 2 do relatório de QA — sinal explícito persistido, em vez de gatilho
síncrono no ponto de transição. Escolhida porque `reminders.ts` já é, por design, um job de polling
isolado do mecanismo de billing (nunca escreve em `Subscription`/`Organization`, só lê) — manter esse
isolamento é mais simples de auditar/testar do que acoplar o disparo de e-mail dentro de
`syncOrgStatuses`/`processBillingEvent`. Novo campo `Organization.suspendedReason: OrgSuspendedReason?`
(`automatic | manual`, nullable — null quando `status != suspended`):
- `syncOrgStatuses` (`status-map.ts`) grava `"automatic"` no EXATO momento em que transiciona
  `status` para `suspended` por causa da própria `Subscription` (grace de `past_due` expirado, ou
  `canceled`/`incomplete`) — e grava `null` ao reativar automaticamente. Quando NÃO há mudança de
  `status` (org já suspensa, seja por qual motivo for), `suspendedReason` **não é tocado** — se já é
  `"manual"`, permanece `"manual"` mesmo que a `Subscription` também esteja em `past_due` expirado por
  coincidência (D-039-1: a ação manual do admin nunca "vira" automática por baixo).
- `suspendOrganization` (`src/lib/actions/admin/organizations.ts`, SPEC-031) grava `"manual"`
  explicitamente, dentro da mesma transação do `update`/`PlatformAuditLog`.
- `reactivateOrganization` limpa para `null`.
- `remindAutoSuspended` agora filtra por `suspendedReason: "automatic"` (nunca re-derivado) **e**
  revalida explicitamente que `now - pastDueSince >= PAST_DUE_GRACE_MS` (defesa em profundidade, já
  que este job nunca escreve nesse estado, só lê — não confia silenciosamente na ordem de execução de
  `status-map.ts`).

Migration: `prisma/migrations/20260927062841_org_suspended_reason/` (enum `OrgSuspendedReason` +
coluna `Organization.suspendedReason`, aplicada via `npx prisma migrate dev`).

**Arquivos alterados**:
- `prisma/schema.prisma` — enum `OrgSuspendedReason` + campo `Organization.suspendedReason`.
- `prisma/migrations/20260927062841_org_suspended_reason/migration.sql` — novo.
- `src/lib/billing/status-map.ts` — `syncOrgStatuses` grava/limpa `suspendedReason` na transição.
- `src/lib/actions/admin/organizations.ts` — `suspendOrganization` grava `"manual"`;
  `reactivateOrganization` limpa para `null`.
- `src/lib/billing/reminders.ts` — `remindAutoSuspended` filtra por `suspendedReason: "automatic"` +
  revalida expiração do grace period explicitamente; recebe `now` (antes não recebia).

**Testes novos/ajustados (VERIFIED)**:
- `src/lib/billing/reminders.test.ts`: ajustado o teste de suspensão automática existente para gravar
  `suspendedReason: "automatic"` (reflete o que `syncOrgStatuses` faz de fato); ajustado o teste de
  suspensão manual trivial para gravar `suspendedReason: "manual"`; adicionados os 2 cenários
  explicitamente cobrados pelo QA — "NÃO dispara para suspensão MANUAL mesmo com subscription em
  past_due e grace JÁ EXPIRADO" e "subscription em past_due DENTRO do grace period + suspensão manual
  -> não dispara de qualquer forma".
- `src/lib/billing/status-map.test.ts`: novo describe `syncOrgStatuses grava suspendedReason` (3
  testes, com fixture de DB) — grace expirado grava `"automatic"`; org já suspensa manualmente NÃO tem
  `suspendedReason` sobrescrito quando a subscription também cai em `past_due` expirado (mesmo cenário
  do achado de QA, agora na camada que grava o dado); volta a ficar em dia limpa `suspendedReason`.
- `src/lib/actions/admin/organizations.test.ts`: os testes existentes de `suspendOrganization`/
  `reactivateOrganization` agora também verificam `suspendedReason` (`"manual"` e `null`,
  respectivamente).

**Comandos executados**:
- `npx tsc --noEmit` → sem erros.
- `npx vitest run src/lib/billing src/lib/scheduler src/lib/actions/auth.test.ts src/lib/actions/admin/organizations.test.ts src/lib/queries/admin/organizations.test.ts` → 142/142 passed.
- `npm run lint` → 0 erros (mesmos 4 warnings pré-existentes, arquivos não tocados por esta correção).
- `npm test` (suíte completa) → 109 arquivos / 1370 testes passed.
- Confirmado via `ps aux` antes e depois: nenhum processo `vitest` concorrente; nenhum servidor foi
  iniciado ou derrubado por este trabalho (o `next dev` já rodando pertence ao usuário, pré-existente).

**Critérios de aceitação da correção**:

| Critério | Status | Evidência |
|---|---|---|
| Suspensão manual + past_due com grace expirado NÃO dispara `auto_suspended` | PASS | `reminders.test.ts` "NÃO dispara para suspensão MANUAL mesmo com subscription em past_due e grace JÁ EXPIRADO (achado QA)" |
| Suspensão automática de fato DISPARA `auto_suspended` | PASS | `reminders.test.ts` "grace period expirado e Organization já suspensa automaticamente -> envia aviso de suspensão" |
| Suspensão manual + past_due DENTRO do grace period não dispara | PASS | `reminders.test.ts` "subscription em past_due DENTRO do grace period + suspensão manual -> não dispara de qualquer forma" |
| `syncOrgStatuses` grava o sinal correto, sem sobrescrever suspensão manual | PASS | `status-map.test.ts` describe "syncOrgStatuses grava suspendedReason (SPEC-039, correção QA)" |
| Mecanismo de bloqueio em si continua inalterado (D-039-1/D-039-3) | PASS | nenhuma mudança em `computeOrgStatus`/timing de grace; apenas o campo `suspendedReason` foi adicionado como metadado, sem alterar decisão de `status` |
