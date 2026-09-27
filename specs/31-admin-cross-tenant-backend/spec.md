# SPEC-031 — Administrador: backend cross-tenant (listar/gerir Organizations)
- status: IMPLEMENTED (dev-backend, 2026-09-26) | domain: backend | depende de: 030

## Objetivo
Dar ao papel `platform_admin` (SPEC-030) as queries/actions para enxergar e administrar todos os Providers/Organizations que assinam a plataforma: listar, ver uso/saude, suspender e reativar. Base de dados para a tela da SPEC-032.

## Escopo
- Queries (`src/lib/queries/admin/*`), sempre via `requirePlatformAdmin()` + caminho `crossTenant` explicito do policy layer da SPEC-030:
  - `listOrganizations({page, pageSize, search?, status?})` — nome, slug, status, data de criacao, dono (nome/email do `owner`), contadores basicos (campanhas ativas, leads totais, instancias WhatsApp conectadas) — sem PII de lead individual, so agregados.
  - `getOrganizationDetail(orgId)` — os mesmos contadores + status de assinatura (campo(s) que a SPEC-033 define; aqui so o que ja existe: `Organization.status`) + ultima atividade (ultimo `SchedulerRun`/`Touch` da org).
- Actions (`src/lib/actions/admin/*`), `ActionResult<T>`, sempre `requirePlatformAdmin()`:
  - `suspendOrganization({orgId, reason})` -> seta `Organization.status = "suspended"`; cron (SPEC-030) ja para de processar; nao apaga dado nenhum.
  - `reactivateOrganization({orgId})` -> volta `status = "active"`.
  - Auditoria: reaproveitar o padrao de `IntegrationAuditLog` (SPEC-018) — novo model `PlatformAuditLog` (id, adminUserId, orgId, action `suspend|reactivate`, reason?, at) ou extensao de um log generico — decisao tecnica do dev-backend (documentar a escolha), nao precisa `[NEEDS_DECISION]`.
- Todas as queries/actions cross-tenant desta SPEC NUNCA passam pelo helper "padrao" com `orgId` implicito (SPEC-030) — sempre pelo caminho explicito de admin, e cada uma tem teste confirmando que um `provider` comum recebe `ForbiddenError`/`ActionResult` de erro ao tentar chamar.

## Fora do escopo
- Tela (SPEC-032).
- Metricas financeiras/billing detalhadas (SPEC-033 define o que existe para mostrar; esta SPEC so expõe o que ja existe no schema base).
- Qualquer coisa em `../mobile/`.

## Criterios de aceitacao
- [x] `platform_admin` lista/ve detalhe/suspende/reativa qualquer org; `provider` recebe erro em toda tentativa (teste cobrindo os 2 papeis).
- [x] Suspender uma org bloqueia o cron (reusa criterio ja testado na SPEC-030) sem apagar dados.
- [x] Auditoria registra quem/quando/acao/motivo.
- [x] build/lint/typecheck/testes OK.

## Ordem de execucao
dev-backend, apos 030 `IMPLEMENTED`. Precede 032.

## Implementation Notes

