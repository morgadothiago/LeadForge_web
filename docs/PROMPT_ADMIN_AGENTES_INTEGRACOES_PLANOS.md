# Prompt: Agentes e Integrações configurados pelo admin + funcionalidades por plano (Free, Starter, Pro)

Cole no `project-orchestrator` (ele cria a SPEC antes de qualquer código). Criado em 2026-10-12.

---

## Prompt

Você é o `project-orchestrator` do LeadForge (`/Users/thiagomorgado/Desktop/LeadForge_web`). Responda em pt-BR. Siga Spec-Driven
Development: **crie a SPEC (próximo número livre em `specs/`, confira `specs/README.md`), pare, e peça `APROVAR SPEC-0NN`** antes de
qualquer código. Depois: `dev-backend` → `qa-reviewer` → `dev-frontend` → `qa-reviewer`, em etapas pequenas (a, b, c...), cada uma
com QA e commit. Leia antes: `AGENTS.md` (este Next.js tem breaking changes), `docs/RETOMAR.md` (seção 0), SPEC-065
(`specs/65-free-trial-7-dias-limites/spec.md`, com Implementation Notes: é a fonte dos limites por plano), SPEC-019 (agentes de IA),
SPEC-018 (chaves/integrações no painel), SPEC-036 (LLM grátis por organização), SPEC-041 (Google Ads/Meta Leads), SPEC-031/032 (admin) e
SPEC-068 (caixa de atendimento).

### Pedido do usuário (literal)
> Fazer no projeto LeadForge a questão de agentes e integrações. Essa funcionalidade o **admin configura e o tenant só usa**. E também
> precisa **limitar os planos**, pois temos 3 planos: **Free, Starter e Pro** (fazer as funcionalidades e **bloquear funcionalidade para
> cada plano**). Olhe os planos e limite as funcionalidades de acordo com cada plano.

### Fatos já conferidos no repositório (confirme lendo o código; não invente)
1. **Planos** (`prisma/seed.ts`, tabela `Plan.limits` JSON; valores **PLACEHOLDER**): `free` (trial 14 dias, preço 0, sem checkout:
   1 campanha, 1 WhatsApp, 1 e-mail, 50 leads, 20 envios/dia), `starter` (R$ 297/mês: 3 campanhas, 1 WhatsApp, 500 leads/mês),
   `pro` (R$ 697/mês: 10 campanhas, 3 WhatsApp, 3000 leads/mês), `business` (sob consulta, ilimitado, sem checkout) e `courtesy`
   (ilimitado, interno). O seed só atualiza os limites do `free`; os demais `update` são `{}`.
2. **Limites aplicados hoje** (`src/lib/billing/limits.ts`, `getOrgLimits`, `assertWithinLimit`, `PlanLimitError`/`plan_limit`):
   `maxCampaigns`, `maxWhatsappInstances`, `maxEmailAccounts`, `maxLeadsPerMonth`, `maxSendsPerDay`. `null` = ilimitado; org sem
   assinatura (admin/seed) e `courtesy` = ilimitado. **Não existe nenhum limite/flag para agentes de IA, integrações, busca de leads,
   criativos nem caixa de atendimento.** O Starter e o Pro não definem `maxEmailAccounts` nem `maxSendsPerDay` (ficam ilimitados: provável
   lacuna a decidir).
3. **Agentes** (SPEC-019): modelos `Agent` (papéis `sdr | followup | closer`, `active`, `autonomy` draft/…, `monthlyBudgetCents`,
   `dailyMessageLimit`, `maxTurnsPerLead`, `allowedTools`, `disclosureEnabled`…) e `AgentSettings` (`killSwitch` padrão **true**,
   `monthlyBudgetCents`), `AgentRun`, `Draft`. Tela `src/app/(app)/configuracoes/agentes/page.tsx`: hoje bloqueia quando
   `user.platformRole !== "provider"` com "Somente administradores configuram os agentes". Rodam **dentro do app** (tick); o n8n NÃO
   executa agentes. Confirme quem é "provider" x "platform_admin" x `OrgRole` (`owner | member`; **não existe admin de organização**).
4. **Integrações** (SPEC-018, `IntegrationSecret` por org, `IntegrationKind`): `evolution`, `n8n`, `llm`, `places`, `google_ads_leads`,
   `meta_leads`. Tela `configuracoes/integracoes` (cartões, auditoria, fontes de lead). Segredo criptografado com `ENCRYPTION_KEY`.
5. **Já travam por plano/estado:** trial expirado (`redirectIfTrialExpired`, `resolveOrgAccess`, `AllowExpired`), limites do item 2.
6. **Cuidados do projeto:** migrations **aditivas, escritas à mão, nunca `prisma migrate dev`** (só `migrate deploy`, aplicado pelo
   usuário); push na `main` publica na Vercel (migrations rodam no build); downgrade **não retroage** (D-065, limites só barram NOVAS
   criações/ativações); erros tipados (`handleActionError`, `code: ["plan_limit"]`) com toast PT-BR (`notifyActionError`).

