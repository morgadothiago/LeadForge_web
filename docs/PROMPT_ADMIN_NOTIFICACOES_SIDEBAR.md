# Prompt: sino do admin com todos os eventos da plataforma + sidebar de administração coerente

Cole no `project-orchestrator` (ele cria a SPEC, depois `dev-backend`, depois `dev-frontend`, depois `qa-reviewer`). Escrito em 2026-10-12.
Origem: o usuário abriu a tela de Administração e viu (1) o sininho do topo sem nada e (2) uma sidebar com um único item
("Administração"). Quer o sino mostrando **tudo que acontece na plataforma** e uma sidebar de admin **coerente com o resto do projeto**.

---

## Prompt

Contexto: LeadForge (`/Users/thiagomorgado/Desktop/LeadForge_web`), Next.js (breaking changes: leia
`node_modules/next/dist/docs/` antes de tocar em API Next), SDD obrigatório (SPEC APPROVED antes de código; uma SPEC por
vez; QA independente antes de commitar). Responda em pt-BR. O projeto é **só web** (mobile fora do escopo).

A área de administração (`platformRole = "platform_admin"`, rotas em `src/app/(app)/admin/*`, SPECs 031/032) é cross-tenant.
Hoje ela tem: lista de organizações, criar conta de cortesia, suspender/reativar. O sino do cabeçalho do admin existe mas
**não mostra nada**, e a sidebar do admin tem **um único item** ("Administração"). O sino e a polling de notificações do
tenant existem (SPEC-029; código em `src/lib/notifications/*`, `NotificationsProvider`, bolinhas na sidebar, toasts): reaproveite
o padrão, **não** crie um segundo sistema paralelo sem justificar na SPEC.

### Parte 1: o sino do admin mostra tudo que está acontecendo

Objetivo: o administrador da plataforma vê, em tempo quase real, os eventos relevantes de **qualquer organização**.

Eventos mínimos (confirmar a lista com o usuário antes de aprovar a SPEC; cada um com título, descrição curta, org, link):

| Categoria | Evento | Origem no código (confirmar lendo o código) |
|---|---|---|
| Usuários | Novo usuário cadastrado | `signUp` (`src/lib/actions/billing.ts`) |
| Usuários | E-mail verificado | `verifyEmail` (`src/lib/actions/auth.ts`) |
| Organizações | Organização criada / finalizada (nomeada) | `completeOrganizationSetup`, `createOrganization` |
| Organizações | Organização suspensa / reativada (manual ou automática) | `src/lib/billing/status-map.ts`, ações do admin |
| Cobrança | **Pagamento efetuado** (primeiro pagamento e renovação) | webhook `subscription.completed` / `subscription.renewed` / `transparent.completed` (`src/lib/billing/process-event.ts`) |
| Cobrança | **Assinatura ativada / plano alterado** | `processBillingEvent` |
| Cobrança | **Cancelamento** (pelo usuário, agendado ou automático) | `cancelSubscription`, `cancelPendingSubscription`, evento `subscription.cancelled` |
| Cobrança | Falha de pagamento (cartão recusado, `past_due`) | evento `subscription.payment_failed` |
| Cobrança | Pagamento sem organização (`[billing-orphan-payment]`, `org_not_found`) | `webhook-handler.ts`: **alerta crítico** para conciliação manual |
| Conta | Exclusão de conta solicitada / concluída (LGPD) | `src/lib/account-deletion/*` |
| Saúde | Falha de integração/e-mail/webhook/tick que deixou de rodar | `src/lib/scheduler/*`, `SCHEDULER_EXPECTED_INTERVAL_MS` |

Se a SPEC-065 (Free de 7 dias) estiver implementada, incluir também: trial iniciado, trial expirando (D-3/D-1), trial expirado
e conversão trial -> pago.

Decisões que a SPEC deve registrar (D-0NN-x), com recomendação:
- Q1 **Armazenamento:** tabela própria append-only (ex.: `PlatformEvent { id, type, severity, orgId?, userId?, title, body,
  metadata(sem segredos), createdAt }`) mais estado de leitura por administrador (`PlatformEventRead { eventId, adminId, readAt }`),
  **ou** reaproveitar `PlatformAuditLog`/`OrgAuditLog`. Recomendado: tabela própria com um único emissor
  `emitPlatformEvent()` chamado nos pontos de domínio, para o sino não depender de varrer logs. Migration **aditiva**.
- Q2 **Emissão confiável e idempotente:** o evento nasce na mesma transação do fato (ou logo após, sem perder se falhar);
  eventos de webhook usam o `eventId` do provedor como chave de deduplicação (retentativa não duplica).
- Q3 **Privacidade:** o admin vê e-mail do usuário e nome da organização; **nunca** segredos, tokens, corpo de requisição,
  CPF/CNPJ nem dados de cartão além de bandeira/4 últimos dígitos. Mascarar o que não for necessário. LGPD: documentar a base
  legal e a retenção do histórico (sugerido: 12 meses; purga no tick).
