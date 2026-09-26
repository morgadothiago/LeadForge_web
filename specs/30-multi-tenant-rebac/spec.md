# SPEC-030 — Migracao multi-tenant + ReBAC (Organization, orgId, guards)
- status: IN_PROGRESS (dev-backend, 2026-09-26 — 3ª rodada: vazamento cross-tenant do MobileAlert corrigido, testes de vazamento por domínio escritos e passando; PERMANECE IN_PROGRESS por um novo achado nesta rodada — `/api/integrations/meetings` — ver Implementation Notes 2026-09-26) | domain: backend | depende de: 009 (auth), 001 (schema base)

## Objetivo
Transformar o LeadForge de single-tenant (1 unico "workspace" implicito, todos os `User` compartilhando os mesmos dados) para multi-tenant: cada assinante ("Provider") opera dentro do proprio tenant (`Organization`), sem visibilidade de dados de outro tenant; um papel de plataforma (`Administrador`) enxerga e administra todos os tenants. Esta e a SPEC-base — nenhuma outra frente (billing, admin UI, landing) pode ser implementada antes dela, pois billing cobra por Organization e o admin cross-tenant lista Organizations.

## Contexto (levantado no codigo, verdade-base)
- `User` (`prisma/schema.prisma`) so tem id/name/email/role(admin|member)/passwordHash — `role` hoje e so um rotulo, nao ha enforcement de "member" restrito em lugar nenhum verificado alem de `requireAdmin()` (SPEC-018/019).
- Sessao = JWT com `userId` apenas (`src/lib/auth/session-token.ts`, `session.ts`). `requireUser()` (`src/lib/auth/require-user.ts`) resolve o `User` a partir do `userId`.
- Isolamento hoje: **zero**. `Campaign.userId` e a unica FK de "dono", mas nenhuma query filtra por ela de forma consistente (a maioria das telas mostra tudo). `IcpProfile` e `Sequence`/`MessageTemplate` sao tabelas **globais**, sem FK de dono nenhuma — compartilhadas entre todos os usuarios.
- `IntegrationSecret`/`IntegrationAuditLog` (SPEC-018) sao globais (1 Evolution/n8n/LLM/Places para o app inteiro).
- Scheduler (`src/app/api/cron/tick/route.ts`, `src/lib/scheduler/`) e busca de leads (`src/lib/lead-search/run.ts`) trabalham por `campaignId` (lock `pg_advisory_xact_lock(hashtext('leadsearch:' + campaignId))`), sem nocao de tenant.
- `AgentSettings`/`MeetingSettings` sao singletons globais (`id = "global"`).
- **Fora do escopo desta SPEC (regra dura do usuario): nada em `../mobile/`.** O contrato `/api/mobile/v1` (SPEC-021/022/023) e consumido pelo app mobile hoje — se esta migracao alterar o shape de `User`/sessao/queries usadas por esse contrato, o contrato mobile deve continuar respondendo com o mesmo formato (compatibilidade), e qualquer quebra necessaria vira risco sinalizado abaixo, nunca uma alteracao silenciosa do lado mobile.

## Escopo
### 1. Modelo de dados
- Novo model `Organization`: `id`, `name`, `slug` (unico, usado em URLs/branding futuro), `status` (`active|suspended|cancelled`, default `active` — ver SPEC-033 para status derivado de assinatura), `createdAt`, `updatedAt`.
- Novo model `Membership`: liga `User` a `Organization` com um papel **dentro do tenant** (`orgRole`: `owner|member` — hoje so havera 1 membro por org na pratica, mas o modelo ja suporta N:N para nao exigir migracao destrutiva depois). `@@unique([userId, orgId])`.
- `User.role` (hoje `admin|member`) e re-significado como **papel de PLATAFORMA**, nao de tenant: valores passam a ser `platform_admin | provider`. Migracao de dados (D-30-1, FECHADA): todo `User` com `role="admin"` hoje vira `platform_admin` (sem `Organization`/`Membership` proprios — acessa tudo pelo caminho cross-tenant explicito); todo `User` com `role="member"` hoje vira `provider`, dono (`owner`) de uma `Organization` nova criada 1:1 na migracao para preservar os dados existentes dele sem perda (nome da org gerado a partir do nome/e-mail do usuario, ajustavel depois).
- `orgId String` (FK `Organization`, `onDelete: Restrict`) adicionado em: `Campaign`, `WhatsAppInstance`, `EmailAccount`, `Suppression`, `SchedulerRun`, `IntegrationSecret`, `IntegrationAuditLog`, `AgentSettings` (deixa de ser singleton global — vira 1 linha por org), `MeetingSettings` (idem), `Agent`, `KnowledgeDocument` (via `agentId` ja cascade, mas precisa `orgId` direto para query eficiente e para o caso `agentId` null), `WebhookEvent` (`source` continua, mas precisa resolver a org pelo token/instancia recebida — ver riscos).
- `IcpProfile`, `Sequence`, `MessageTemplate`, `SequenceStep`: D-30-2 (FECHADA, recomendacao do orquestrador adotada) — viram estritamente por-org (`orgId` obrigatorio em `IcpProfile`/`Sequence`/`MessageTemplate`; `SequenceStep` resolve org via `Sequence`). Sem biblioteca global curada pelo Administrador nesta fase (pode virar SPEC futura se o usuario quiser). Migracao de dados: registros hoje existentes sao atribuidos a org(s) criada(s) para os antigos `role="member"` conforme D-30-1 (se houver mais de um usuario/org na base, o dev-backend decide o mapeamento 1:1 mais razoavel e documenta no relatorio de implementacao).
- Tabelas que ja penduram de algo com `orgId` (ex.: `Lead` via `Campaign`, `Touch` via `Lead`, `Opportunity`/`Meeting`/`StageHistory` via `Campaign`/`Opportunity`) **nao** ganham `orgId` proprio — resolvem tenant via join; index composto adicionado onde a query hoje ja filtra por `campaignId` para nao perder performance.
- Todas as FKs novas de `orgId` ganham `@@index([orgId, ...])` espelhando os indices existentes por `campaignId`/`userId` (ex.: `Campaign @@index([orgId, status])`).