### Arquivos criados
- `prisma/schema.prisma` — novo model `PlatformAuditLog` (id, `adminUserId` [campo solto, sem relation para `User`, mesmo padrão de `IntegrationAuditLog.userId` — auditoria sobrevive à remoção futura da conta do admin], `orgId` + relation `Organization` `onDelete: Cascade`, `action` [`PlatformAuditAction`: `suspend`/`reactivate`], `reason` opcional, `at`) + relação `Organization.platformAuditLogs`. Decisão técnica documentada aqui conforme pedido no "Escopo" da SPEC (não era `[NEEDS_DECISION]`).
- `prisma/migrations/20260926194546_platform_audit_log/migration.sql` — migração aplicada no banco de dev.
- `src/lib/schemas/admin.ts` — `listOrganizationsSchema`, `orgIdSchema`, `suspendOrganizationSchema` (exige `reason` com 3-500 chars), `reactivateOrganizationSchema`.
- `src/lib/queries/admin/organizations.ts` — `listOrganizations({page,pageSize,search?,status?})` e `getOrganizationDetail(orgId)`. Ambas: `requirePlatformAdmin()` primeiro, depois só `adminPrisma` (nunca `scopedPrisma`/`requireProviderOrg`). Contadores (campanhas ativas, leads totais, instâncias WhatsApp conectadas) calculados em lote via `groupBy`/`_count` para evitar N+1 na listagem. Dono da org = 1º `Membership` com `orgRole: "owner"` (nome/email do `User`). `getOrganizationDetail` adiciona `subscriptionStatus` (`Subscription.status`, `null` se a org não tem assinatura ainda) e `lastActivityAt` (mais recente entre `SchedulerRun.startedAt` e `Touch.createdAt` via `lead.campaign.orgId`). Nenhuma query devolve PII de lead individual — só ids/nomes agregados e nome/email do dono.
- `src/lib/actions/admin/organizations.ts` — `suspendOrganization({orgId, reason})` e `reactivateOrganization({orgId})`, `ActionResult<T>`. Sempre `requirePlatformAdmin()` → valida entrada → confirma que a org existe (senão `formError("Organização não encontrada.")`, nunca revela detalhe) → `adminPrisma.$transaction([update de status, create de PlatformAuditLog])` — status e auditoria sempre atômicos (nunca existe mudança de status sem o log correspondente).
- `src/lib/queries/admin/organizations.test.ts`, `src/lib/actions/admin/organizations.test.ts` — testes funcionais (fixtures `createTestOrg`/`purgeTestOrg` da SPEC-030 + um `User` `platform_admin` avulso criado no teste, já que `platform_admin` não tem `Organization` própria — D-30-1).
- `src/lib/actions/admin/admin-auth-coverage.test.ts` — teste estático (grep de código-fonte, mesmo padrão de `integration-auth-coverage.test.ts`) confirmando que toda função exportada de `queries/admin/organizations.ts` e `actions/admin/organizations.ts` chama `requirePlatformAdmin()` antes de qualquer acesso a `adminPrisma`/`prisma`, e que nenhum dos dois arquivos referencia `requireProviderOrg`/`requireActiveProviderOrg`/`scopedPrisma`.

### Testes executados (VERIFIED)
- `npx vitest run src/lib/queries/admin/organizations.test.ts src/lib/actions/admin/organizations.test.ts src/lib/actions/admin/admin-auth-coverage.test.ts` → 3 arquivos, **15 testes** (correção de contagem: o relatório original desta rodada dizia "16"; a contagem real, confirmada por execução isolada destes 3 arquivos em 2026-09-26 na rodada de QA abaixo, é 15 — nunca arredondar/estimar).
- `npm test` (suíte completa) → 101 arquivos, **1254/1254 testes passando** (1239 pré-existentes + 15 novos desta SPEC).
- `npm run typecheck` → limpo.
- `npm run lint` → limpo (só 4 warnings pré-existentes em `src/lib/billing/*`, não relacionados a esta SPEC).
- `npm run build` → build de produção concluído sem erros.

### Rodada de correção de QA (dev-backend, 2026-09-26) — flakiness da suíte completa
QA independente reprovou a rodada anterior com `NEEDS_FIX`: a implementação funcional da SPEC-031
(autorização, atomicidade da auditoria, filtro do cron, ausência de PII, validação de `reason`) foi
confirmada correta — os 15 testes desta SPEC passam de forma estável em toda combinação testada — mas
`npm test` (suíte completa) não reproduzia "1254/1254" de forma consistente: 2 rodadas do QA deram
1252/1254 e 1251/1254, sempre com falha isolada em `src/lib/mobile/meeting-reminders.test.ts`
(SPEC-028, arquivo pré-existente **não tocado** pela implementação original da SPEC-031, confirmado
por `git diff --stat` do QA) — 9/9 quando roda isolado, falhando só sob a suíte completa.

