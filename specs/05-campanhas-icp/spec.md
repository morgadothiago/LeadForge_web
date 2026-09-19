# SPEC-005 — CRUD de Campanhas + ICP
- status: IMPLEMENTED | domain: fullstack (Backend -> Frontend) | sessao: 1 | ordem: 6 | depende de: SPEC-001, SPEC-003 (vinculo Sequence: SPEC-006; instancia WhatsApp: SPEC-011, campo opcional ate la)
## Escopo
Backend: Server Actions + Zod para IcpProfile (nome, nicho, local, porte, sinais, keywords, sources, desiredData) e Campaign (nome, descricao, status, icp, sequence opcional, whatsappInstance opcional). Listagem com contagem de leads. Arquivar em vez de deletar se houver leads.
Frontend: lista de campanhas (cards), form criar/editar (ICP inline ou selecionar existente), selects de sequencia/instancia (vazios com aviso ate SPECs 06/11), pausar/retomar.
## Criterios de aceite
- [x] Criar/editar/pausar/arquivar campanha persiste e revalida a lista.
- [x] Validacao Zod: erros por campo em PT-BR.
- [x] Deletar campanha com leads e bloqueado com mensagem clara.
- [x] Campanha aceita sequenceId/whatsappInstanceId nulos.
- [x] Testes de Server Actions (validacao + persistencia) passam.
- [x] build/lint/typecheck OK.
## Seguranca
Actions exigem usuario (mock ate SPEC-009; NAO deixar TODO silencioso: helper `requireUser()` unico).
## Decisoes pendentes
D9: ICP reutilizavel entre campanhas ou 1:1 (schema permite N:1)?

## Backend (implementado; status segue APPROVED ate o frontend fechar)
Decisao D9 aceita: ICP reutilizavel (N campanhas : 1 ICP). Lead em 1 campanha. Sem alteracao de schema.
Arquivos: `src/lib/schemas/{icp,campaign}.ts`, `src/lib/actions/{result,icp,campaign}.ts`, `src/lib/queries/campaigns.ts`, `src/lib/auth/require-user.ts` (requireUser mock unico, usuario admin@leadforge.local), testes em `src/lib/actions/campaign.test.ts`.

### Contrato das Server Actions (`"use server"`, todas recebem `unknown`, validam com Zod)
```ts
type FieldErrors = Record<string, string[]>          // chave "icp.name", "name", "_form" (erro geral)
type ActionResult<T> = { ok: true; data: T } | { ok: false; errors: FieldErrors }
// src/lib/actions/campaign.ts
createCampaign(input: CampaignCreateInput): ActionResult<{id}>   // {name, description?, status?='active', sequenceId?, whatsappInstanceId?, icpId | icp:{...}} (exatamente um de icpId/icp)
updateCampaign(input: CampaignUpdateInput): ActionResult<{id}>   // {id, name, description?, status, sequenceId?, whatsappInstanceId?, icpId}
pauseCampaign(id) / resumeCampaign(id) / archiveCampaign(id): ActionResult<{id, status}>
duplicateCampaign(id): ActionResult<{id}>     // nasce paused, copia icp/sequence/instancia; NAO copia leads nem templates
deleteCampaign(id): ActionResult<{id}>        // bloqueia com leads (_form: "...possui N leads. Arquive-a em vez disso.")
// src/lib/actions/icp.ts
createIcp(input: IcpInput): ActionResult<{id}>   // {name, niche, location?, companySize?, signals[], keywords[], sources[], desiredData[]}
updateIcp(input: IcpInput & {id}): ActionResult<{id}>
deleteIcp(id): ActionResult<{id}>                // bloqueia se em uso por campanha (inclui arquivadas)
```
Tipos de entrada: `src/lib/schemas/*` (`CampaignCreateInput`, `CampaignUpdateInput`, `IcpInput`, `campaignStatusSchema`).
### Queries (`src/lib/queries/campaigns.ts`, server-only, sem N+1)
`listCampaigns({status?, includeArchived?=false}): CampaignListItem[]` (icp, sequence, whatsappInstance, leadCount, templateCount) | `getCampaign(id): CampaignDetail|null` | `listIcps(): IcpSummary[]` (campaignCount) | `getIcp(id)` | `listCampaignFormOptions(): {sequences, whatsappInstances}`.
Revalida `/campanhas`, `/campanhas/[id]` e `/`. Actions usam `revalidatePath` (nao ha `'use cache'`/tags ainda).
### Status dos criterios (backend)
Criar/editar/pausar/arquivar+revalida, Zod PT-BR, bloqueio de delete com leads, FKs nulas, testes: PASS (vitest). Build: PENDENTE (frontend).

## Implementation Notes (Frontend)
- Rotas: `/campanhas` (cards, filtro `?status=`, loading skeleton), `/campanhas/nova`, `/campanhas/[id]` (edição), `/campanhas/icps` (CRUD de ICP). Componentes em `src/components/campaigns/`. `<Toaster />` no layout `(app)`.
- Form com `useActionState` + erros por campo (`fieldError`, inclui `_form` e `icp.*`); ICP existente ou inline; selects de sequência/WhatsApp desabilitados com aviso enquanto vazios; ações pausar/retomar/reativar/duplicar/arquivar/excluir com ConfirmDialog + toasts.
- Extra: `MetricCard` aceita `direction` (flat = cinza, ícone neutro), `DashboardContent` repassa; teste `MetricCard.test.ts`.
- Validação: tsc, lint, vitest (37), build OK; dev server: `/`, `/campanhas`, `/campanhas/nova`, `/campanhas/icps`, `/campanhas/<seed>` = 200.
- Limitações: interações client (dialogs/selects) sem teste E2E; listas do ICP são inputs separados por vírgula; ID inexistente responde 200 em dev (stream do not-found).

## Implementation Notes (Correcoes de QA)
- Achado 1: `safeAction`/`handleActionError` em `src/lib/actions/result.ts` (Unauthorized, P2025/P2003/P2002, generico com console.error). Aplicado a todas as actions de campaign.ts e icp.ts; reutilizavel nas SPECs 006-008 (chamar dentro de funcao async exportada em arquivos "use server").
- Achado 2: deleteCampaign/deleteIcp com checagem+delete em `$transaction`; P2003 tratado com a mesma mensagem de bloqueio.
- Achado 3: botao Cancelar com `type="button"`. Achado 4: erros do IcpFormDialog limpos ao fechar/sucesso; `updateIcp` revalida `/campanhas/[id]` (page). Achado 5: cast removido.
- Testes novos em campaign.test.ts (erros sem vazamento, delete concorrente).