### 2. Sessao / JWT
- Payload da sessao passa a carregar `{ userId, orgId, platformRole }` (nao so `userId`). `platformRole` = `provider|platform_admin`. Usuario com multiplas Organizations (fase futura, ver D-30-4) precisa de um seletor de org ativa — fora de escopo agora: 1 usuario = 1 org ativa no token, resolvida no login.
- `requireUser()` passa a retornar tambem `orgId` e `platformRole`; nova funcao `requireProviderOrg()` (retorna `{user, orgId}`, lanca `ForbiddenError` se `platformRole !== "provider"`) e `requirePlatformAdmin()` (retorna `{user}`, lanca `ForbiddenError` se `platformRole !== "platform_admin"`) — usadas pelas SPECs 031-034.
- Login (`SPEC-009`) precisa resolver a `Organization` do usuario na hora do `createSession`; usuario sem `Membership` (nao deveria existir apos a migracao) => erro tratado, nunca sessao sem org.
- **Risco explicito para o mobile**: o contrato mobile de auth (`SPEC-021`) tambem usa a sessao/token deste mesmo modulo. Se o payload do token mudar de forma incompativel, o mobile quebra. Este SPEC deve manter os campos hoje consumidos pelo mobile no mesmo lugar/formato (aditivo, nao substitutivo) — a validacao exata do que o mobile le fica marcada como risco em "Riscos", nao resolvida aqui (nenhuma edicao em `../mobile/`).

### 3. Guard / policy layer (enforcement, nao so coluna)
- Adicionar coluna `orgId` sem enforcement = vazamento cross-tenant. Esta SPEC exige uma camada fina de policy sobre o Prisma: todo `findMany`/`findFirst`/`update`/`delete` em modelo com `orgId` direto ou indireto passa por um helper central (`src/lib/tenant/scoped-prisma.ts` ou equivalente) que injeta `where: { orgId }` automaticamente a partir do contexto de sessao resolvido por `requireProviderOrg()`; `platform_admin` usa um caminho explicito e separado (`src/lib/tenant/admin-prisma.ts` ou parametro explicito `{ crossTenant: true }`) — nunca implicito, para que nenhuma query "esqueca" o filtro por acidente.
- Todas as queries/actions existentes (SPECs 004-029, dezenas de arquivos em `src/lib/queries/*` e `src/lib/actions/*`) precisam ser revisadas e migradas para o helper com escopo de org. Isso e o maior volume de trabalho da SPEC — listar exaustivamente os arquivos afetados faz parte da implementacao (dev-backend faz o levantamento com grep antes de comecar a editar).
- Teste obrigatorio: para cada dominio (campanhas, leads, sequences/templates conforme D-30-2, whatsapp, email, integracoes, scheduler, agentes, reunioes/notificacoes), existe pelo menos 1 teste que cria 2 Organizations e confirma que a query/action da Org A nunca retorna/afeta dado da Org B, mesmo com IDs adivinhados (teste de vazamento, nao so de "esquecer o where").

### 4. Scheduler / lock / budget
- `lockKey` do lead-search (`src/lib/lead-search/run.ts:26`) continua por `campaignId` (nao muda — cada campanha ja pertence a uma unica org, lock por campanha ja impede corrida entre orgs). D-30-5 (FECHADA, recomendacao do orquestrador adotada): sim, havera teto agregado por org no futuro (relevante para planos pagos, SPEC-033) — esta SPEC so prepara o terreno (schema/guard prontos para a org ser a unidade de cobranca); NAO cria contador de uso nem enforcement de budget agregado aqui — isso fica inteiramente na SPEC-033, que ja depende deste schema.
- Cron `/api/cron/tick` passa a iterar por Organization (nao mais "todas as campanhas do banco" cegamente) e respeita `Organization.status !== "active"` (org suspensa nao dispara touches nem busca de leads) — isso e o gate minimo de billing que ja nasce aqui, mesmo antes da SPEC-033 existir tecnicamente (states futuros de assinatura mapeiam para `active|suspended`).

## Fora do escopo
- UI de convite de multiplos membros por org (D-30-4) — schema suporta, tela nao entra aqui.
- Selecao de org ativa por usuario multi-org — 1 org por usuario neste SPEC.
- Billing em si (SPEC-033) e admin UI cross-tenant (SPEC-031/032) — so consomem este schema.
- Qualquer alteracao em `../mobile/`.

## Decisoes fechadas (usuario, 2026-09-25 — SPEC-030 aprovada com as recomendacoes do orquestrador, exceto D-30-1 que o usuario ajustou)

**D-30-1** — Quem vira `platform_admin` apos a migracao: `User.role="admin"` (hoje) -> `platform_admin` (sem org propria, so acesso cross-tenant). `User.role="member"` (hoje) -> `provider`, dono (`owner`) de uma `Organization` nova, criada 1:1 na migracao, para preservar os dados existentes sem perda. Ver aplicacao em "Modelo de dados" acima.

**D-30-2** — `IcpProfile`/`Sequence`/`MessageTemplate`/`SequenceStep`: viram estritamente por-org (`orgId` obrigatorio), sem biblioteca global curada pelo Administrador nesta fase. Ver aplicacao em "Modelo de dados" acima.

**D-30-3** — ReBAC: policy layer proprio (`src/lib/tenant/*`), sem CASL. 2 papeis de plataforma (`provider`/`platform_admin`) + 2 papeis de org (`owner`/`member`, `member` ainda sem uso real ate D-30-4).

**D-30-4** — Convite de multiplos membros por Organization: fica para depois. Esta SPEC cria o model `Membership` (N:N) mas so popula 1 membro (`owner`) por org na migracao; tela de convite/gestao de membros e uma SPEC futura (numero a definir).

**D-30-5** — Budget/rate-limit agregado por Organization no scheduler: aprovado o principio (planos pagos vao precisar de teto agregado), mas o contador/enforcement em si fica inteiramente na SPEC-033 — esta SPEC so garante que o schema/guard ja tratam `Organization` como unidade natural de cobranca.

## Arquitetura / arquivos esperados
- `prisma/schema.prisma`: `Organization`, `Membership`, `orgId` nas tabelas listadas, migration de dados (script separado de backfill, nao só `prisma migrate dev`).
- `src/lib/auth/session-token.ts`, `session.ts`, `require-user.ts`: payload `{userId, orgId, platformRole}`, `requireProviderOrg()`, `requirePlatformAdmin()`.
- `src/lib/tenant/` (novo): policy layer central (nome exato conforme D-30-3).
- Revisao de TODOS os arquivos em `src/lib/queries/*`, `src/lib/actions/*`, `src/app/api/**/route.ts`, `src/lib/scheduler/*`, `src/lib/lead-search/*` que hoje leem/escrevem tabelas com `orgId` novo.
- `src/app/api/cron/tick/route.ts`: iteracao por org ativa.