**Causa raiz (reproduzida e confirmada por este dev-backend):** não é um bug de negócio nem uma
condição de corrida entre workers do Vitest (`fileParallelism: false` já serializa os arquivos de
teste). É **volume de `Organization` no banco `_test` compartilhado**: a partir da SPEC-030,
`sweepAlerts` (`src/lib/mobile/alerts.ts`) passou a varrer 1x por Organization ATIVA (cross-tenant por
design, correto para produção) — e a SPEC-030/031 aumentaram bastante o número de orgs de fixture que
convivem no mesmo banco `_test` (16 orgs ativas medidas neste banco no momento da correção, contra bem
menos quando a SPEC-028 foi escrita). Dois efeitos combinados geravam a flakiness observada pelo QA:
1. `meeting-reminders.test.ts` chama `sweepAt()` em loop (até 15 varreduras numa única `it`); com
   O(orgs) custo por varredura (~270-540ms medido localmente para 16 orgs), o total ficava perto do
   `testTimeout` padrão do Vitest (5000ms) — qualquer variação normal de latência (I/O, CPU da
   máquina) furava o timeout, sempre num teste diferente a cada rodada (o sintoma "casos diferentes
   falhando em cada rodada" relatado pelo QA).
2. Vários testes em `meeting-reminders.test.ts` e `alerts.test.ts` liam/apagavam `MobileAlert` sem
   filtrar por `orgId` (`deleteMany({})`, `findMany({where:{kind:...}})` sem orgId, contagem de
   "não lidos" sem orgId) — inofensivo enquanto só existia a própria org de teste no banco, mas como
   `sweepAlerts`/o adapter fake de push são cross-tenant, contadores como `calls.n` (pushes recebidos
   pelo fake Expo) ou `prisma.mobileAlert.count({where:{readAt:null}})` global também somavam
   episódios de QUALQUER outra org ativa do banco — reproduzido neste dev-backend: uma rodada real
   deu `expected 16 to be +0` no teste de baseline de `alerts.test.ts` porque as outras 15 orgs
   ativas do banco geraram episódios/pushes próprios durante a mesma varredura.

**Fix aplicado (só testes/config — nenhuma mudança de comportamento de produção):**
- `vitest.config.ts` — `testTimeout`/`hookTimeout` de 5000ms (padrão) para 15000ms: dá margem real
  sem mascarar hangs genuínos (ainda bem abaixo do teto de 15s já usado no teste de push lento).
- `src/lib/test-utils/park-other-orgs.ts` (novo) — `parkOtherOrgs(...keepOrgIds)`: suspende toda
  `Organization` ativa que não seja a(s) do próprio teste (restaura no fim). Usado em
  `alerts.test.ts` e `meeting-reminders.test.ts` (`beforeAll`/`afterAll`) para que `sweepAlerts`
  cross-tenant só alcance a org do próprio arquivo durante sua execução — elimina o custo O(orgs) (e
  a contaminação de contadores globais) independente de quantas fixtures outras specs deixarem no
  banco `_test` no futuro.
- `src/lib/mobile/meeting-reminders.test.ts` — `remAlerts()`, os `deleteMany` de `beforeEach`/
  `afterAll` (`MobileAlert`, `MeetingSettings`) passaram a filtrar por `fx.orgId` (nunca `{}` global).
- `src/lib/mobile/alerts.test.ts` — `cleanAlerts()` passou a filtrar por `orgId`; a comparação de
  `unread-count` e o `findFirstOrThrow` de `scheduler_stale` na Suíte AC7 passaram a filtrar por
  `orgId` (antes comparavam/buscavam sem escopo, o que já era frágil por natureza mesmo antes desta
  rodada).
- `../mobile/` (app React Native, fora de `web/`) não foi tocado.

**Testes executados (VERIFIED) — reprodutibilidade confirmada em 5 execuções consecutivas:**
- `npm test` (suíte completa), 5x seguidas nesta máquina, sem nenhuma outra mudança entre elas:
  todas deram **1254/1254 testes passando, 101/101 arquivos**. Durações: 83.76s, 84.72s, 73.68s,
  76.46s, 79.24s (a 6ª rodada, feita antes deste fix, tinha dado 1253/1254 com falha em
  `alerts.test.ts` — reproduzindo exatamente a contaminação cross-org descrita acima; após o fix,
  não recorreu em nenhuma das 5 rodadas subsequentes).
- `npx vitest run src/lib/queries/admin/organizations.test.ts src/lib/actions/admin/organizations.test.ts src/lib/actions/admin/admin-auth-coverage.test.ts` → 3 arquivos, **15 testes**, todos passando (confirma a contagem real citada acima).
- `npm run typecheck` → limpo.
- `npm run lint` → limpo (mesmos 4 warnings pré-existentes de `src/lib/billing/*`, não relacionados).

**Critério de aceitação "build/lint/typecheck/testes OK":** PASS, com evidência reproduzível (5x) acima.

### Critérios de aceitação
| Critério | Status | Evidência |
|---|---|---|
| `platform_admin` lista/vê detalhe/suspende/reativa qualquer org; `provider` recebe erro em toda tentativa | PASS | `organizations.test.ts` (queries e actions) — casos "negação para provider comum" (`ForbiddenError`/`ActionResult` com `ok:false`) e casos "platform_admin" (sucesso cross-tenant, contadores/dados corretos de ambas as orgs de teste) |
| Suspender uma org bloqueia o cron sem apagar dados | PASS | `organizations.test.ts` (actions) — após `suspendOrganization`, a org some de `organization.findMany({where:{status:"active"}})` (mesmo filtro usado por `runTick`, SPEC-030/013) e o registro da org continua existindo (`findUnique` não-nulo); a mecânica do cron em si já é coberta pelos testes da SPEC-030, reaproveitados conforme pedido no AC |
| Auditoria registra quem/quando/ação/motivo | PASS | `organizations.test.ts` (actions) — `PlatformAuditLog` criado com `adminUserId`, `orgId`, `action` (`suspend`/`reactivate`), `reason` (obrigatório em suspend, `null` em reactivate) e `at` |
| build/lint/typecheck/testes OK | PASS | ver "Testes executados" acima |

### Decisões arquiteturais
- **Auditoria**: novo model `PlatformAuditLog` (não reaproveitei `IntegrationAuditLog` porque o domínio é diferente — ação de plataforma sobre a org inteira, não sobre uma integração — mas segui o mesmo padrão de campos/decisões: sem relation FK para `User`, para a linha de auditoria nunca desaparecer/travar por causa do ciclo de vida da conta do admin).
- `suspendOrganization`/`reactivateOrganization` fazem update de status + create de log dentro do MESMO `adminPrisma.$transaction`, para nunca existir divergência entre "status mudou" e "há registro de auditoria".
- Nenhuma das duas actions tem caminho para a organização do próprio admin: `platform_admin` não possui `Organization`/`Membership` (D-30-1 da SPEC-030), então não existe "própria org" a proteger — a superfície de risco citada no pedido (não deixar o admin manipular a própria org de forma inconsistente) é coberta pela própria ausência estrutural de vínculo, e os testes de `platform_admin` usam sempre uma org de terceiro (fixture `createTestOrg`), nunca uma org do admin.
- Contadores da listagem calculados em lote (`groupBy`/`findMany` com `_count`, 3 queries totais independente do número de orgs na página) para não introduzir N+1 ao paginar.

### Limitações conhecidas
- Nenhuma tela/rota consome estas queries/actions ainda — isso é a SPEC-032 (fora de escopo aqui, conforme "Fora do escopo").
- `getOrganizationDetail`/`listOrganizations` não expõem métricas financeiras detalhadas (histórico de faturas, valores) — só `Subscription.status`, conforme "Fora do escopo" ("SPEC-033 define o que existe para mostrar; esta SPEC só expõe o que já existe no schema base").
- `../mobile/` não foi tocado.