### O que a SPEC deve decidir (recomendação em cada ponto; as bloqueantes viram pergunta)

**A. Quem é o "admin" e o que o tenant pode fazer (bloqueante: Q-A1)**
- Opção recomendada: **admin da plataforma (`platform_admin`, painel `/admin`)** configura, por organização, o que está **liberado** e
  os **parâmetros globais** de agentes e integrações (modelo/LLM padrão, teto de custo, kill switch, quais integrações existem, chaves
  da plataforma). O **tenant (owner e member)** apenas **usa** o que o plano e o admin liberaram: liga/desliga um agente permitido,
  escolhe a persona/objetivo dentro de limites, aprova rascunhos (Aprovações), usa a integração já configurada.
- Esclarecer o que hoje o tenant (`provider`) consegue fazer em `configuracoes/agentes` e `configuracoes/integracoes` e o que passa a
  ser **somente leitura** ou **removido** do tenant. Listar, ação por ação, quem pode (admin | owner | member | ninguém). Segredos
  (chaves de API, tokens) **nunca** são exibidos ao tenant (só `hint` dos últimos 4 caracteres, como hoje).
- Decidir se o tenant ainda pode trazer **a própria chave de LLM** (BYOK, SPEC-036) ou se o custo de IA é da plataforma e só o admin
  configura (impacta preço e teto por plano). Bloqueante: Q-A2.

**B. Matriz de funcionalidades por plano (bloqueante: Q-B1; entregar como tabela com recomendação)**
Para cada funcionalidade, definir **Free | Starter | Pro** (e confirmar Business/courtesy = tudo liberado). Mínimo a cobrir:
| Funcionalidade | Pergunta |
|---|---|
| Agentes de IA (SDR / Follow-up / Closer) | Quais papéis cada plano usa? Quantos agentes ativos? Free = nenhum (recomendado) |
| Autonomia do agente | só rascunho (aprovação humana) em todos, ou auto-envio só no Pro? |
| Teto de custo/mês de IA e mensagens/dia por agente | valores por plano; o que acontece ao estourar (pausa, aviso, upgrade) |
| Integrações: Evolution (WhatsApp) | por plano: nº de números já existe (`maxWhatsappInstances`); liberar só Starter+? |
| Integração de LLM próprio (BYOK) | só Pro? |
| Busca de leads (Google Places, SPEC-015/058/060) | buscas/dia por plano; Free = desligada? |
| Fontes de lead (Google Ads Lead Form, Meta Lead Ads, SPEC-041) | só Pro? |
| n8n / ingestão externa por API | só Pro? |
| Caixa de atendimento WhatsApp (SPEC-068) | Free = só leitura? resposta manual a partir do Starter? anexos só Pro? |
| Criativos (vídeo/imagem) | quantidade/mês por plano |
| Equipe (membros e convites) | nº de membros por plano |
| Sequências multi-passo, templates, calendário/reuniões | limites ou liberação por plano |
Reaproveitar `Plan.limits` (JSON) **sem migration** quando possível (chaves novas opcionais, `null`/ausente = ilimitado, como a 065) e
considerar um **catálogo de features** (ex.: `features: { agents: ["sdr"], inbox: "read" | "reply" | "attachments", ... }`) em vez
de espalhar `if plano === "pro"` pelo código: **proibido checar a chave do plano diretamente (`plan.key === "pro"`)**; toda checagem
passa por um único módulo (extensão de `src/lib/billing/limits.ts` ou novo `src/lib/billing/entitlements.ts`) que recebe o `orgId`.

**C. Aplicação no servidor (obrigatória; esconder na UI não basta)**
- Toda Server Action, Route Handler, job do tick e webhook que use agentes/integrações/busca/criativos/caixa consulta o módulo único
  de permissões **no servidor**, dentro da transação quando houver contagem (`lockOrg`), com erro tipado (`plan_limit` ou novo
  `plan_feature_locked`), mensagem PT-BR com o nome do plano necessário, sem vazar dado de outra org.
- **Defesa em profundidade:** o runner de agentes (`run-agent.ts`/`advance.ts`) e o envio automático recusam executar se o plano
  não permite (ex.: downgrade, plano expirado), **sem apagar configuração** (volta a funcionar no upgrade).
- Downgrade: **não retroage** (nada é apagado); o que excede o novo plano fica **pausado/somente leitura** com aviso. Definir a regra
  por funcionalidade. Trial expirado continua bloqueando tudo (065).
