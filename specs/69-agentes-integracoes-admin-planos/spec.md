# SPEC-069 — Agentes e integrações configurados pelo admin + funcionalidades por plano (Free, Starter, Pro)
- status: **IN_PROGRESS (069a backend IMPLEMENTADA e com QA aprovado; 069b backend IMPLEMENTADA em 2026-10-13, aguardando QA; 069c/d/e pendentes)** (aprovada em 2026-10-12, recomendações aceitas) | domain: fullstack (069a-e; `## Backend` e `## Frontend`) | criada em 2026-10-12 | depende de: 018 (integrações), 019 (agentes), 030 (multi-tenant/ReBAC), 031/032 (admin), 033/047/063 (planos/billing), 036 (LLM), 041 (fontes de lead), 058/060 (busca), 065 (limites e trial; **fonte dos limites**), 066 (assinatura), 067 (toasts), 068 (caixa de atendimento) | altera: 019/018 (quem configura), 065 (amplia `Plan.limits`) | tambem toca: 035 (landing/comparativo), 051 (criativos), 049 (equipe)
- **Origem:** pedido literal do usuário (2026-10-12): "Fazer no projeto LeadForge a questão de agentes e integrações. Essa funcionalidade o admin configura e o tenant só usa. E também precisa limitar os planos pois temos 3 planos: Free, Starter e Pro (fazer as funcionalidades e bloquear funcionalidade para cada plano)". Nenhuma decisão abaixo foi tomada pelo usuário além desse pedido: tudo é **INFERRED** (recomendação) ou pergunta **Q-069-n**. Valores de limites e preços = **PLACEHOLDER**. NENHUM código foi escrito.

## Objetivo
1. **Separar quem configura de quem usa:** o admin da plataforma define e libera, por organização, o que agentes de IA e integrações podem fazer (modelo/LLM, teto de custo, kill switch, integrações disponíveis, chaves da plataforma). O tenant (owner e member) só usa o que o plano e o admin liberaram.
2. **Bloquear por plano:** uma matriz Free | Starter | Pro (Business e courtesy = tudo liberado) aplicada **no servidor**, por um módulo único de permissões (`entitlements`), com UI de bloqueio + upgrade.

## Contexto (conferido no repositório em 2026-10-12)
- **Planos** (`prisma/seed.ts`, `Plan.limits` JSON, valores PLACEHOLDER): `free` (trial 14 dias; 1 campanha, 1 WhatsApp, 1 e-mail, 50 leads, 20 envios/dia), `starter` (R$ 297/mês: 3 campanhas, 1 WhatsApp, 500 leads/mês), `pro` (R$ 697/mês: 10 campanhas, 3 WhatsApp, 3000 leads/mês), `business` e `courtesy` (ilimitados, sem checkout). O seed só atualiza os limites do `free` (`update: {}` nos demais).
- **Limites aplicados hoje** (`src/lib/billing/limits.ts`: `getOrgLimits`, `assertWithinLimit`, `PlanLimitError`/`plan_limit`; `parseLimits` em `plans.ts` só conhece 5 chaves): `maxCampaigns`, `maxWhatsappInstances`, `maxEmailAccounts`, `maxLeadsPerMonth`, `maxSendsPerDay`. `null` = ilimitado; org sem `Subscription` e `courtesy` = ilimitado. **Não existe limite/flag para agentes, integrações, busca de leads, criativos, caixa de atendimento, equipe, sequências.** Starter e Pro não definem `maxEmailAccounts` nem `maxSendsPerDay` (ficam ilimitados: lacuna, ver Q-069-6).
- **Papéis hoje:** `User.role` é de plataforma (`platform_admin` | `provider`); dentro da org, `OrgRole = owner | member` (não existe admin de organização). Guards em `src/lib/auth/require-admin.ts`: `requireProviderOrg`, `requireActiveProviderOrg`, `requireOrgOwner`, `requirePlatformAdmin`.
- **Agentes** (SPEC-019): `Agent` (papéis `sdr | followup | closer`, `active`, `autonomy`, `monthlyBudgetCents`, `dailyMessageLimit`, `maxTurnsPerLead`, `allowedTools`, `disclosureEnabled`, `model`, `autoConfirmedAt`...), `AgentSettings` (por org: `killSwitch` padrão `true`, `monthlyBudgetCents`), `AgentRun`, `Draft`. Server actions em `src/lib/actions/agent.ts` (createAgent, updateAgent, setAgentActive, setAgentAutonomy, updateAgentSettings, saveKnowledge, deleteKnowledge, simulateAgentAction, getAgentUsage/Runs, approveDraft, rejectDraftAction, bulkApproveFollowups, takeOverLead). Tela `configuracoes/agentes/page.tsx` bloqueia quando `platformRole !== "provider"` com "Somente administradores configuram os agentes": **na prática hoje quem configura é o próprio tenant (provider) e quem é bloqueado é o `platform_admin`.** Os agentes rodam **dentro do app** (tick: `run-agent.ts`/`advance.ts`); o n8n não executa agentes.
- **Integrações** (SPEC-018, `IntegrationSecret` por org; `IntegrationKind`: `evolution`, `n8n`, `llm`, `places`, `google_ads_leads`, `meta_leads`): actions `saveIntegration`/`removeIntegration`/`testIntegration` (`src/lib/actions/integration.ts`), tela `configuracoes/integracoes`. Segredo criptografado com `ENCRYPTION_KEY`; a UI só mostra `hint` (4 últimos caracteres). SPEC-036: o tenant hoje cadastra o próprio provedor LLM (URL base, chave).
- **Admin** (`src/app/(app)/admin/organizacoes`, `src/lib/actions/admin/organizations.ts`): listar/suspender/reativar; **não há** tela de configuração de agentes/integrações/plano por organização, nem override manual.
- **Já travam hoje:** trial expirado (`redirectIfTrialExpired`, `resolveOrgAccess`, `AllowExpired`) e os 5 limites acima. Padrões de teste de cobertura: `*-auth-coverage.test.ts`, `trial-guard-coverage.test.ts`, `provider-user-coverage.test.ts`.
- **Cuidados do projeto:** migrations aditivas escritas à mão, nunca `prisma migrate dev`; push na `main` publica na Vercel (migrations rodam no build); downgrade **não retroage** (D-065); erros tipados via `handleActionError` (`code:["plan_limit"]`) + `notifyActionError` (SPEC-067).