## Criterios de aceitacao
- [ ] `Organization`/`Membership` no schema, migration aplicada + script de backfill de dados existentes conforme D-30-1/D-30-2.
- [ ] Sessao carrega `orgId`+`platformRole`; login resolve a org do usuario.
- [ ] Nenhuma query/action de dominio de negocio roda sem passar pelo helper de escopo (grep de `prisma.<model>.find/update/delete` fora do helper = falha de revisao).
- [ ] Testes de vazamento cross-tenant cobrindo cada dominio listado na secao 3, todos passando.
- [ ] `platform_admin` consegue rodar queries cross-tenant SOMENTE pelo caminho explicito (`admin-prisma`/`{crossTenant:true}`), nunca pelo caminho padrao.
- [ ] Cron respeita `Organization.status`.
- [ ] Contrato `/api/mobile/v1` (SPEC-021/022/023) continua respondendo no mesmo formato hoje testado — teste de regressao rodado, nenhuma alteracao em `../mobile/`.
- [ ] build/lint/typecheck/testes OK.

## Riscos
- Maior superficie de mudanca do projeto ate aqui — volume alto de arquivos tocados, risco de regressao funcional generalizada. Mitigacao: dev-backend faz o levantamento completo de arquivos afetados antes de editar, e roda a suite completa de testes existente (nao so os novos) antes de reportar IMPLEMENTED.
- Vazamento cross-tenant e o risco de seguranca mais serio do projeto ate hoje — motivo de exigir teste de vazamento por dominio como criterio de aceite, nao "nice to have".
- Contrato mobile: qualquer mudanca de shape em `User`/sessao/queries usadas por `/api/mobile/v1` quebra o app mobile publicado. Mitigacao: manter campos aditivos, rodar os testes existentes de SPEC-021/022/023, nunca editar `../mobile/`.
- Migracao de dados de producao (se ja houver dados reais) e irreversivel sem backup — confirmar com o usuario antes de rodar em ambiente com dados reais.

## Ordem de execucao
Somente dev-backend. APPROVED em 2026-09-25 — dev-backend ja acionado pelo orquestrador (nao aguarda novo pedido). Ao concluir, qa-reviewer revisa antes de IMPLEMENTED. Bloqueia todas as demais SPECs desta rodada (031-035), que seguem DRAFT ate o usuario decidir D-33-x/D-35-x.

## Implementation Notes — Backend

Três rodadas de implementação, nesta ordem. As duas primeiras estão resumidas abaixo (a 1ª com o relatório
original de 2026-09-25; a 2ª reconstruída por inspeção de código nesta 3ª rodada, porque o agente da 2ª
rodada caiu em rate limit antes de reportar — o texto abaixo é o que foi CONFIRMADO existir no código, não
uma transcrição do que a 2ª rodada disse ter feito). A 3ª rodada (2026-09-26) é a mais detalhada porque foi
escrita ao vivo, com evidência de teste para cada afirmação.

### Rodada 1 (2026-09-25) — fundação: schema, sessão, policy layer, scheduler

Esta é a maior mudança de superfície do projeto (confirmado durante a implementação). A fundação inteira
foi construída, migrada e validada; a migração exaustiva de "toda query/action/rota" (critério de aceite
explícito da SPEC) **não coube neste ciclo** — ver "O que falta" abaixo. Reportando com honestidade em vez
de marcar IMPLEMENTED: vários critérios de aceite ainda falham (ver tabela).

### O que foi feito (verificado)
- **Schema** (`prisma/schema.prisma`): `Organization` (`id/name/slug/status/createdAt/updatedAt`), `Membership`
  (`userId/orgId/orgRole`, `@@unique([userId,orgId])`). `orgId` adicionado em `Campaign`, `IcpProfile`, `Sequence`,
  `MessageTemplate`, `WhatsAppInstance`, `EmailAccount`, `Suppression` (unique virou `[orgId,kind,value]`),
  `SchedulerRun` (nullable — ver abaixo), `IntegrationSecret` (unique virou `[orgId,integration,name]`),
  `IntegrationAuditLog`, `AgentSettings` (deixou de ser singleton `id="global"`, agora 1 linha/org, `orgId @unique`),
  `MeetingSettings` (idem), `Agent`, `KnowledgeDocument` (`orgId` direto + `agentId`). `WebhookEvent.orgId` é
  nullable (nem todo evento resolve a org — risco já previsto no spec). `User.role` re-significado
  (`platform_admin|provider`, default novo `"provider"`).
  - `SchedulerRun.orgId` foi feito **nullable** (não `String` obrigatório como o spec sugeria): o tick agora
    cria 1 `SchedulerRun` por Organization ativa processada, mas a rodada "meta" (status `locked`, outra rodada
    já rodando) não pertence a nenhuma org — precisaria inventar uma org fictícia para não perder essa
    observabilidade, o que pareceu pior. Migration extra: `20260925120000_scheduler_run_org_nullable`.
- **Migrations** (`prisma/migrations/`): duas fases, como o spec pediu ("script separado de backfill, não só
  `prisma migrate dev`"): `20260925100000_multi_tenant_orgs_structure` (tudo nullable + tabelas novas) →
  `src/scripts/backfill-org.ts` (backfill de dados, roda fora do `prisma migrate`) →
  `20260925100100_multi_tenant_orgs_notnull` (`orgId` obrigatório + uniques/índices finais) →
  `20260925120000_scheduler_run_org_nullable`. Todas aplicadas com sucesso no Postgres de dev local
  (`docker compose up -d postgres`, porta 5434) via `prisma migrate deploy`, e o schema/migrations rodam do
  zero via `prisma migrate deploy` + `prisma/seed.ts` no banco de teste (confirmado pelo `global-setup` do
  Vitest, que recria `leadforge_test` a cada run).
  - **Decisão registrada (dev-backend), fora do D-30-1 literal**: a única instalação local tinha 1 `User` com
    `role="admin"` que já era DONO de dados de negócio reais (`Campaign`, `Suppression` etc.) — não havia
    nenhum `role="member"` para herdar esses dados via o caminho "normal" do D-30-1. Perder esses dados violaria
    "preservar os dados existentes sem perda" (o objetivo do D-30-1). O backfill cria, como rede de segurança,
    uma `Organization` própria (owner) para esse usuário MESMO ele permanecendo `platform_admin` — única forma
    de não deixar `Campaign.orgId` (NOT NULL) órfão. Documentado em comentário no topo de
    `src/scripts/backfill-org.ts`. Isso é uma decisão do dev-backend, não uma reinterpretação do D-30-1 em si
    (o caminho normal — admin sem org, member vira provider/owner — está implementado e é o caminho seguido
    quando existir `role="member"`).
  - **Risco de produção não verificado**: o spec pede "confirmar com o usuário antes de rodar em ambiente com
    dados reais". A migração/backfill rodou contra o Postgres de DESENVOLVIMENTO local (1 usuário, 1 campanha,
    19 supressões, alguns SchedulerRuns/templates — dados de teste manual, não produção). Nenhum ambiente de
    produção foi tocado. Se este projeto tiver um banco de produção separado, a migração TEM que ser revisada/
    confirmada com o usuário antes de rodar lá — não assumir que o que rodou em dev é suficiente.