- Q4 **Severidade:** `info`, `success`, `warning`, `critical` (pagamento sem org, falha do tick) com cor **e** texto/ícone
  (acessibilidade: cor não é a única informação).
- Q5 **Entrega:** polling (mesmo mecanismo da SPEC-029; sem WebSocket) com contador de não lidos no sino, toast apenas para
  `warning`/`critical` (evitar spam), deduplicação de toast (`toast-dedupe.ts`).
- Q6 **Escopo de leitura:** um evento pode ser lido por um admin e continuar não lido para outro? Recomendado: leitura por
  administrador.
- Q7 **Volume:** paginação por cursor, filtro por categoria/severidade/organização e "marcar todos como lidos".

UI do sino (admin): popover/sheet com lista agrupada por hoje/ontem/antes, ícone por categoria, título + org + horário relativo,
estado de lido/não lido, link direto para a organização ou para a assinatura, estado vazio ("Nada de novo por aqui"), estado
de erro com "Tentar de novo", `aria-live` discreto, teclado e leitor de tela, 390px, tema claro e escuro. Página completa
`/admin/eventos` (histórico com filtros), pois o sino mostra só os mais recentes.

### Parte 2: sidebar de administração coerente com o projeto

Hoje a sidebar do admin é uma lista de um item (veja `src/components/layout/nav-items.ts` e `AppSidebar.tsx`). Referência de
padrão: a sidebar do tenant já é **agrupada em seções com título** (SPEC-057, `NAV_SECTIONS`). Faça o admin seguir o **mesmo
componente e a mesma convenção** (seções com título pequeno em cinza, itens com ícone, badge de contagem, item ativo, modo
ícone recolhido, Sheet no mobile), em vez de um componente novo.

Estrutura proposta (confirmar com o usuário; **não criar item sem rota real**: se uma tela ainda não existe, ou entra
na SPEC como tela nova mínima ou fica fora):

| Seção | Itens |
|---|---|
| (topo, sem título) | Visão geral (KPIs: organizações ativas, novos usuários 7d, receita do mês, pagamentos com falha, trials expirando) |
| **Plataforma** | Organizações (já existe), Usuários, Contas de cortesia |
| **Cobrança** | Assinaturas, Pagamentos, Planos (preços e limites; hoje PLACEHOLDER) |
| **Atividade** | Eventos (feed completo do sino, badge de não lidos), Auditoria (`PlatformAuditLog`) |
| **Sistema** | Saúde (tick, e-mail, webhooks, integrações), Configurações da plataforma |

Decisões para a SPEC (com recomendação): quais telas da tabela viram escopo desta SPEC e quais ficam como "em breve" sem item
na sidebar; "Visão geral" como página inicial do admin (hoje a home do admin é a lista de organizações); badges (eventos não
lidos, pagamentos com falha); permissão (`requirePlatformAdmin` em **todas** as rotas e actions novas, com varredura estática
como a de `requirePageProviderOrg`); mesma navegação por teclado e persistência do estado recolhido (cookie `sidebar_state`).

### Requisitos gerais
1. Reaproveitar componentes e helpers existentes (`Field`, `Toaster`/`sonner`, `NotificationsProvider`, `nav-items.ts`).
2. **Isolamento:** só `platform_admin` lê o feed; teste de que um usuário de tenant (provider) recebe 403 em toda rota/action
   nova, e que o admin não vê segredos.
3. Emissão de eventos não pode **quebrar** o fluxo de negócio (falha no emissor é logada e não derruba pagamento/cadastro).
4. Testes: emissão por fonte (cada evento da tabela), idempotência por `eventId`, contador de não lidos por admin, paginação,
   mascaramento, guards, e UI (SSR/estático) da lista, estados vazio/erro e da sidebar nova. Regressão da sidebar do tenant.
5. Docs: `docs/PRIMEIROS_PASSOS.md` (linguagem simples, tom "criança de 5 anos": "o sininho do chefe"), bloco novo no
   `docs/ROTEIRO_DE_TESTES.md`, `docs/RETOMAR.md`, linha no `specs/README.md`.
6. Divisão sugerida: **a)** backend (tabela, emissor, pontos de emissão, API de leitura/contagem/marcar lido, purga) -> QA;
   **b)** frontend (sino, `/admin/eventos`, sidebar, páginas mínimas) -> QA. Se o admin já tiver mais telas na época, ajustar.

### Fora do escopo
Notificação por e-mail/Slack/push ao admin (futuro), edição de planos pela UI (se não houver SPEC própria), app móvel.

### Antes de codar
Perguntar ao usuário: (1) a lista final de eventos do sino; (2) quais telas novas do admin entram agora; (3) retenção do
histórico de eventos; (4) se o sino deve alertar o admin por e-mail nos eventos `critical`.