## Escopo
- Módulo único `src/lib/billing/entitlements.ts` (estende `limits.ts`) com catálogo de features, matriz por plano, override por organização e guards de servidor.
- Aplicação em todas as entradas de servidor: actions, route handlers, tick, webhooks (agentes, integrações, busca, caixa, criativos, equipe, sequências).
- Admin (`/admin`): configuração por organização (agentes liberados, teto de custo, kill switch, modelo, integrações disponíveis, chaves da plataforma), override de plano/feature com validade, auditoria.
- UI do tenant: bloqueio com explicação + upgrade, medidores de uso, comparativo de planos gerado da mesma fonte.

## Fora do escopo
- Mudar preços ou mecânica de cobrança (033/047/063/066). Valores dos planos seguem PLACEHOLDER, só ficam num lugar editável.
- Novos provedores de LLM/avatar; novo papel "admin da organização" (ver Q-069-1, opção B); app móvel; n8n executando agentes.
- Apagar dados no downgrade (nunca retroage).
- Parecer jurídico (LGPD/consentimento) sobre agentes autônomos.

## Decisões (todas INFERRED até aprovação; as bloqueantes viram Q-069-n)
- **D-069-1 (INFERRED, Q-069-1):** "admin" = `platform_admin` (painel `/admin`). O tenant (owner e member) **usa**; não configura.
- **D-069-2 (INFERRED):** o admin configura **política** (o que pode e quanto pode gastar); o tenant preenche **conteúdo** de uso (persona, objetivo, tom, base de conhecimento, aprovar rascunhos). Assim o admin não precisa ler dados operacionais dos clientes (conversas/leads), mantendo a regra do `platform_admin` sem acesso operacional.
- **D-069-3 (INFERRED):** **proibido** `plan.key === "pro"` fora do módulo; toda checagem recebe `orgId`: `assertFeature(db, orgId, "agents.role.closer")`, `assertWithinLimit(...)`, `getEntitlements(db, orgId)`.
- **D-069-4 (INFERRED):** sem migration para a matriz: chaves novas **opcionais** em `Plan.limits` (JSON) + `features` (catálogo); ausente/`null` = ilimitado/permitido **só para chaves numéricas já existentes**; para chaves novas, ausente = **fail-closed** nas features que custam dinheiro/risco (IA, envio) — ver D-069-9. **Uma migration aditiva mínima** para o override por org (`OrgEntitlementOverride`) — Q-069-7.
- **D-069-5 (INFERRED):** os valores ficam num **único lugar editável**: `PLAN_SEED` (`prisma/seed.ts`) / catálogo `src/lib/billing/plan-catalog.ts`. Mudar um número não exige mudar código. O seed passa a atualizar `limits` dos 5 planos de forma idempotente — Q-069-8 (afeta assinantes atuais).
- **D-069-6 (INFERRED):** downgrade/expiração **não apaga**: o que excede fica **pausado/somente leitura** com aviso; upgrade reativa sem perda (configuração preservada).
- **D-069-7 (INFERRED, Q-069-2):** custo de IA é da **plataforma**; BYOK desligado por padrão (feature `llm.byok`, liberada só por override/Business).
- **D-069-8 (INFERRED):** segredos nunca são exibidos ao tenant (só `hint`); nunca em log, auditoria ou erro.
- **D-069-9 (INFERRED, Q-069-5):** plano desconhecido, assinatura ausente por falha, ou erro ao ler o plano: **fail-closed** em IA e envio (custam dinheiro/risco); **fail-open só em leitura**. Org sem `Subscription` por design (admin/seed) e `courtesy` = tudo liberado (D-065-25, preservado).
- **D-069-10 (INFERRED):** estados: `trialing`/`active` = plano vale; `past_due` dentro do grace (7 dias, D-33-3) = plano vale mas **IA/envio automático pausam** (recomendado, evita custo sem pagamento) — Q-069-9; `canceled`/expirado = bloqueio total já existente (065).

## Requisitos funcionais

### A. Quem faz o quê (ação por ação; recomendação)
| Ação | platform_admin | owner | member | Observação |
|---|---|---|---|---|
| Liberar/bloquear papéis de agente (sdr/followup/closer) e nº de agentes por org | **sim** | ver | ver | dentro do teto do plano, ou override |
| Teto de custo mensal de IA, mensagens/dia, turnos máx, modelo, kill switch global da org | **sim** | só ver (uso/consumo) | só ver | hoje o tenant edita; passa a somente leitura |
| Kill switch de EMERGÊNCIA do tenant (pausar tudo) | sim | **sim** (só pode LIGAR; desligar o kill switch exige admin quando o admin o travou) | não | segurança operacional; Q-069-3 |
| Criar/editar persona, objetivo, tom, base de conhecimento, aviso de IA | não (não lê conteúdo) | **sim** | não | conteúdo do cliente |
| Ligar/desligar um agente permitido | não | **sim** | não | só se plano/admin permitem e há teto definido |
| Mudar autonomia (rascunho/auto) | define o TETO | escolhe até o teto | não | Closer em auto segue exigindo confirmação explícita (`autoConfirmedAt`) |
| Simular, ver uso/execuções | não | sim | sim (leitura) | |
| Aprovar/rejeitar rascunhos, bulk approve, assumir lead | não | sim | sim | já é o uso; vale o plano (Free não tem rascunhos novos) |
| Integração LLM (provedor/modelo/chave) | **sim** (chave da plataforma, ou da org via override) | **removido** (BYOK desligado) | não | Q-069-2 |
| Integração Places (busca de leads) | **sim** (chave da plataforma) | usa a busca (limite do plano) | usa | |
| Integração Evolution (servidor/URL/chave) | **sim** | **só pareia o próprio número** (QR) e vê status | vê | pareamento = uso, limite `maxWhatsappInstances` |
| Integração n8n (token de ingestão) | **sim** libera; | gera/gira o próprio token se liberada (Pro) | não | Q-069-4 |
| Fontes de lead Google Ads/Meta (vínculo campanha↔formulário) | libera | **configura o vínculo** se liberada (Pro) | não | o segredo de assinatura é do tenant na 041; Q-069-4 |
| Ver/editar plano, override, validade, auditoria | **sim** | só vê o próprio plano | só vê | |