- **Sessão/JWT** (`src/lib/auth/session-token.ts`, `session.ts`, `require-user.ts`, `require-admin.ts`):
  payload passa a ser `{userId, orgId, platformRole}` (antes só `sub=userId`). `createSession(userId, orgId,
  platformRole)`. `requireUser()` devolve `orgId`/`platformRole` (lidos da SESSÃO, não relidos do banco a cada
  chamada — a org ativa é decidida no login, D-30-4 fora de escopo). Novo `requireProviderOrg()` (retorna
  `{user, orgId}`, `ForbiddenError` se não for provider com org) e `requirePlatformAdmin()` (idem para
  platform_admin) em `require-admin.ts`, substituindo o antigo `requireAdmin()` (removido — todo call site
  migrado para `requireProviderOrg()`, já que os recursos que ele protegia — integrações, agentes, busca de
  leads — são por-org, não "admin de plataforma"). Login (`src/lib/actions/auth.ts`) resolve `orgId`/
  `platformRole` via `Membership` no momento do `createSession`; usuário `provider` sem `Membership` => erro
  tratado (nunca sessão sem org), consistente com o spec.
- **Policy layer** (`src/lib/tenant/`, D-30-3, implementação própria sem CASL):
  - `scoped-prisma.ts`: `scopedPrisma(orgId)` é um Proxy que envolve o Prisma Client injetando o filtro de
    `orgId` (direto, ou via caminho de relação para os modelos "pendurados" — `Lead` via `Campaign`, `Touch`
    via `Lead`→`Campaign`, `Opportunity`/`Meeting`/`SearchRun` via `Campaign`, `InstanceAlert` via
    `WhatsAppInstance`, `AgentRun` via `Agent`, `Draft`/`LeadNote` via `Lead`→`Campaign`, `SequenceStep` via
    `Sequence`) em `findMany/findFirst/findUnique(OrThrow)/count/aggregate/groupBy/create/createMany/update/
    updateMany/delete/deleteMany/upsert`. `update`/`delete`/`upsert` usam padrão "verifica antes" (where único
    teria que aceitar `AND` arbitrário, o que o Prisma não permite) — se o registro não pertence à org, lança
    `TenantNotFoundError` (nunca revela que existe em outra org). Achata automaticamente `where` de chave
    composta (`{orgId_kind_value: {...}}`) para reusar `findFirst` com segurança.
  - `admin-prisma.ts`: `adminPrisma` (= Prisma Client cru, de propósito) para o caminho cross-tenant explícito
    de `platform_admin`. Nenhum endpoint desta SPEC usa isso ainda (fora de escopo — prepara terreno para
    SPEC-031/032, como pedido).
  - **Limitação conhecida e séria**: `scopedPrisma()` é tipado como `any` internamente (Proxy genérico sobre
    todos os modelos) — o TypeScript NÃO verifica mais em tempo de compilação que os campos usados num
    `select`/`where`/`data` existem no modelo certo. Isso é uma perda real de uma rede de segurança que o
    projeto tinha antes. Mitigação parcial: os call sites migrados anotam os tipos de retorno manualmente onde
    o `noImplicitAny` reclamou. Não tive tempo de desenhar uma versão com tipos genéricos preservados
    (dá para fazer com `Prisma.TypeMap` e condicionais, mas é trabalho de tipagem não-trivial) — fica como
    dívida técnica explícita, não escondida.
- **Cron/scheduler** (`src/app/api/cron/tick/route.ts` → `src/lib/scheduler/run-tick.ts`): o tick agora
  resolve as `Organization` ATIVAS (`status: "active"`) e itera uma a uma, com 1 `SchedulerRun` por org
  processada (lock global único continua — 1 tick por vez no processo, não por org: o volume atual não
  justifica lock por org) e orçamento de tempo/envios (`timeBudgetMs`/`maxSends`) COMPARTILHADO entre todas as
  orgs da rodada (para de iterar orgs quando o orçamento acaba, deixando o resto para o próximo tick). Org
  `suspended`/`cancelled` nunca aparece na lista — não dispara touches nem auto-start. `classifyStartable`
  agora recebe `orgId` e confere que a campanha pertence à org antes de operar (defesa contra `campaignId`
  adivinhado, mesmo vindo de uma transação crua). `lead-search/run.ts` mantém o lock por `campaignId` (não
  mudou, como o spec disse que não devia) mas resolve `IntegrationSecret`/`orgId` via `Campaign.orgId`.
- **Domínio compartilhado migrado para `orgId` explícito**: `src/lib/domain/suppression.ts` (toda a API —
  `findSuppression/isSuppressed/addSuppression/removeSuppression/suppressedIds` — agora exige `orgId`),
  `src/lib/domain/sequence-start.ts` (`classifyStartable(campaignId, orgId, opts)`, `loadCampaignCtx` devolve
  `orgId` para conferência), `src/lib/domain/whatsapp-inbound.ts` (`processInbound` recebe `instance.orgId` e
  filtra `Lead` por `campaign: {orgId}` — corrigido um vazamento real: antes buscava lead só por telefone,
  cruzando orgs diferentes que por acaso tenham o mesmo número), `src/lib/integrations/config.ts`
  (`findIntegrationConfig/getIntegrationConfig/integrationOrigin` por org, cache também chaveado por org),
  `src/lib/whatsapp/provider.ts` (`getWhatsAppProvider(orgId, kind, opts)`), `src/lib/agents/provider.ts`
  (`getLlmProvider(orgId)`), `src/lib/agents/queue.ts` (`isAgentAvailable`/`findActiveCloser` resolvem
  `AgentSettings` por org do agente).
- **Vazamento corrigido durante a migração** (achado real, não hipotético): `src/lib/queries/leads.ts` tinha um
  `$queryRaw` (filtro por canal do último touch) que não passava pelo `scopedPrisma` e não filtrava por org —
  corrigido com `JOIN` até `Campaign` + `WHERE c."orgId" = $1` no SQL cru.
- **Camadas migradas para `requireProviderOrg()` + `scopedPrisma(orgId)`** (fim a fim, verificado por
  `tsc --noEmit` limpo): queries — `campaigns, leads, sequences, sequence-start, suppression, whatsapp,
  whatsapp-health, email, integration, lead-search, agent`; actions — `agent, campaign, email, icp,
  integration, lead (create/update), lead-search, meeting (só settings — resto NÃO migrado, ver abaixo),
  sequence, sequence-start, suppression, template, whatsapp`; `prisma/seed.ts` e `src/lib/test-utils/
  meeting-fixture.ts` recriam `Organization`/`Membership` para os dados de fixture.
