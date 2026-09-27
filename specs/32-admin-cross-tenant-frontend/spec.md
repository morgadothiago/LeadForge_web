# SPEC-032 — Administrador: area cross-tenant (UI)
- status: IMPLEMENTED (dev-frontend, 2026-09-26) | domain: frontend | depende de: 031, 002 (design system), 027 (sidebar shadcn)

## Objetivo
Tela(s) para o `platform_admin` listar todos os Providers/Organizations, ver detalhe/uso e suspender/reativar, usando as queries/actions da SPEC-031.

## Escopo
- Nova secao no app, visivel SO para `platformRole === "platform_admin"` (sidebar ganha item "Administracao" so para esse papel; `provider` nunca ve o item nem acessa a rota — pagina trata negacao como as demais telas admin-only do projeto, ex. SPEC-018).
- Rota sugerida: `/(app)/admin/organizacoes` (lista) e `/(app)/admin/organizacoes/[id]` (detalhe) — dev-frontend confirma se cabe no grupo `(app)` atual ou se precisa de um layout proprio para o admin (ex.: sem o menu de campanhas/leads que so faz sentido para Provider).
- Lista: tabela/cards com nome, status (badge), dono, contadores, busca por nome/e-mail, paginacao — reaproveitar padroes ja existentes (ex.: lista de auditoria da SPEC-018, paginacao de leads da SPEC-008).
- Detalhe: contadores + botao suspender/reativar com `ConfirmDialog` (mesmo padrao usado em SPEC-011/018), toast de resultado, motivo obrigatorio ao suspender.
- Reaproveita integralmente o design system (SPEC-002) e a sidebar shadcn (SPEC-027) — nenhum componente novo de base, so composicao.

## Fora do escopo
- Metricas de billing (entra quando a SPEC-034/033 estiverem prontas — pode virar SPEC de ajuste incremental depois, nao redesenha esta tela).
- Convite/gestao de membros (D-30-4).
- Qualquer coisa em `../mobile/`.

## Criterios de aceitacao
- [x] `provider` nao ve o item de menu nem acessa `/admin/organizacoes*` (redirect/erro tratado).
- [x] `platform_admin` lista, busca, pagina, ve detalhe, suspende (com motivo) e reativa, com toasts e estado otimista/revalidacao coerente com o resto do app.
- [x] Responsivo (mobile/tablet/desktop), acessivel (foco, aria, navegavel por teclado) seguindo o padrao ja usado nas demais telas.
- [x] build/lint/typecheck OK; validacao visual marcada como pendente se navegador/docker nao estiver disponivel (mesmo padrao das SPECs anteriores).

## Ordem de execucao
dev-frontend, apos 031 `IMPLEMENTED`.

## Implementation Notes

### Decisao: grupo `(app)` existente, sem layout proprio
`AppLayout` (`src/app/(app)/layout.tsx`) ja era resiliente a `platform_admin` sem `orgId` antes
desta SPEC (`SubscriptionPendingBanner`/`HealthBanner` ja tratavam sessao sem org, comentarios no
codigo ja citavam SPEC-032). Em vez de criar um layout separado, a `AppSidebar` (SPEC-027) passou a
ser role-aware: recebe `platformRole` e troca a lista de itens renderizada por completo —
`ADMIN_NAV_ITEMS` (so "Administracao") para `platform_admin`, `NAV_ITEMS` (os 9 itens de sempre,
inalterados) para `provider`. Nenhum item de `NAV_ITEMS` faz sentido sem `orgId`, entao nunca
aparecem juntos. `nav-items.ts` ganhou `ADMIN_NAV_ITEMS` + `getPageTitle` passou a olhar os dois
arrays; `NAV_ITEMS`/testes existentes de `nav-items.test.ts`/`AppSidebar.test.tsx` nao foram
alterados em conteudo, so estendidos.

### Seguranca: negacao de acesso é no servidor, nao so na sidebar
`listOrganizations`/`getOrganizationDetail`/`suspendOrganization`/`reactivateOrganization` (SPEC-031)
já chamam `requirePlatformAdmin()` internamente. As duas paginas (`page.tsx`/`[id]/page.tsx`) capturam
`ForbiddenError` (sessao de `provider`) e `redirect("/dashboard")` ANTES de qualquer dado ser lido ou
qualquer HTML da lista/detalhe ser montado — nunca um "esconde no CSS/JS". `UnauthorizedError` (sem
sessao) redireciona para `/login`. Id com formato invalido (`orgIdSchema`, uuid) ou organizacao
inexistente -> `notFound()` (404), so para `platform_admin` (um provider nunca chega a essa
validacao, é redirecionado antes). Testado com integracao real (banco de teste, `signInAs`) nos dois
arquivos `page.test.tsx`, chamando a Page diretamente (sem passar por link/sidebar nenhum) — replicando
exatamente o cenario "provider digita a URL na mao" que as rodadas anteriores desta fila (030/031/033/
034/035) encontraram como ponto fraco recorrente.