### B. Matriz de funcionalidades por plano (proposta; PLACEHOLDER; Q-069-4)
Business e courtesy = **tudo liberado** (override por org prevalece sobre o plano). Free = trial de 14 dias.

| Funcionalidade (chave) | Free | Starter | Pro |
|---|---|---|---|
| Agentes de IA: papéis (`agents.roles`) | nenhum | `followup` | `sdr`, `followup`, `closer` |
| Agentes ativos ao mesmo tempo (`maxActiveAgents`) | 0 | 1 | 3 |
| Autonomia (`agents.autonomy`) | n/a | só rascunho (aprovação humana) | rascunho + amostragem + auto (Closer auto exige confirmação) |
| Teto de custo de IA/mês, por org (`maxAiBudgetCentsMonth`) | 0 | R$ 50 | R$ 200 |
| Mensagens/dia por agente (`maxAgentMessagesPerDay`) | 0 | 20 | 100 |
| Ao estourar o teto | n/a | agente **pausa** + aviso ao owner + CTA upgrade | idem + aviso aos 80% |
| WhatsApp Evolution: números (`maxWhatsappInstances`, existe) | 1 | 1 | 3 |
| Contas de e-mail (`maxEmailAccounts`, existe) | 1 | 1 | 3 |
| Envios/dia (`maxSendsPerDay`, existe; hoje ilimitado nos pagos) | 20 | 300 | 1000 |
| Campanhas ativas / leads por mês (existem) | 1 / 50 | 3 / 500 | 10 / 3000 |
| LLM próprio BYOK (`llm.byok`) | não | não | não (só override/Business) |
| Busca de leads Places (`maxLeadSearchesPerDay`; reusa teto da 058) | 2 | 10 | 30 |
| Fontes Google Ads Lead Form / Meta Lead Ads (`sources.ads`) | não | não | **sim** |
| n8n / ingestão externa por API (`ingest.api`) | não | não | **sim** |
| Caixa de atendimento WhatsApp (`inbox`) | **só leitura** | leitura + resposta de texto | + anexos (068c/d) + etiquetas (068e) |
| Criativos de vídeo/imagem (`maxCreativesPerMonth`) | 0 | 3 | 20 |
| Equipe: membros (`maxMembers`) | 1 | 3 | 10 |
| Sequências: passos por sequência (`maxSequenceSteps`) | 3 | 5 | ilimitado |
| Templates, calendário/reuniões | liberados | liberados | liberados |

### C. Aplicação no servidor (obrigatória; esconder na UI não basta)
- Toda Server Action, Route Handler, job do tick e webhook que use agentes/integrações/busca/criativos/caixa/equipe chama o módulo `entitlements` **no servidor**, dentro da transação com `lockOrg` quando há contagem. Erros tipados: `plan_limit` (numéricos) e novo **`plan_feature_locked`** (features) com `feature`, `requiredPlan` e mensagem PT-BR com o nome do plano ("Disponível no plano Pro"), sem vazar dado de outra org.
- **Defesa em profundidade:** `run-agent.ts`/`advance.ts`, o envio automático e o runner de criativos **recusam executar** se o plano/override não permite (downgrade, plano expirado, `past_due`), **sem apagar configuração**; o motivo fica em `AgentRun`/log sem segredos.
- Downgrade por funcionalidade: agentes acima do novo limite ficam `active=false` com motivo "plano" (reativam no upgrade); inbox cai para leitura; criativos existentes ficam visíveis (só barra novos); membros acima do limite continuam, mas não se convida mais; fontes de lead/n8n param de **ingerir** (webhook responde 403 `plan_feature_locked`, configuração preservada).
- Bordas: sem assinatura (admin/seed), `courtesy`, `business` = liberado; plano desconhecido = fail-closed (D-069-9); `past_due`/`canceled` = D-069-10.

### D. Admin (`/admin/organizacoes/[id]`, SPEC-031/032)
- Aba "Agentes e IA": papéis liberados, nº de agentes, teto de custo, mensagens/dia, modelo, kill switch (travado pelo admin), autonomia máxima.
- Aba "Integrações": quais integrações a org pode usar; chaves da plataforma (LLM, Places, Evolution) com `hint`.
- Aba "Plano e features": plano atual, **override** por feature/limite com **motivo** e **validade opcional** (cliente piloto), mostrando efetivo = plano + override.
- Auditoria: `PlatformAuditLog` (ação do admin) e `OrgAuditLog` (efeito na org) para toda mudança, **sem segredos**. Somente `platform_admin`; **sem acesso a leads/conversas** (cross-tenant só por `admin-prisma.ts`, campos de política).