- **Testes**: `npm run lint` e `npx tsc --noEmit` OK para TODO o código de produção (`src/app`, `src/lib`,
  `src/scripts`, `prisma/seed.ts`) — zero erros fora de arquivos `*.test.ts`. `npm test` (suíte completa,
  banco de teste recriado do zero): **755 passando / 55 falhando / 303 puladas** (1113 total). As falhas são
  concentradas em: (a) testes estáticos (`auth.test.ts`, `use-server-auth.test.ts`, `*-auth-coverage.test.ts`)
  que fazem grep de código-fonte procurando literalmente a string `requireUser()` — passam a falhar porque o
  novo padrão chama `requireProviderOrg()` (que chama `requireUser()` por dentro, mas o grep não sabe disso);
  isso NÃO é uma regressão de segurança, é o teste estático desatualizado para o novo helper — precisa de
  ajuste, não representa uma vulnerabilidade real; (b) testes que ainda criam fixtures no formato antigo
  (`prisma.campaign.create({data:{...sem orgId}})`, `prisma.meetingSettings.create({data:{id:"global",...}})`)
  — quebram porque o schema exige `orgId` agora; (c) arquivos inteiros de teste ainda não tocados (listados
  abaixo). Nenhum teste foi apagado, desabilitado ou alterado para "passar a qualquer custo".

### O que falta (não implementado neste ciclo — critérios de aceite correspondentes FALHAM)
- **Actions/queries ainda não migradas para `scopedPrisma`** (continuam em `prisma` cru + `requireUser()`):
  `src/lib/actions/pipeline.ts`, `src/lib/actions/meeting.ts` (só `get/saveMeetingSettings` migrados — criar/
  atualizar/transicionar reunião NÃO), `src/lib/actions/meeting-search.ts`, `src/lib/actions/whatsapp-health.ts`,
  `src/lib/queries/dashboard.ts`, `src/lib/queries/meetings.ts`, `src/lib/queries/pipeline.ts`.
- **Rotas de API não auditadas**: `src/app/api/notifications/*` (usam `prisma` direto, sem checar org),
  `src/app/api/integrations/{leads,meetings}/route.ts`, `src/app/api/mobile/v1/**` além de `setCampaignStatus`/
  `setKillSwitch` (que foram corrigidos em `src/lib/mobile/actions.ts` porque quebravam a compilação) — as
  demais (`drafts`, `handoffs`, `pipeline`, `scheduler`, `summary`, `whatsapp/instances`, `devices`, `alerts`)
  NÃO foram revisadas quanto a escopo de org.
- **Canais/execução não auditados por completo**: `src/lib/channels/*` e `src/lib/agents/*` foram corrigidos
  só o suficiente para compilar e para os fluxos que eu segui manualmente (envio de WhatsApp/e-mail,
  `run-agent`, `simulate`); não há garantia de que TODO ponto de leitura/escrita nesses arquivos está
  org-scoped — só os que apareciam nos erros de `tsc` ou que eu inspecionei diretamente.
- **Testes de vazamento cross-tenant por domínio (critério de aceite obrigatório do spec) NÃO foram escritos.**
  Nenhum teste com 2 Organizations + IDs adivinhados foi criado. Isto é o critério mais importante do spec e
  está pendente — não fingir o contrário.
- **Contrato `/api/mobile/v1`**: os testes de SPEC-021/022/023 (`mobile/*.test.ts`) estão entre os 32 arquivos
  de teste que ainda falham (principalmente por fixtures sem `orgId`/`Organization`, não por mudança de
  contrato HTTP em si). Risco real confirmado e já previsto no spec: `user.role` no corpo de resposta do login
  mobile (`src/app/api/mobile/v1/auth/login/route.ts`) agora vem como `"provider"`/`"platform_admin"` em vez
  de `"admin"`/`"member"` — quebra qualquer client mobile que compare a string literal. Não editei `../mobile/`
  (fora de escopo, como instruído); isto precisa virar uma decisão explícita do usuário/SPEC de compat antes
  do mobile publicado quebrar de verdade.
- **`Membership`/seleção de org ativa multi-org**: fora de escopo conforme D-30-4 (não implementado, como
  combinado).
- **`admin-prisma.ts`/`requirePlatformAdmin()`**: existem mas não são usados por nenhum endpoint (fora de
  escopo desta SPEC — SPEC-031/032 consomem).

### Critérios de aceitação — snapshot ao FIM DA RODADA 1 (histórico; ver tabela atualizada no fim do arquivo)
| Critério | Status | Evidência |
|---|---|---|
| `Organization`/`Membership` no schema, migration + backfill | PASS | migrations aplicadas, `backfill-org.ts`, dados verificados no Postgres de dev |
| Sessão carrega `orgId`+`platformRole`; login resolve org | PASS | `session-token.ts`, `actions/auth.ts` |
| Nenhuma query/action roda sem o helper de escopo | FAIL | vários arquivos listados em "O que falta" ainda usam `prisma` cru |
| Testes de vazamento cross-tenant por domínio | FAIL | não escritos neste ciclo |
| `platform_admin` só acessa cross-tenant via caminho explícito | PARTIAL | `admin-prisma.ts` existe e não é usado em nenhum lugar ainda (nem por engano, nem de propósito — SPEC-031/032 não implementadas) |
| Cron respeita `Organization.status` | PASS | `run-tick.ts` itera só orgs `active` |
| Contrato `/api/mobile/v1` sem quebra | FAIL (risco confirmado) | `role` do login mobile mudou de valor; testes mobile ainda quebrados por fixtures |
| build/lint/typecheck/testes OK | PARTIAL | lint/typecheck 100% limpos em produção; testes: 755 passando/55 falhando/303 puladas |

### Arquivos principais criados/alterados
Schema/migrations: `prisma/schema.prisma`, `prisma/migrations/20260925100000_multi_tenant_orgs_structure/`,
`.../20260925100100_multi_tenant_orgs_notnull/`, `.../20260925120000_scheduler_run_org_nullable/`,
`src/scripts/backfill-org.ts`, `prisma/seed.ts`. Auth: `src/lib/auth/session-token.ts`, `session.ts`,
`require-user.ts`, `require-admin.ts`, `test-helpers.ts`. Policy layer: `src/lib/tenant/scoped-prisma.ts`,
`src/lib/tenant/admin-prisma.ts`. Scheduler: `src/lib/scheduler/run-tick.ts`. Domínio: `src/lib/domain/
suppression.ts`, `sequence-start.ts`, `whatsapp-inbound.ts`. Integrações/providers: `src/lib/integrations/
config.ts`, `test-connection.ts`, `src/lib/whatsapp/provider.ts`, `webhook-handler.ts`, `src/lib/agents/
provider.ts`, `queue.ts`, `run-agent.ts`, `simulate.ts`. Queries/actions: ver listas acima. Testes:
`src/lib/test-utils/meeting-fixture.ts`.