- Casos de borda: org sem assinatura (admin/seed), `courtesy`, `business`, plano desconhecido (fail-closed no que custa dinheiro/risco,
  ex.: IA e envio; fail-open só em leitura), assinatura `past_due`/`canceled`.

**D. Admin (`/admin`, SPEC-031/032):** telas para o admin ver/definir, **por organização**: agentes liberados, teto de custo, kill
switch, integrações disponíveis e chaves da plataforma; **auditoria** (`PlatformAuditLog`/`OrgAuditLog`) de toda mudança; override
manual de plano/feature por organização (ex.: cliente piloto), com data de validade opcional. Somente `platform_admin`; o
`platform_admin` não acessa o conteúdo operacional dos clientes (leads, conversas).

**E. UI do tenant (frontend):** Tudo que o plano não inclui aparece **bloqueado com explicação clara** ("Disponível no plano Pro"), com
botão "Fazer upgrade" (`/configuracoes/assinatura`), nunca some em silêncio nem dá erro genérico; o `UsageMeter`/tela de assinatura passa
a mostrar também o uso de agentes/IA e os recursos incluídos no plano. Comparativo de planos na tela de assinatura e na landing
**gerado da mesma fonte** (sem texto duplicado que desatualize). Responsivo 390/1280 px, claro/escuro, acessível (`aria-disabled`
com motivo legível por leitor de tela, foco visível, alvos ≥ 44 px), toasts PT-BR. Erros do backend sempre via `notifyActionError`
(alinhar com a SPEC-067).

**F. Divisão em etapas sugerida (ajuste se achar melhor):** (a) módulo de permissões/entitlements + matriz de planos + testes de
unidade e isolamento; (b) aplicação no servidor (agentes, integrações, busca, caixa, criativos, tick) com testes por plano; (c) admin:
configuração por organização + auditoria; (d) UI do tenant (bloqueios, upgrade, medidores, comparativo); (e) revisão final e docs.
Cada etapa com QA independente e commit.

### Testes exigidos (vitest, banco `*_test` NOVO; relógio injetado)
- Matriz completa **plano × funcionalidade** (Free, Starter, Pro, Business, courtesy, sem assinatura, trial expirado, `past_due`,
  `canceled`): permitido x bloqueado, com a mensagem certa.
- **Toda** entrada de servidor (actions, route handlers, tick, webhooks) tem teste "plano sem permissão é barrado"; teste de cobertura
  que falha se surgir action de agente/integração sem o guard (padrão dos `*-auth-coverage.test.ts` existentes).
- Isolamento entre orgs A/B/C; tenant não lê/edita segredos nem configuração do admin; `platform_admin` sem acesso a dados operacionais.
- Downgrade não retroage e não apaga; upgrade reativa sem perda; corrida (duas requisições simultâneas no limite) respeita o teto.
- Auditoria registra quem mudou o quê, sem segredos nos logs; UI: bloqueio com explicação, link de upgrade, acessibilidade.
- `tsc`, `eslint` (0 erros) e vitest verdes; rodar `next build` com o dev parado (aviso antes) para pegar erro de componente de
  cliente importando módulo de servidor.

### Regras do projeto (valem na implementação)
- Nunca `prisma migrate dev`; migrations aditivas escritas à mão, aplicadas pelo usuário (`migrate deploy`); testes só em banco `*_test`
  NOVO, com `PAYMENT_PROVIDER=mock ABACATEPAY_API_KEY= ABACATEPAY_WEBHOOK_SECRET= APP_BASE_URL=http://app.test APP_URL=http://app.test TEST_DATABASE_URL=...`.
- Pronto só com `tsc`, `eslint` (0 erros) e vitest verdes + QA independente. Não derrubar o `npm run dev` nem rodar `next build` sem avisar.
- Nunca imprimir segredos. Não commitar `next.config.ts` (mudança local do túnel), `.claude/`, `skills-lock.json`.
- Preços e limites dos planos continuam **PLACEHOLDER** até o usuário decidir: a SPEC deve deixar os valores **num único lugar editável**
  (seed/catálogo) e documentar que mudar um número não exige mudar código.
- Ao fechar cada etapa: atualizar `docs/RETOMAR.md` (seção 0), `docs/ROTEIRO_DE_TESTES.md` e `docs/PRIMEIROS_PASSOS.md` (linguagem
  simples), commit e push.

### Entrega agora (e pare)
1. A SPEC completa (`DRAFT`) com decisões, a **matriz plano × funcionalidade** proposta, perguntas abertas (recomendação em cada),
   divisão em etapas, plano de testes e critérios de aceitação. Linha nova em `specs/README.md`.
2. Um resumo de até 8 linhas e **a pergunta**: "Posso considerar aprovada com as recomendações?". Não escreva código sem `APROVAR SPEC-0NN`.