### E. UI do tenant (frontend)
- Tudo que o plano não inclui aparece **bloqueado com explicação** ("Disponível no plano Pro") e botão "Fazer upgrade" (`/configuracoes/assinatura`); nunca some em silêncio nem mostra erro genérico. `aria-disabled` com motivo legível por leitor de tela, foco visível, alvos ≥ 44 px, responsivo 390/1280 px, claro/escuro.
- `configuracoes/agentes`: owner edita conteúdo (persona etc.), campos de política em somente leitura com legenda "Definido pela plataforma"; `configuracoes/integracoes`: remove cadastro de chaves do tenant (LLM/Places/Evolution servidor), mantém pareamento de número, vínculos de fontes/n8n quando liberados.
- `UsageMeter`/assinatura: passa a mostrar uso de IA (R$ do mês e mensagens), agentes ativos, membros, criativos e os recursos incluídos. **Comparativo de planos** (assinatura + landing) gerado do mesmo catálogo (`plan-catalog.ts`), sem texto duplicado.
- Erros via `notifyActionError` (alinhar com SPEC-067): `plan_feature_locked` ganha entrada no catálogo código→mensagem→CTA.

## Requisitos não funcionais
- Uma única fonte de verdade das permissões; `getEntitlements` cacheável por request (sem cache entre requests, para o upgrade valer na hora).
- Sem N+1 no tick (resolver entitlements por org uma vez por lote).
- Valores PLACEHOLDER num único arquivo/seed; documentar no README/RETOMAR.
- Relógio injetado (testes) para validade de override e janelas.

## Modelo de dados
- **Sem migration para a matriz:** chaves novas em `Plan.limits` JSON; `parseLimits` ampliado (todas opcionais) + `features` (objeto) parseado com defaults seguros (D-069-4/9).
- **Migration aditiva, escrita à mão (Q-069-7):** `OrgEntitlementOverride { id, orgId @unique, features Json, limits Json, reason, expiresAt?, createdBy, createdAt, updatedAt }` (Cascade na org). Opcional: `AgentSettings.lockedByAdmin Boolean @default(false)` para o kill switch travado (Q-069-3). Nada destrutivo; aplicada pelo usuário com `migrate deploy`; nunca `migrate dev`.
- Seed: `PLAN_SEED` ampliado; atualização idempotente dos limites dos planos (Q-069-8).

## Contrato / arquivos esperados
- `src/lib/billing/entitlements.ts` (+ `entitlements.test.ts`), `src/lib/billing/plan-catalog.ts`, ajustes em `limits.ts`, `plans.ts` (`parseLimits`/`parseFeatures`), `prisma/seed.ts`.
- Guards nas actions: `src/lib/actions/{agent,integration,lead-search,lead-source,creative,inbox,org,sequence}.ts`, route handlers de webhook/ingestão, `src/lib/agents/{run-agent,advance}.ts`, runner de criativos, envio automático.
- Admin: `src/lib/actions/admin/entitlements.ts`, telas em `src/app/(app)/admin/organizacoes/[id]/*`.
- UI: `src/components/billing/*` (bloqueio, medidores, comparativo), `src/components/agents/*`, `src/components/integrations/*`, landing (pricing).
- Testes de cobertura: `entitlements-coverage.test.ts` (falha se surgir action de agente/integração/busca/criativo/caixa sem guard).

## Divisão em etapas (cada uma com QA independente e commit)
- **069a (backend):** módulo `entitlements`, catálogo, matriz no seed, `parseLimits`/`parseFeatures`, erro `plan_feature_locked`, migration do override, testes de unidade/isolamento.
- **069b (backend):** aplicação no servidor (agentes + runner/tick, integrações, busca, fontes/n8n, caixa, criativos, equipe, sequências), downgrade/past_due, testes por plano, teste de cobertura.
- **069c (fullstack):** admin por organização (agentes, integrações, plano/override) + auditoria; tenant passa a somente leitura nos campos de política.
- **069d (frontend):** UI do tenant (bloqueios, upgrade, medidores, comparativo, landing).
- **069e:** revisão final, E2E em navegador, docs (`RETOMAR` seção 0, `ROTEIRO_DE_TESTES`, `PRIMEIROS_PASSOS` em linguagem simples).

## Critérios de aceitação
1. Para cada célula da matriz B existe teste: permitido x bloqueado, com a mensagem certa (nome do plano necessário).
2. Tenant (owner e member) não lê nem edita segredos nem política do admin; só `platform_admin` altera política/override; `platform_admin` não acessa leads/conversas.
3. Free não consegue ativar agente (UI e servidor); Starter só `followup` e só rascunho; Pro até 3 agentes com auto; estouro de teto pausa o agente e avisa.
4. Downgrade não apaga nada; upgrade reativa sem perda; plano desconhecido não executa IA/envio (fail-closed).
5. Mudar um valor em `PLAN_SEED`/catálogo muda o comportamento e o comparativo **sem alterar código** de checagem; nenhum `plan.key === "..."` fora do módulo (teste/ESLint).
6. Auditoria registra quem mudou o quê (sem segredos); override respeita `expiresAt`.
7. UI: bloqueio com explicação e link de upgrade, `aria-disabled` com motivo, 390/1280 px, claro/escuro; erros em toast PT-BR.
8. `tsc`, `eslint` (0 erros) e vitest verdes; `next build` com o dev parado (aviso antes).

## Testes (vitest, banco `*_test` NOVO; relógio injetado)
- Matriz completa **plano × funcionalidade** (Free, Starter, Pro, Business, courtesy, sem assinatura, trial expirado, `past_due`, `canceled`, plano desconhecido).
- **Toda** entrada de servidor tem teste "plano sem permissão é barrado" + teste de cobertura (padrão `*-auth-coverage.test.ts`).
- Isolamento entre orgs A/B/C; tenant sem acesso a segredos/política; admin sem acesso operacional.
- Downgrade não retroage; upgrade reativa; corrida (duas requisições simultâneas no limite) respeita o teto (`lockOrg`).
- Auditoria sem segredos (padrão `log-leak.test.ts`); UI: bloqueio, upgrade, acessibilidade.
- Comando: `PAYMENT_PROVIDER=mock ABACATEPAY_API_KEY= ABACATEPAY_WEBHOOK_SECRET= APP_BASE_URL=http://app.test APP_URL=http://app.test TEST_DATABASE_URL=...` (banco `*_test` novo).