### Próximo passo recomendado
Não marcar `IMPLEMENTED`. Continuar nesta mesma SPEC-030 (não abrir uma nova) para: (1) migrar os arquivos
listados em "O que falta"; (2) escrever os testes de vazamento cross-tenant por domínio (critério obrigatório);
(3) corrigir os 55 testes falhando (a maioria é mecânica: trocar fixtures para incluir `orgId`/`Organization`
e atualizar os testes estáticos de auth para aceitar `requireProviderOrg`/`requirePlatformAdmin` como prova de
autenticação); (4) decidir com o usuário o que fazer com a quebra de contrato do `role` no login mobile antes
de considerar isso resolvido.

### Rodada 2 (entre 2026-09-25 e 2026-09-26) — migração do restante do domínio + correção dos testes

O agente desta rodada caiu em rate limit antes de reportar; não existe relatório original dela. O texto
abaixo é reconstruído por INSPEÇÃO DIRETA do código/testes no início da 3ª rodada (grep, leitura de arquivo,
`npm test`), não uma transcrição — por isso é mais curto e não tem números exatos de "antes/depois" por
commit. O que se pôde confirmar que a 2ª rodada entregou, comparado ao estado da Rodada 1:

- **Migração completa (confirmada) dos itens listados como pendentes na Rodada 1**: `src/lib/actions/pipeline.ts`,
  `meeting-search.ts`, `whatsapp-health.ts`, `src/lib/queries/dashboard.ts`, `queries/meetings.ts`,
  `queries/pipeline.ts` — todos usando `requireProviderOrg()`/`scopedPrisma(orgId)` no início da 3ª rodada
  (única exceção residual: `src/lib/actions/meeting.ts` ainda tinha 2 chamadas de `prisma.meetingSettings`
  cru com `where:{orgId}` explícito — não era vazamento, só inconsistência de estilo; corrigido na Rodada 3).
- **Todas as rotas `/api/mobile/v1/**` de negócio** (exceto `alerts/*`, corrigidas na Rodada 3) já resolviam
  `orgId` via `src/lib/mobile/org.ts` (`resolveOrgId(userId)`, por `Membership`) — `campaigns`, `drafts`,
  `pipeline`, `scheduler`, `summary`, `whatsapp/instances`, `agents/queue`, `lead-search/runs` confirmados.
  `src/lib/mobile/actions.ts` (ações leves: kill switch, pausar/retomar campanha, aprovar/rejeitar draft,
  assumir handoff) também resolve `orgId` e escopa corretamente (cobertas por
  `src/lib/tenant/cross-tenant-leak.test.ts`, describe "agentes").
- **`src/lib/mobile/meeting-reminders.ts`**: `MeetingSettings` deixou de ser singleton global (Rodada 1) —
  a Rodada 2 corrigiu a varredura de lembretes para resolver a config POR org da reunião (`campaign.orgId`),
  em vez de um único `where:{id:"global"}` que nunca mais batia (regressão real, corrigida).
- **Suíte de testes**: a Rodada 1 fechou com 755 passando / 55 falhando / 303 puladas. No início da Rodada 3
  a suíte estava em **1139 passando / 0 falhando** (confirmado por `npm test` antes de qualquer edição desta
  rodada) — ou seja, a Rodada 2 corrigiu as 55 falhas herdadas (fixtures sem `orgId`/`Organization`, testes
  estáticos de auth desatualizados para `requireProviderOrg`) e ainda adicionou testes novos (o total de
  1139 é maior que os 1113 da Rodada 1, incluindo o arquivo `src/lib/tenant/cross-tenant-leak.test.ts` e
  `src/lib/test-utils/org-fixture.ts`, que não existiam na Rodada 1).
- **`src/lib/tenant/cross-tenant-leak.test.ts` (achado real corrigido pela própria Rodada 2, documentado no
  arquivo)**: durante a escrita dos testes de vazamento, a Rodada 2 encontrou que `dispatchDraft`/`rejectDraft`/
  `stopAgentOnManualReply` (usados por `approveDraft`/`rejectDraftAction`/`takeOverLead`) não checavam a org
  do draft/lead antes de agir — corrigido na própria rodada (ver describe "agentes" nesse arquivo de teste).
- **Lint/typecheck**: confirmados limpos (`npm run lint`, `npx tsc --noEmit`) no início da Rodada 3, antes de
  qualquer edição — logo, também entregues/mantidos pela Rodada 2.

O que a Rodada 2 **não** cobriu (confirmado no início da Rodada 3, ver "O que falta" da Rodada 1 replicado
aqui porque continuava valendo): o vazamento cross-tenant real do `MobileAlert` (sem `orgId` nenhum) e a
falta de teste de vazamento para o domínio "integrações". Ambos endereçados na Rodada 3 abaixo.

### Rodada 3 (2026-09-26) — vazamento do `MobileAlert`, testes de vazamento restantes, achado novo não resolvido

**Ponto de partida verificado antes de qualquer edição**: `npm test` 1139/1139 passando, 0 falhando;
`npm run lint` e `npx tsc --noEmit` limpos (confirma o que a Rodada 2 entregou, acima).

**1) Vazamento cross-tenant real do `MobileAlert` — CORRIGIDO.** O model não tinha `orgId`: qualquer usuário
mobile autenticado (e qualquer usuário web logado, via `/api/notifications/*`, que lê o MESMO model) lia e
marcava como lido alertas de TODAS as organizações. Correção:
- Schema: `MobileAlert.orgId` (obrigatório, FK `Organization`, `onDelete: Cascade`) + índices
  `[orgId,createdAt,id]`/`[orgId,kind,resolvedAt]`. Migrations: `prisma/migrations/
  20260926025922_mobile_alert_org_structure/` (coluna nullable + índices + FK) e `.../
  20260926030011_mobile_alert_org_notnull/` (NOT NULL). Entre as duas, `src/scripts/backfill-org.ts` ganhou
  um passo novo: apaga as linhas pré-existentes de `MobileAlert` (só 2, no Postgres de dev: a sentinela de
  baseline e um `scheduler_stale` antigo — nenhuma tem como resolver org de forma segura, e ambas são estado
  DERIVADO/efêmero, sempre recriado pela próxima varredura — nunca dado de negócio do usuário). Decisão
  documentada no próprio script: apagar em vez de inventar uma org "default" para essas linhas, porque
  inventar seria repetir o mesmo tipo de erro que este backfill existe para corrigir.