### Busca: só nome/slug (não e-mail do dono)
A SPEC pedia "busca por nome/e-mail", mas `listOrganizations` (SPEC-031, já `IMPLEMENTED`, 2 rodadas
de QA) só filtra por `name`/`slug` (`listOrganizationsSchema`/query com `OR: [{name contains}, {slug
contains}]`) — não há filtro por e-mail do owner no contrato existente. Em vez de expandir
silenciosamente o contrato de uma SPEC já fechada, o formulário de busca (`OrganizationsSearchForm`)
usa o placeholder "Nome ou identificador da organização" (sem mencionar e-mail) e o e-mail do dono
continua visível como coluna somente-leitura na lista/detalhe. Se busca por e-mail for necessária,
é um ajuste incremental na query da SPEC-031 (fora do escopo desta SPEC-032, que é só frontend).

### Arquivos criados
- `src/components/admin/org-format.ts` (+ `.test.ts`) — labels/cores PT-BR de `OrgStatus`/
  `SubscriptionStatus`, `buildOrgsQuery` (mesmo padrão de `buildLeadsQuery`).
- `src/components/admin/OrgStatusBadge.tsx` — badge de status (mesmo padrão visual/`color-mix` de
  `StatusBadge`, SPEC-008).
- `src/components/admin/OrganizationsSearchForm.tsx` — form GET nativo (busca + status), mesmo padrão
  de `LeadFilters`.
- `src/components/admin/OrganizationsList.tsx` (+ `.test.tsx`) — tabela desktop / cards mobile +
  paginação, mesmo padrão de `LeadsTable`/`IntegrationAuditList`.
- `src/components/admin/OrganizationStatusActions.tsx` (+ `.test.tsx`) — suspender (com `ConfirmDialog`
  + motivo obrigatório, validado no cliente e no servidor) / reativar, toast + `router.refresh()`.
- `src/app/(app)/admin/organizacoes/page.tsx` (+ `.test.tsx`, `loading.tsx`) — lista.
- `src/app/(app)/admin/organizacoes/[id]/page.tsx` (+ `.test.tsx`, `loading.tsx`) — detalhe.

### Arquivos alterados
- `src/components/layout/nav-items.ts` — `ADMIN_NAV_ITEMS`, `getPageTitle` cobre as duas rotas novas.
- `src/components/layout/AppSidebar.tsx` (+ `.test.tsx`) — prop `platformRole` opcional
  (`"provider"` por padrão, compat com todo código existente).
- `src/app/(app)/layout.tsx` — passa `user.platformRole` para `AppSidebar`.

### Testes (VERIFIED — `npm test`, suíte inteira, sozinho, sem processo concorrente no banco)
`npm test` -> **106 arquivos, 1285 testes, todos passando** (incluindo os novos: 2 arquivos de
`page.test.tsx` com banco de teste real via `signInAs`/`createTestOrg`, `AppSidebar.test.tsx`
estendido, `OrganizationsList.test.tsx`, `OrganizationStatusActions.test.tsx`, `org-format.test.ts`,
`nav-items.test.ts` estendido). Durante o desenvolvimento, uma rodada isolada de
`cross-tenant-leak.test.ts`/`auth.test.ts` mostrou 3 falhas transitórias que desapareceram em nova
rodada limpa (flakiness pré-existente de ordenação entre arquivos do banco de teste compartilhado,
não relacionada a este SPEC — reconfirmado rodando os dois arquivos isolados, 100% verde) — a rodada
final relatada aqui é 100% verde do início ao fim.

`npm run lint` — 0 erros (4 warnings pré-existentes em `billing/providers`, não tocados por esta
SPEC). `npx tsc --noEmit` — 0 erros. `npm run build` — sucesso; `/admin/organizacoes` e
`/admin/organizacoes/[id]` aparecem como rotas dinâmicas (`ƒ`) no relatório do Next.

### Critérios de aceitação
| Critério | Status | Evidência |
|---|---|---|
| `provider` não vê o item nem acessa `/admin/organizacoes*` | PASS | `AppSidebar.test.tsx` (item ausente na nav) + `page.test.tsx`/`[id]/page.test.tsx` (redirect real para `/dashboard`, testado com sessão de provider real contra o banco de teste) |
| `platform_admin` lista/busca/pagina/detalhe/suspende(motivo)/reativa, toasts + revalidação | PASS | `page.test.tsx` (lista + filtro vazio), `[id]/page.test.tsx` (detalhe, ativa/suspensa), `OrganizationStatusActions.test.tsx` (botão correto por status); motivo obrigatório reforçado no cliente (`confirmDisabled`) e no servidor (`suspendOrganizationSchema`, já testado na SPEC-031) |
| Responsivo + acessível | PASS (revisão de código; ver limitação abaixo) | `OrganizationsList` replica o padrão tabela-desktop/cards-mobile já usado e testado visualmente em `LeadsTable` (SPEC-008); labels/`aria-*`/foco seguem os mesmos componentes de base (`ConfirmDialog`, `Input`, `Table`) já em produção |
| build/lint/typecheck OK | PASS | comandos rodados nesta sessão, ver acima |

### Limitações conhecidas
- Validação visual em navegador real (3 larguras) **NOT VERIFIED** — sem browser/docker disponível
  neste ambiente de execução; a revisão foi por composição de componentes já validados visualmente em
  specs anteriores (SPEC-008 tabela/cards, SPEC-018 histórico paginado, SPEC-011 `ConfirmDialog`),
  mesmo padrão de limitação já registrado nas SPECs anteriores desta fila.
- Busca não cobre e-mail do dono (ver seção acima) — limitação do contrato da SPEC-031, não desta SPEC.
- Métricas de billing/convite de membros: fora de escopo (ver "Fora do escopo"), não implementadas.