## Segurança
Segredos só criptografados (`ENCRYPTION_KEY`), `hint` na UI, nunca em log/auditoria/erro; guards de servidor em toda entrada (UI não basta); isolamento por `orgId`; rate limit existente mantido (059); fail-closed em IA/envio; sem vazar existência de dado de outra org.

## Riscos
- **Seed e assinantes atuais:** atualizar `limits` dos planos pagos muda o que assinantes existentes podem fazer (Q-069-8).
- **Quebra de fluxo atual:** tenants que hoje configuram agentes/LLM passam a depender do admin (Q-069-1/2); precisa migração de dados e aviso.
- **Custo de IA da plataforma** sem teto bem calibrado (valores PLACEHOLDER).
- **Esquecer um guard** (mitigado pelo teste de cobertura). **Cache** de entitlements causando upgrade atrasado (sem cache entre requests).
- Migration em produção roda no build da Vercel: só aditiva; Preview compartilha o banco (risco D3 do RETOMAR).
- Conflito de nome com `Plan.limits` consumidos por landing/pricing (`PlanView`): ampliar sem quebrar.

## Respostas do usuário (2026-10-12)
- **Q-069-1:** platform_admin em `/admin` configura por organização; tenant (owner e member) só usa. DECIDIDO (recomendação aceita).
- **Q-069-2:** a plataforma paga a IA; BYOK desligado (só por override do admin ou Business). DECIDIDO.
- **Q-069-4:** matriz Free/Starter/Pro aprovada como proposta (valores PLACEHOLDER editáveis num só lugar). DECIDIDO.
- Q-069-3 e Q-069-5..11: ainda sem resposta explícita; seguem a recomendação (sim) até o usuário dizer `APROVAR SPEC-069`.
- **Fora do escopo (opinião do usuário pedida e acordada em conversa):** microserviços e n8n como motor dos agentes; os agentes continuam no tick dentro do app, atrás de um módulo `agent runner`; extrair no máximo um worker único se o tick estourar. n8n só como conector opcional.

## Decisões pendentes (perguntas bloqueantes; recomendação em cada)
- **Q-069-1 (BLOQUEANTE) — quem é o "admin"?** (A) **`platform_admin`** configura política por organização; tenant só usa; (B) novo papel "admin da organização" dentro do tenant; (C) manter como está (owner configura). **Recomendo A**: é o pedido literal, não cria papel novo, e preserva a regra de o admin não ler dados operacionais. Impacto: tenants atuais perdem a edição de política (viram somente leitura).
- **Q-069-2 (BLOQUEANTE) — LLM próprio (BYOK, SPEC-036)?** (A) **custo de IA da plataforma; só admin configura; BYOK desligado (liberável por override/Business)**; (B) BYOK liberado no Pro; (C) BYOK em todos. **Recomendo A**: simples de cobrar e de limitar por plano; o teto de custo vira feature do plano. Impacto: UI do card "Provedor de LLM" sai do tenant.
- **Q-069-3 — kill switch.** Tenant pode LIGAR (emergência) mas só o admin DESLIGA quando travado? **Recomendo sim** (migration opcional `lockedByAdmin`).
- **Q-069-4 (BLOQUEANTE, Q-B1) — matriz da seção B.** Aprovar os valores e as travas (Free sem agentes; Starter 1 agente `followup` em rascunho; Pro 3 agentes/auto; fontes Ads e n8n só Pro; inbox leitura/resposta/anexos; criativos 0/3/20; membros 1/3/10; buscas 2/10/30). **Recomendo aprovar como está** (PLACEHOLDER editável em um lugar).
- **Q-069-5 — fail-closed** em IA/envio para plano desconhecido/erro e fail-open só em leitura? **Recomendo sim.**
- **Q-069-6 — lacuna Starter/Pro** sem `maxEmailAccounts` e `maxSendsPerDay` (hoje ilimitados): fechar com 1/3 contas e 300/1000 envios por dia? **Recomendo sim** (afeta anti-banimento, SPEC-017).
- **Q-069-7 — override por org** com tabela nova `OrgEntitlementOverride` (migration aditiva)? **Recomendo sim**; alternativa sem migration (guardar no `Subscription`/JSON existente) mistura billing com política.
- **Q-069-8 — seed atualiza os limites dos planos pagos** (hoje só o Free) e passa a valer para assinantes atuais? **Recomendo sim**, com `migrate`/seed aplicados por você e aviso antes (não há assinantes reais em produção hoje: produção usa chave DEV do AbacatePay).
- **Q-069-9 — `past_due` (grace 7 dias):** pausar IA e envio automático, mantendo leitura? **Recomendo sim.**
- **Q-069-10 — comparativo na landing** passa a vir do catálogo (mesma fonte da assinatura)? **Recomendo sim** (atinge a SPEC-035).
- **Q-069-11 — owner x member:** somente o `owner` liga/desliga agentes e edita conteúdo; `member` só aprova rascunhos e vê? **Recomendo sim** (não existe admin de org).

## Restrições de implementação
Só após `APROVAR SPEC-069`. Ordem: dev-backend (069a, 069b) → qa-reviewer → dev-backend/dev-frontend (069c) → dev-frontend (069d) → qa-reviewer → 069e. Ler `node_modules/next/dist/docs/` antes de código Next (AGENTS.md). Nunca `prisma migrate dev`; migrations aditivas à mão, aplicadas pelo usuário (`migrate deploy`); testes só em banco `*_test` NOVO. Pronto só com `tsc`, `eslint` (0 erros) e vitest verdes + QA independente. Não derrubar o `npm run dev` nem rodar `next build` sem avisar. Nunca imprimir segredos; não commitar `next.config.ts` (túnel local), `.claude/`, `skills-lock.json`. Ao fechar cada etapa: atualizar `docs/RETOMAR.md` (seção 0), `docs/ROTEIRO_DE_TESTES.md` e `docs/PRIMEIROS_PASSOS.md` (linguagem simples), commit e push.