- **A criação também foi corrigida, não só a leitura** (como pedido): `src/lib/mobile/alerts.ts` — a
  varredura (`sweepAlerts`) deixou de ser uma única passada global e agora roda 1x por `Organization` ATIVA
  (`collectForOrg(orgId, now)`, mesmo padrão do `run-tick.ts`). Cada tipo de alerta resolve a org do evento:
  `wa_disconnected`/`wa_paused` via `WhatsAppInstance.orgId`; `handoff` via `Lead.campaign.orgId`;
  `budget_alert`/`budget_exhausted` por org (o bucket "global" virou um bucket por org, contra o teto de
  `AgentSettings` DAQUELA org — antes de existir `orgId` em `AgentSettings`/`Agent`, esse bucket já estava
  quebrado silenciosamente, porque comparava contra um `AgentSettings.findUnique({where:{id:"global"}})` que
  não existe mais desde a Rodada 1; agora usa `AgentSettings.findUnique({where:{orgId}})` corretamente);
  `scheduler_stale` via `SchedulerRun.orgId` (1 checagem por org, não uma checagem global — mais correto:
  antes, uma org ativa mascarava a inatividade de outra); `mass_opt_out`/`lead_replied` (antes agregados
  globalmente) agora contam só supressões/touches DAQUELA org. `src/lib/mobile/meeting-reminders.ts`
  (`collectMeetingReminders`) passou a receber `orgId` e filtrar reuniões por `campaign.orgId`. A sentinela
  de baseline (`ensureBaseline`) também é por org (`baselineKey(orgId)` — dedupeKey global-único carrega o
  orgId, já que `MobileAlert.dedupeKey` continua `@unique` sem escopo de org).
- **Os 4 endpoints `/api/mobile/v1/alerts/**` corrigidos**: passaram a resolver `orgId` via
  `resolveOrgId(a.userId)` (mesmo padrão de `campaigns`/`drafts`) e filtrar/escopar toda leitura/escrita por
  ele; `403 forbidden` se o usuário não tiver org (platform_admin). `POST /{id}/read` agora devolve 404 para
  id de alerta de outra org (nunca revela que existe).
- **Achado adicional durante a correção (mesma vulnerabilidade, consumidor diferente do mesmo model)**: as
  rotas web `/api/notifications/**` (SPEC-028, sessão de cookie, não Bearer mobile) leem/escrevem o MESMO
  `MobileAlert` e tinham o MESMO vazamento — qualquer provider logado no painel via sessão via alertas de
  qualquer organização. Corrigidas junto (mesmo padrão: `requireSession()` já devolve `orgId` da sessão,
  sem precisar de `resolveOrgId`; `403` se `orgId` nulo). `getNotificationSummary(orgId)` também passou a
  filtrar `Draft` pendentes (aba "aprovações") por `lead.campaign.orgId`.
- **`src/lib/actions/meeting.ts`**: as 2 chamadas residuais a `prisma.meetingSettings` cru (inconsistência
  de estilo apontada no pedido, não vazamento — já tinham `where:{orgId}` explícito) migradas para
  `scopedPrisma(orgId).meetingSettings`.

**2) Testes de vazamento cross-tenant por domínio — completados.** `src/lib/tenant/cross-tenant-leak.test.ts`
(criado pela Rodada 2) já cobria campanhas, leads, sequences/templates, whatsapp, email, agentes, supressão,
pipeline/reuniões, dashboard e scheduler com 2 `Organization`s + IDs adivinhados. Faltavam "integrações" e
o `MobileAlert` (que na Rodada 2 nem tinha `orgId` para testar). Adicionados nesta rodada:
- `describe("integrações — vazamento cross-tenant")`: `saveIntegration`/`testIntegration`/`removeIntegration`/
  `listIntegrations`/`listIntegrationAudit` com secret criado pela org A, acessado pela org B (id adivinhado)
  — confirma 404/lista vazia/nenhuma alteração no dado real.
- `describe("MobileAlert — vazamento cross-tenant")`: 2 dispositivos mobile (org A e org B), alerta criado
  para a org A; confirma que `GET /alerts`, `GET /unread-count`, `POST /{id}/read` (404) e `POST /read-all`
  da org B nunca veem/tocam o alerta da org A, e que `sweepAlerts()` nunca cria alerta cruzando org.
- `src/app/api/notifications/notifications.test.ts`: novo `describe("vazamento cross-tenant")` com uma 2ª
  `Organization` (via `mkMeetingFixture`), confirmando o mesmo para as rotas de sessão web.
- Suíte completa após as adições: **1146 passando / 0 falhando** (1139 + 7 testes novos: 2 em integrações,
  4 em MobileAlert via Bearer, 1 em notifications via sessão web). `npm run lint`, `npx tsc --noEmit` e
  `npm run build` limpos.

**3) Achado NOVO desta rodada, NÃO corrigido — motivo de continuar `IN_PROGRESS`.** Durante a auditoria dos
domínios "reuniões/notificações" (pedida explicitamente no ciclo 2 desta rodada), foi encontrado que
`POST /api/integrations/meetings` (`src/lib/meetings/webhook.ts`, SPEC-028) e, por herança de design,
`POST /api/integrations/leads` (SPEC-014) autenticam com um **único segredo global** (`INGEST_SECRET`, 1
para a plataforma inteira — não há segredo por org). O endpoint de leads é seguro porque o `campaignId` vem
explícito no payload e a org é resolvida A PARTIR dele (`Campaign.orgId`) antes de qualquer efeito — não há
ambiguidade. **O endpoint de reuniões não é seguro**: quando o payload não traz `leadId` explícito, ele busca
o lead por telefone com `prisma.lead.findMany({ where: { phone: { in: [...] } } })` **sem nenhum filtro de
`orgId`** — se dois tenants diferentes tiverem um lead com o mesmo telefone, o webhook pode resolver o lead
da org ERRADA. Mesmo quando `leadId` vem explícito, `prisma.lead.findUnique({ where: { id: leadId } })`
também não filtra por org, e `createMeeting()` (`src/lib/domain/meeting.ts`) só valida
`opp.campaign.orgId === p.orgId` **quando `p.orgId` é passado** — o webhook nunca passa `orgId` (ele não
tem como saber qual org é, dado o segredo global), então essa validação é pulada inteiramente. Ou seja: quem
tiver o `INGEST_SECRET` (pensado originalmente, SPEC-014/028, para 1 integrador por instalação, não por
tenant) pode criar reuniões em oportunidades de QUALQUER organização, adivinhando um `leadId` (UUID) ou
acertando um telefone que também exista como lead em outro tenant.
- **Por que não foi corrigido nesta rodada**: a correção correta é uma decisão de produto/arquitetura, não
  um "esqueceu o where" — options plausíveis (não avaliadas a fundo, só citadas): (a) segredo de ingestão
  por-org (mudaria o contrato do endpoint, que hoje é 1 segredo/instalação, para exigir identificar a org na
  request); (b) exigir sempre `campaignId`/`opportunityId` explícito no payload do webhook de reuniões (como
  já é o caso do de leads) em vez de aceitar busca por telefone sem escopo; (c) alguma outra amarração
  (webhook por org com token próprio, tabela de mapeamento telefone->org por integração). Implementar
  qualquer uma dessas sem aprovação seria inventar regra de negócio/contrato de API nova — parei aqui e
  reporto como achado, não como resolvido.
