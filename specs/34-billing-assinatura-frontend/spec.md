# SPEC-034 — Billing/assinatura: frontend (pricing, checkout, gestao do plano)
- status: IMPLEMENTED (dev-frontend, 2026-09-26) | domain: frontend | depende de: 033, 002, 027

## Objetivo
UI para o Provider escolher/trocar de plano e gerenciar a assinatura, mostrar o bloqueio quando a org estiver suspensa por billing, e permitir que um visitante novo (vindo da landing, SPEC-035) crie conta + assine sem intervencao humana (signup self-service).

## Escopo
- Configuracoes > Assinatura (novo item, mesmo padrao de aba usado em SPEC-018 "Configuracoes > Integracoes"): plano atual, status, proxima cobranca, botao "Gerenciar assinatura" (abre o portal do provedor, SPEC-033) e, se sem plano ativo, os cards de plano com abas mensal/anual (mesmos dados de `Plan` da SPEC-033).
- Fluxo de checkout (usuario ja logado, trocando de plano): seleciona plano/cadencia -> chama `createCheckoutSession` (SPEC-033) -> redireciona para o checkout hospedado do provedor -> retorno tratado (sucesso/cancelado) com toast e revalidacao do status da org.
- **Signup self-service** (decisao D-35-1, usuario 2026-09-25): nova rota publica `/signup` (fora do gate de `requireUser()`, mesmo route group publico da SPEC-035) — formulario minimo (nome, e-mail, senha, nome da empresa) -> cria `User` (`role: provider`/owner) + `Organization` nova (reusa o mesmo caminho de criacao 1:1 da migracao da SPEC-030) + inicia trial (`Subscription.status: trialing`, sem cobranca, D-33-3) -> loga o usuario -> redireciona para o checkout do plano escolhido (se veio da landing com plano pre-selecionado via query param) ou para `/dashboard` (se so quer comecar o trial e escolher depois). Reusa validacao/hash de senha ja existente em SPEC-009 (argon2), so adiciona o passo de criar Organization.
- Tela/banner de "assinatura pendente" quando `Organization.status !== "active"`: aparece em todo o app autenticado do Provider (banner persistente estilo `HealthBanner` ja existente, `src/components/layout/HealthBanner.tsx`) com CTA para regularizar, sem esconder o restante da navegacao (a menos que D-33-4 decida bloquear leitura tambem).
- Componentes de card de plano (preco, lista de limites/beneficios, badge "mais popular" se aplicavel) reaproveitados depois na landing (SPEC-035) — construir como componente compartilhado (`src/components/billing/PlanCard.tsx` ou similar) desde o inicio para nao duplicar entre area logada e landing publica.

## Fora do escopo
- Definicao dos planos reais (D-33-2 fechada com placeholder, SPEC-033).
- Pagina publica de pricing na landing (SPEC-035 reusa o componente, mas a pagina em si e outra SPEC).
- Convite de multiplos membros por org (D-30-4, adiada).
- Qualquer coisa em `../mobile/`.

## Criterios de aceitacao
- [x] Provider ve plano atual/status/proxima cobranca; troca de plano funciona ponta a ponta ate o checkout hospedado (retorno tratado local, sem depender de rodar o provedor real em teste automatizado — mock/fixture do SDK).
- [x] Banner de assinatura pendente aparece quando `status !== "active"` e some quando regularizada (revalidacao coerente com o resto do app).
- [x] `/signup` cria User+Organization+trial e loga o usuario ponta a ponta (teste); e-mail duplicado da erro tipado, nao 500.
- [x] `PlanCard` reutilizavel, acessivel, responsivo.
- [x] build/lint/typecheck OK; validacao visual pendente (sem navegador disponivel neste ambiente — NOT VERIFIED, ver Implementation Notes).

## Ordem de execucao
dev-frontend, apos 033 `IMPLEMENTED`.

## Implementation Notes