## Implementation Notes 069a (backend; 2026-10-12) — status da etapa: IMPLEMENTADA, aguardando QA/commit
- **Arquivos criados:** `src/lib/billing/plan-catalog.ts` (catálogo + `PLAN_MATRIX`, único lugar dos valores PLACEHOLDER), `src/lib/billing/entitlements.ts` (módulo único), `src/lib/billing/entitlements.test.ts`, `prisma/migrations/20261022120000_entitlement_override_069a/migration.sql` (aditiva, escrita à mão; **o usuário aplica com `migrate deploy`**).
- **Arquivos alterados:** `prisma/schema.prisma` (model `OrgEntitlementOverride` + relação em `Organization`; `prisma generate` rodado, nenhum `migrate`), `prisma/seed.ts` (PLAN_SEED derivado do catálogo; `seedPlans` atualiza `limits` dos 5 planos, idempotente — Q-069-8), `src/lib/billing/plans.ts` (`parseLimits` ampliado + `parseFeatures`), `src/lib/billing/limits.ts` (tipo `ExtraLimitMetric` + mensagens PT-BR; `PlanLimitError` aceita as métricas novas), `src/lib/actions/result.ts` (`handleActionError` -> `code:["plan_feature_locked"]`, `feature`, `requiredPlan`), testes ajustados: `plans.test.ts`, `migration-065.test.ts` (seed agora repõe os 5 planos), `channels/email.test.ts` (Starter passou a limitar 1 conta de e-mail, Q-069-6; o teste de CRUD usa plano de teste sem limite).
- **API do módulo:** `getEntitlements(db, orgId, now?)` (uma query, nunca lança: erro = fail-closed só leitura), `resolveEntitlements(orgId, row, now)` (pura, p/ tick por lote na 069b), `hasFeature`, `limitOf`, `assertFeature`/`assertFeatureIn` (lançam `PlanFeatureLockedError`), `assertWithinEntitlementLimit` (lança `PlanLimitError` com métricas novas `agents|ai_budget|agent_messages|lead_searches|creatives|members|sequence_steps`), `requiredPlanName`. `assertWithinLimit` reexportado.
- **Decisões:** (1) sem coluna nova em `Plan`: `features` fica dentro de `Plan.limits` (JSON) como `{"features":{"agents.role.sdr":true,...}}`; só `true` literal libera. (2) Features são todas booleanas com chaves planas (`agents.role.<papel>`, `agents.autonomy.<modo>`, `llm.byok`, `sources.ads`, `ingest.api`, `inbox.read|reply|attachments|labels`). (3) Chave numérica nova ausente = 0 nas que custam dinheiro/risco (agentes, orçamento IA, msgs/dia, buscas, criativos) e ilimitado em `maxMembers`/`maxSequenceSteps`; `null` explícito = ilimitado. (4) `business`/`courtesy` = tudo liberado pela lista `FULL_ACCESS_PLAN_KEYS` do catálogo, independente do JSON gravado. (5) Estados: sem assinatura (org ativa) = liberado; trial expirado/`soft_blocked`/`canceled` = só leitura (`inbox.read`); `past_due` = plano vale, features `costly` e limites de agente viram 0 (aplicado depois do override); plano com `limits` ilegível = fail-closed; override só vale com `expiresAt` nulo ou futuro e nunca destrava bloqueio de pagamento. (6) `LimitMetric` da 065 não foi alterado (UI de uso intacta); métricas novas em tipo separado. (7) `plan_feature_locked` ainda não está no catálogo do front (`action-errors.ts`): é 069d.
- **Testes (vitest, banco novo `leadforge_069a_test`, `PAYMENT_PROVIDER=mock` etc.):** `entitlements.test.ts` cobre matriz célula a célula (Free/Starter/Pro x 13 features), limites, business/courtesy, sem assinatura, trial expirado, canceled, past_due, plano ilegível, erro/org inexistente, override (válido/expirado/relógio injetado/chaves inválidas), parse, erro tipado + `handleActionError`, migration aditiva + índices no banco, seed idempotente, isolamento A/B/C com banco real, downgrade/upgrade imediato. Resultado: `vitest run` completo **211 arquivos / 2764 testes VERIFIED**; `tsc --noEmit` VERIFIED sem erros; `eslint .` VERIFIED 0 erros (só warnings preexistentes).
- **Critérios cobertos nesta etapa:** AC-1 (matriz: PASS, `entitlements.test.ts` "plan-catalog / matriz"), AC-4 parcial (downgrade/upgrade e fail-closed no módulo; efeito nos runners = 069b), AC-5 parcial (valores num só arquivo; teste de que actions/agents/api não comparam `plan.key`), AC-6 override respeita `expiresAt` (auditoria = 069c). AC-2/3/7 e aplicação nas entradas de servidor ficam para 069b/c/d.
- **Limitações/avisos:** nenhum guard foi aplicado às actions ainda (069b). Após aplicar a migration, rodar o seed (`npm run db:seed` ou equivalente) para gravar a matriz nos planos existentes: **até lá `starter`/`pro` no banco não têm `features` e IA fica bloqueada (fail-closed)**; o seed também passa a limitar Starter/Pro em e-mail (1/3) e envios/dia (300/1000), valendo para assinantes atuais. Sem `OrgEntitlementOverride` ainda não há escrita (admin = 069c). Questões Q-069-3/5..11 seguem a recomendação; Q-069-3 (`AgentSettings.lockedByAdmin`) NÃO entrou na migration (fica para 069c, se aprovado).