- **Nenhum código foi alterado para este achado.** Nenhum teste de vazamento foi escrito para ele (escrever
  o teste é fácil; a correção real depende da decisão acima, e um teste "vermelho" permanente não parecia
  ajudar mais que este registro explícito).
- **Este achado é DIFERENTE do risco já sinalizado do contrato mobile** (`role` em `/api/mobile/v1/auth/*`,
  que o usuário já decidiu tratar como "documentar e aguardar decisão", não bloqueante para `IMPLEMENTED`).
  Este é um vazamento cross-tenant real e ainda ativo em código de produção, dentro do critério de aceite
  "nenhuma query roda sem o helper de escopo" — por isso MANTÉM a SPEC em `IN_PROGRESS`.

### Critérios de aceitação — estado ATUAL (fim da Rodada 3, 2026-09-26)

| Critério | Status | Evidência |
|---|---|---|
| `Organization`/`Membership` no schema, migration + backfill | PASS | Rodada 1 (inalterado) |
| Sessão carrega `orgId`+`platformRole`; login resolve org | PASS | Rodada 1 (inalterado) |
| Nenhuma query/action de domínio de negócio roda sem passar pelo helper de escopo | **FAIL** | quase todo o domínio migrado (Rodadas 1-3, incl. `MobileAlert`/`api/notifications`/`api/mobile/v1/alerts` nesta rodada) — MAS `POST /api/integrations/meetings` continua sem escopo de org (achado novo desta rodada, não corrigido, ver acima) |
| Testes de vazamento cross-tenant cobrindo cada domínio da seção 3, todos passando | PASS | `src/lib/tenant/cross-tenant-leak.test.ts` (campanhas, leads, sequences/templates, whatsapp, email, agentes, supressão, pipeline/reuniões, dashboard, scheduler, integrações, MobileAlert) + `notifications.test.ts` (web) — todos verdes; nenhum teste cobre o achado de `integrations/meetings` (não corrigido, ver acima) |
| `platform_admin` só roda cross-tenant pelo caminho explícito (`admin-prisma`) | PASS | testado em `cross-tenant-leak.test.ts` ("adminPrisma... só ele, nunca scopedPrisma") |
| Cron respeita `Organization.status` | PASS | Rodada 1 (inalterado) |
| Contrato `/api/mobile/v1` sem quebra | FAIL (risco sinalizado, NÃO bloqueante — decisão do usuário pendente, não mexer sem pedido) | `role` do login/`/auth/me` mobile continua `"provider"`/`"platform_admin"` em vez de `"admin"`/`"member"` |
| build/lint/typecheck/testes OK | PASS | `npm run lint` limpo; `npx tsc --noEmit` limpo; `npm run build` conclui; `npm test` 1146 passando / 0 falhando / 0 pulados |

**Por que a SPEC continua `IN_PROGRESS` e não `IMPLEMENTED`**: só o critério do contrato mobile (`role`) está
em FAIL por decisão explícita do usuário de não bloquear nisso. Mas o critério "nenhuma query roda sem o
helper de escopo" tem um FAIL adicional, real e não coberto por essa decisão: `/api/integrations/meetings`
(achado nesta rodada). Por instrução explícita, nenhuma correção de contrato/arquitetura foi inventada para
esse achado sem aprovação — então o critério permanece FAIL de fato, e a SPEC não pode ser marcada
`IMPLEMENTED` enquanto ele não for corrigido (ou o usuário decidir formalmente tratá-lo como risco sinalizado
não-bloqueante, do mesmo jeito que já decidiu para o `role` mobile).

### Próximo passo recomendado (fim da Rodada 3)
Não marcar `IMPLEMENTED`. Antes de prosseguir para as SPECs 031-035 (que dependem desta): (1) o usuário decide
o que fazer com `POST /api/integrations/meetings` (segredo por-org? exigir `campaignId`/`opportunityId`
explícito no payload em vez de busca por telefone sem escopo? outra amarração?) — a implementação segue depois
dessa decisão, dentro desta mesma SPEC-030; (2) só então reavaliar `IMPLEMENTED`, junto com a decisão pendente
(separada) do `role` no contrato mobile.

### Arquivos alterados/criados nesta rodada (3ª rodada, 2026-09-26)
Schema/migration: `prisma/schema.prisma` (`MobileAlert.orgId`), `prisma/migrations/
20260926025922_mobile_alert_org_structure/`, `.../20260926030011_mobile_alert_org_notnull/`,
`src/scripts/backfill-org.ts` (passo 15, apaga `MobileAlert` pré-existente). Domínio de alertas:
`src/lib/mobile/alerts.ts`, `src/lib/mobile/meeting-reminders.ts`. Rotas: `src/app/api/mobile/v1/alerts/
route.ts`, `.../unread-count/route.ts`, `.../read-all/route.ts`, `.../[id]/read/route.ts`,
`src/app/api/notifications/route.ts`, `.../summary/route.ts`, `.../read-all/route.ts`, `.../[id]/read/
route.ts`, `src/lib/notifications/summary.ts`, `src/app/(app)/layout.tsx` (ajuste de assinatura). Estilo/
consistência: `src/lib/actions/meeting.ts` (2 chamadas para `scopedPrisma`), `src/lib/tenant/
scoped-prisma.ts` (comentário atualizado). Testes: `src/lib/tenant/cross-tenant-leak.test.ts` (+integrações,
+MobileAlert), `src/app/api/notifications/notifications.test.ts` (+vazamento cross-tenant), `src/lib/mobile/
alerts.test.ts`, `src/lib/mobile/meeting-reminders.test.ts`, `src/lib/mobile/actions.test.ts`,
`src/lib/domain/meeting.test.ts` (fixtures atualizadas para `orgId` obrigatório em `MobileAlert`).