### Decisao de design tomada durante a implementacao (nao e drift de escopo — usa so actions/queries ja existentes da SPEC-033)
O texto do escopo diz "e, se sem plano ativo, os cards de plano com abas mensal/anual". Isso sozinho deixaria
sem UI o fluxo de "trocar de plano" com a org JA ativa, que o proprio criterio de aceite AC-001 exige
("troca de plano funciona ponta a ponta ate o checkout hospedado"). `createCheckoutSession`/`processBillingEvent`
(SPEC-033) ja fazem `upsert` por `orgId` — chamar checkout para um plano diferente da assinatura atual
ATUALIZA a assinatura existente, entao o mesmo botao serve tanto para "assinar" (org sem plano) quanto para
"trocar de plano" (org com plano ativo). Decisao: a secao de cards (`PlanSelectionSection`) fica SEMPRE visivel
em Configuracoes > Assinatura (nao so quando "sem plano ativo"), com o titulo/CTA mudando conforme o estado
("Escolha um plano" / "Assinar" vs. "Trocar de plano" / "Trocar para este plano") — superset do texto literal
do escopo, necessario para cumprir o AC-001 sem inventar nenhum endpoint/action novo.

### Arquivos criados
- `src/lib/queries/billing.ts` — `getBillingSummary()` (plano/status/cadencia/datas + `isOwner`, usa
  `requireProviderOrg()` para funcionar com a org suspensa) e `getOrgStatusForBanner()` (leitura minima p/
  o banner global).
- `src/lib/billing/plans.ts` — `listActivePlans()` (catalogo PUBLICO, sem `requireProviderOrg`: `Plan` nao
  tem `orgId`, e dado global da plataforma — fica fora de `src/lib/queries/` de proposito, que e reservado a
  leituras autenticadas por org, ver comentario no arquivo e o teste estatico `queries chamam requireUser
  antes do prisma` em `src/lib/auth/auth.test.ts`). Usado tanto por `/signup` (publico) quanto por
  Configuracoes > Assinatura (autenticado).
- `src/components/billing/billing-format.ts` — labels PT-BR (status da assinatura/org, cadencia), tom do
  badge de status, `formatBRLCents`, `priceForCadence`, `limitLabel`.
- `src/components/billing/PlanCard.tsx` — card de plano reutilizavel (preco pela cadencia, limites como
  lista, badges "Mais popular"/"Plano atual"); CTA injetado via prop `footer` (cada consumidor decide o
  elemento: `Button` de checkout autenticado aqui, `Link` publico na landing da SPEC-035 depois) —
  desenhado desde o inicio para nao duplicar entre area logada e landing publica, como pedido no escopo.
- `src/components/billing/PlanSelectionSection.tsx` (client) — abas mensal/anual (`Tabs` do design system) +
  grade de `PlanCard` + `createCheckoutSession` via `useTransition`, com `window.location.href` para o
  checkout hospedado (mock: URL ja volta "concluida"; Stripe real: URL do checkout hospedado de verdade).
- `src/components/billing/SubscriptionSummaryCard.tsx` (client) — plano atual/status/proxima
  cobranca/trial/cancelamento agendado + botao "Gerenciar assinatura" (`createPortalSession`).
- `src/components/billing/CheckoutReturnHandler.tsx` (client) — le `?checkout=success|cancel` (URLs
  configuradas em `createCheckoutSession`), toast, limpa o parametro da URL e `router.refresh()` (revalida
  banner + resumo da assinatura sem reload cheio).
- `src/components/billing/SubscriptionPendingBanner.tsx` (server) — mesmo padrao visual de
  `HealthBanner.tsx`; aparece quando `Organization.status !== "active"`, nunca some a navegacao (D-33-4).