## QA 069a (2026-10-13) — APROVADO
- Verificado de forma independente: migration aditiva, matriz célula a célula, BYOK desligado, fail-closed, override com `expiresAt`, isolamento A/B/C, seed idempotente. tsc e eslint (0 erros) verdes; vitest 2763/2764 (a falha é `src/lib/inbox/send-manual.test.ts:200`, teste flaky pré-existente que depende do relógio entre 00:00 e 05:00 BRT; fora da 069a).
- **Achado médio (decidir ANTES da 069b):** `entitlements.ts:89` libera tudo para Business/courtesy antes de olhar `soft_blocked`/`canceled`/org suspensa. Cuidado: courtesy pode não ter assinatura; aplicar o ramo `blocked` só a org suspensa ou assinatura cancelada, sem quebrar courtesy sem assinatura.
- Baixo: `plans.test.ts:47` perdeu a igualdade exata de `parseLimits` (restaurar asserção sobre as chaves); seed sobrescreve `limits` dos planos pagos (avisar antes do `db:seed` em produção); `send-manual.test.ts` flaky (issue à parte).

## Implementation Notes 069b (backend; 2026-10-13) — status da etapa: IMPLEMENTADA, aguardando QA/commit
- **Correcao do achado medio do QA 069a (decidido):** `resolveEntitlements` (`entitlements.ts`): Business/courtesy liberam tudo (`source: "full"`) SOMENTE se a org nao estiver suspensa e a assinatura nao estiver cancelada/bloqueada/expirada (`access` = `soft_blocked`/`trial_expirado` cai no ramo `blocked`, so leitura); courtesy SEM assinatura continua liberada (`source: "none"`). Baixo 3: `plans.test.ts` voltou a `toEqual` exato de `parseLimits` (12 chaves).
- **Arquitetura:** `limit-error.ts` (novo: `PlanLimitError`, metricas, `Db`; sem dependencia de entitlements, evita ciclo); `limits.ts` reexporta e `getOrgLimits` agora e DERIVADO de `getEntitlements` (override e bloqueio valem tambem nos 5 limites legados: campanhas, WhatsApp, e-mail, leads, envios/dia); `entitlements.ts` ganhou `subscriptionStatus`, `isCostlyBlocked`, `agentRoleFeature`, `agentAutonomyFeature`; `agents/plan-gate.ts` (novo: `runnableAgentIds`, `resolveRunnableAgents`, `monthlyOrgSpend`); `plan-catalog.ts` ganhou `isFreePlanKey` (semantica de trial em `account-deletion/*` e `cancel-subscription.ts`, que comparavam `plan.key === "free"`).
- **Pontos de entrada guardados (servidor; erro `plan_feature_locked` com `feature`/`requiredPlan`, ou `plan_limit` com `metric`):**
  - Agentes (`actions/agent.ts`): `createAgent` (papel), `setAgentActive` (papel + modo rascunho + `maxActiveAgents` sob `lockOrg`), `setAgentAutonomy` (sampled/auto; voltar a rascunho sempre livre), `updateAgentSettings` (desligar o kill switch exige direito; ligar sempre livre), `simulateAgentAction`, `bulkApproveFollowups`, `approveDraft` (via `dispatchDraft`). Edicao de conteudo, base de conhecimento, rejeitar e assumir lead NAO sao barrados (sem custo; reduzem uso).
  - Runner/tick: `runAgentTask` (defesa em profundidade: plano ilegivel/erro, org bloqueada, `past_due`, papel fora do plano, acima de `maxActiveAgents` => `deferred/plan_locked`, tarefa fica `queued`, agente continua `active`; teto de IA do plano por org em centavos; mensagens/dia = min(agente, plano); autonomia alem do plano cai em REVISAO), `processAgentQueue` (resolve o plano 1x por org, so agentes executaveis entram no lote; org bloqueada nao trava a fila das outras), `isAgentAvailable`, `findActiveCloser`, `simulateAgent`, `dispatchDraft` (ponto unico de envio de agente; lanca antes de consumir o rascunho).
  - Integracoes (`actions/integration.ts`): `saveIntegration`/`testIntegration` — `llm` exige `llm.byok` (so Business/courtesy/override), `n8n` exige `ingest.api` (Pro+); `evolution`/`places` sem feature por plano (politica do admin = 069c); `removeIntegration` sempre livre.
  - Fontes/ingestao: `saveLeadSourceBinding` (`sources.ads`); webhooks Google Ads (403 `plan_feature_locked`), Meta (barra ANTES da Graph API; 403 se todos barrados), `ingestExternalLead`; n8n/API `handleIngest` (403 `plan_feature_locked`). Configuracao preservada; so para de ingerir; nao reivindica a chave de idempotencia (volta apos upgrade).
  - Caixa: `sendManualWhatsApp` (`inbox.reply`; codigo novo `plan_feature_locked`), `setConversationStatus` (`inbox.reply`), `inboxReadGuard` (`inbox.read`; so some por override). Free le, Starter responde texto. `inbox.attachments`/`inbox.labels` ainda sem ponto de entrada (068c/d/e): o teste de cobertura exige aplica-las quando existirem.
  - Criativos: `createCreativeDraft` (limite 0 barra ate o rascunho), `enqueue` submit/retry (`maxCreativesPerMonth` 0/3/20 sob o advisory lock da org; reenvio de criativo ja contado no mes nao consome cota), runner (`processCreativeJobs` nao cria video no provedor se bloqueado/`past_due`/limite 0: solta o lease e reagenda).
  - Equipe: `inviteMember` (membros + convites pendentes de outros e-mails) e `addMember` em `org/join.ts` (funil unico de aceite/codigo/signUpAndJoin; transacao desfeita => convite/uso do codigo nao queimam).
  - Sequencias: `createSequence`, `saveSequenceSteps` (so barra CRESCER acima do limite: apos downgrade a sequencia maior segue editavel/encolhivel), `duplicateSequence`.
  - Busca de leads: `reserve()` em `lead-search/run.ts` (por org/dia, manual + agendada; manual recebe `plan_limit/lead_searches`, agendada pula em silencio; sem run `blocked` registrado).
  - E-mail e envios/dia: via `getOrgLimits` (derivado do modulo; override-aware). `deferOverPlanBeforeReserve` (ponto unico de envio de e-mail/WhatsApp de sequencias, agentes e rascunhos): `past_due`, plano ilegivel/erro e org bloqueada ADIAM o envio (`plan_locked`, 6 h, sem queimar tentativa); manual da caixa nao passa por la.