- `src/app/(app)/configuracoes/assinatura/page.tsx` — monta os componentes acima.
- `src/components/auth/SignupForm.tsx` + `src/app/signup/page.tsx` — rota publica `/signup`: campos minimos
  (nome, e-mail, senha, nome da empresa), mesmo padrao visual/de validacao PT-BR de `LoginForm`/`/login`
  (SPEC-009). `planKey`/`cadence` vem de query param (`?plan=...&cadence=...`, o link viria da landing da
  SPEC-035, fora de escopo aqui) e NUNCA sao campo do form — plano invalido/ausente/sem self-service cai
  para o mais barato self-service disponivel (hoje "starter"), nunca bloqueia o cadastro. Apos
  `signUpAndStartCheckout` (SPEC-033, sem alteracao): se o `plan` veio explicito na URL, chama
  `createCheckoutSession` na sequencia (usuario ja autenticado pela sessao recem-criada) e redireciona pro
  checkout hospedado; senao, vai direto para `/dashboard` (so inicia o trial). Falha no checckout
  pos-cadastro nao bloqueia o usuario (conta ja foi criada com sucesso) — cai para `/dashboard`, o owner
  tenta de novo em Configuracoes > Assinatura.
- Testes novos: `src/lib/billing/plans.test.ts`, `src/lib/queries/billing.test.ts`,
  `src/components/billing/billing-format.test.ts`.

### Arquivos alterados
- `src/app/(app)/layout.tsx` — `SubscriptionPendingBanner` adicionado antes do `HealthBanner`.
- `src/components/settings/SettingsTabs.tsx` — nova aba "Assinatura" (`adminOnly`, mesmo criterio das
  demais abas de configuracao de org).
- `src/app/login/page.tsx` — link "Ainda nao tem conta? Criar conta" para `/signup` (UX reciproca, nao
  pedido explicito da SPEC mas trivial/sem risco).

### Nenhuma action/query/schema da SPEC-033 foi alterada
Todo o trabalho desta SPEC consome `createCheckoutSession`/`createPortalSession`/`signUpAndStartCheckout`
(`src/lib/actions/billing.ts`) e o schema (`Plan`/`Subscription`/`Organization.status`) exatamente como a
SPEC-033 os deixou — nenhum endpoint novo, nenhuma migracao, nenhum campo de formulario alem do que
`signupSchema`/`checkoutSchema` ja aceitam.

### Testes executados (VERIFIED)
- `npx tsc --noEmit` — limpo.
- `npm run lint` — limpo (so os 4 warnings pre-existentes de `src/lib/billing/providers/*` e
  `webhook-handler.test.ts`, sem relacao com esta SPEC).
- `npm run build` (`next build`) — conclui, `/signup` e `/configuracoes/assinatura` aparecem como rotas
  dinamicas (`ƒ`).
- `npm test` — **1238 passando / 0 falhando / 0 pulados** (1217 pre-existentes + 21 novos: 4 em
  `plans.test.ts`, 8 em `billing.test.ts` de queries, 9 em `billing-format.test.ts`). O comportamento
  ponta a ponta de `signUpAndStartCheckout`/`createCheckoutSession`/`createPortalSession` (mock provider,
  sem credencial externa) ja estava coberto pelos testes da SPEC-033 (`src/lib/actions/billing.test.ts`) e
  nao foi alterado.

### Limitacoes conhecidas
- **Validacao visual em navegador: NOT VERIFIED.** Ambiente sem browser disponivel nesta sessao — a
  propria SPEC ja previa esse caso ("validacao visual pendente se navegador indisponivel"). Revisao
  aplicou heuristicas de UI/UX e responsividade mobile-first (grid `sm:grid-cols-2 lg:grid-cols-3`, tabs
  acessiveis via `@base-ui/react`, contraste dos tokens ja definidos no design system) mas nao foi
  confirmada visualmente em 375/768/1280px.
- Nenhum teste de componente React (render/interacao) foi escrito: o projeto nao tem `jsdom`/React Testing
  Library configurado em nenhum lugar (`vitest.config.ts` usa `environment: "node"` globalmente) — introduzir
  esse tooling seria uma decisao de infraestrutura de teste fora do escopo desta SPEC funcional. Cobertura
  ficou nas camadas testáveis com a infra atual (queries, formatacao pura); a logica de negocio ponta a
  ponta (checkout/portal/signup) ja e coberta pelos testes de action da SPEC-033.
- `PlanCard`/`PlanSelectionSection` marcam o plano "pro" como "Mais popular" por convencao de mercado
  (2º de 3 planos) — decisao de apresentacao, nao funcional; revisavel junto com os precos reais (D-33-2)
  antes do launch.