- **Downgrade/past_due:** nada e apagado ou desativado em banco (agentes, membros, sequencias, vinculos, criativos, conversas); o que excede fica parado/somente leitura e volta no upgrade/regularizacao (testado). `past_due`: IA/envio automatico/ativar agente pausam; leitura e resposta manual da caixa continuam.
- **Testes (banco `leadforge_069b_test`, `PAYMENT_PROVIDER=mock` etc.):** novos `entitlements-069b-entrypoints.test.ts` (69), `entitlements-069b-agents.test.ts` (33), `entitlements-coverage.test.ts` (122; manifesto de TODA action/rota/gate de dominio, catalogo x aplicacao, ban de `plan.key ===` em `src/lib` e `src/app`, com auto-testes do detector); ampliados `entitlements.test.ts` (business/courtesy suspensos) e `plans.test.ts`; `test-utils/entitlements-fixture.ts`, `ensureTestPlan` (planos de teste legados agora abrem as chaves novas), `grantAllEntitlements` (org de seed no Starter) nos testes de integracao/fontes/ingestao/agentes/equipe. Correcao de relogio em `send-manual.test.ts:200` (toque no mesmo dia BRT; sem enfraquecer a asserção). Resultado (VERIFIED): `tsc --noEmit` sem erros; `eslint .` 0 erros (25 warnings preexistentes); `vitest run` completo 214 arquivos / 2990 testes verdes.
- **Criterios de aceitacao (backend):** AC-2 (tenant nao le/edita segredo/politica do admin; so ha leitura de politica pelo tenant): servidor barra BYOK/n8n/fontes/papeis/autonomia; a EDICAO da politica pelo admin e a leitura-somente do tenant sao 069c (nenhum caminho de escrita de override foi criado). AC-3: Free nao ativa agente; Starter so `followup` em rascunho (1 ativo); Pro ate 3 com auto; estouro de teto pausa (`budget_exhausted`, fica `queued`) — o AVISO ao owner (80%/100%) e UI/notificacao = 069d. AC-4: downgrade nao apaga, upgrade reativa, plano desconhecido/ilegivel nao executa IA/envio (fail-closed). AC-5: valores so no catalogo/seed; nenhum `plan.key ===` em `src/lib`/`src/app` fora de `entitlements.ts`/`plan-catalog.ts` (teste); `src/components` (3 ocorrencias de apresentacao) ficam para a 069d.
- **Desvios/decisoes (para o QA):** (1) agentes acima do limite NAO viram `active=false` no banco (a SPEC dizia "ficam active=false com motivo plano"): ficam parados em runtime e voltam sozinhos no upgrade, sem coluna nova de motivo (sem migration); (2) `monthlySpend(null)` somava TODAS as orgs no teto global do kill switch: corrigido para `monthlyOrgSpend(orgId)` (isolamento); (3) `getOrgLimits` passou a derivar do modulo (override/bloqueio valem nos limites legados; business/courtesy suspensos tambem entram no ramo bloqueado); (4) ENFORCEMENT de BYOK: `saveIntegration llm` ja e barrado, mas a resolucao em runtime (`getLlmProvider`) AINDA usa a chave que a org ja tenha salva (nao ha chave da plataforma ate a 069c): quem tinha LLM salvo continua rodando; quem nao tinha nao consegue cadastrar (Free/Starter/Pro) ate a 069c entregar a chave da plataforma — janela intencional da SPEC (Q-069-2); (5) `past_due` tambem adia o envio de sequencias/rascunhos (todos passam por `deferOverPlanBeforeReserve`), nao so IA (D-069-10/Q-069-9).
- **Limitacoes conhecidas:** sem aviso ao owner no estouro de teto (069d); sem escrita de override/politica (069c); `inbox.attachments`/`labels` sem ponto de entrada (068c/d/e); `evolution`/`places` seguem editaveis pelo tenant ate a 069c; Pro/Starter sem chave LLM salva ficam sem IA ate a 069c; seed precisa ser rodado (`db:seed`) em cada banco para gravar a matriz nos planos existentes (sem isso Starter/Pro ficam fail-closed em IA/fontes).

## QA 069b (2026-10-13) — APROVADO
- Reexecutado de forma independente: tsc, eslint (0 erros), vitest 214 arquivos / 2990 testes; todos os pontos de entrada guardados no servidor; matriz confere; downgrade/past_due sem apagar; isolamento (`monthlyOrgSpend` corrige soma global do kill switch).
- **A corrigir na 069c (decidido pelo orquestrador):**
  1. MÉDIO `src/lib/mobile/actions.ts:146-152` (`approveDraftMobile`): mapear `PlanFeatureLockedError` para erro tipado (hoje vira 500).
  2. BAIXO-MÉDIO `src/lib/mobile/actions.ts:107-128` (`setKillSwitch`): aplicar o mesmo guard da web (`assertFeature`); o manifesto isenta `/api/mobile` em bloco, revisar.
  3. BAIXO `entitlements.ts:93`: Business/courtesy em `past_due` hoje ficam liberados; decisão: pausar IA e envio automático para todos (D-069-10).
  4. BAIXO `entitlements.ts:82,99`: plano ilegível mantém limites legados ilimitados (campanhas/leads/WhatsApp/e-mail); avaliar fail-closed também na criação.
  5. BAIXO BYOK: migrar/desativar chaves de LLM já salvas por tenants (069c); teto de IA não pesa em host privado.
  6. BAIXO: lock de org nas buscas agendadas; criativo em `past_due` ainda enfileira; comentário de teste com nome de arquivo errado; SPEC seção C atualizada para o desvio "agentes acima do limite ficam parados em runtime".
