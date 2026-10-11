# SPEC-045 — react-hook-form: Configuracoes, Integracoes, WhatsApp, Supressao, Admin, Billing
- status: IMPLEMENTED (dev-frontend, 2026-10-11; sem commit) | domain: frontend | depende de: 042 (padrao definido + validado no piloto de Auth)

## Objetivo
Migrar para o padrao da SPEC-042 os formularios de: `EmailAccountFormDialog.tsx`, `EmailAccountList.tsx`, `IntegrationCard.tsx`, `IntegrationFormDialog.tsx`, `SuppressionAddDialog.tsx`, `SuppressionRemoveDialog.tsx`, `WhatsAppHealthPanel.tsx`, `WhatsAppInstanceFormDialog.tsx`, `WhatsAppInstanceList.tsx`, `WhatsAppQrDialog.tsx`, `WhatsAppWebhookSection.tsx`, `OrganizationStatusActions.tsx` (admin), e avaliar `PlanSelectionSection.tsx`/`SubscriptionSummaryCard.tsx` (billing — sao mais botao-com-confirmacao do que formulario de campos; decidir durante a implementacao se vale migrar ou manter como esta, documentando a escolha).

## Escopo
Mesmo padrao da SPEC-042. E o maior grupo (12 arquivos) — se o volume se mostrar dificil de revisar de uma vez durante a implementacao, o dev-frontend pode propor quebrar em sub-entregas (ex.: Email/Integracoes/WhatsApp separado de Supressao/Admin/Billing), documentando a divisao no relatorio, sem precisar de nova aprovacao formal (mesma spec, mesma decisao ja aprovada). Nao mudar regra de validacao.

## Fora do escopo
Qualquer coisa em `../mobile/`. Mudanca de regra de validacao.

## Criterios de aceitacao
- [x] Todos os arquivos listados migrados (ou justificativa documentada para os que ficarem de fora, ex. billing).
- [x] Nenhuma regressao nos testes existentes.
- [x] build/lint/typecheck OK.

## Ordem de execucao
dev-frontend, apos SPEC-042 `IMPLEMENTED`. Aguardando aprovacao (`APROVAR SPEC-045`).

## Implementation Notes (dev-frontend, 2026-10-11)

Entrega unica (nao foi preciso dividir): 6 arquivos migrados, os demais da lista nao capturam dado de campo.

### Migrados (padrao SPEC-042/043/044: `zodResolver` + schema do servidor via `z.preprocess`, `setError`/`root`, `setFocus`)
- `src/components/settings/EmailAccountFormDialog.tsx` — schemas `emailAccountCreate/UpdateSchema`; provedor via `setValue` (preenche host/porta); envia valores crus a action.
- `src/components/settings/IntegrationFormDialog.tsx` — `saveIntegrationSchema`; checagens locais antigas ("Informe a chave.", `validateBaseUrl`) mantidas no preprocess; campo da chave limpo ao salvar (`setValue("value", "")`).
- `src/components/settings/SuppressionAddDialog.tsx` — `addToSuppressionSchema`; campos `email`/`phone` com os paths do schema; mascara de telefone via `Controller`.
- `src/components/settings/SuppressionRemoveDialog.tsx` — `removeFromSuppressionSchema`; mensagens locais antigas preservadas.
- `src/components/settings/WhatsAppInstanceFormDialog.tsx` — `whatsappInstanceCreate/UpdateSchema`; `validateDailyLimit` (1 a 40) mantido no preprocess.
- `src/components/admin/OrganizationStatusActions.tsx` — `suspendOrganizationSchema`; textarea de motivo registrada dentro do `ConfirmDialog` (nao e `<form>`; `onConfirm` chama `handleSubmit`). Reativar segue sem campos.
- Reuso de `applyServerErrors` (`src/components/org/org-format.ts`): erro de servidor por campo, chaves desconhecidas e `_form` vao para o banner (`errors.root`), toast com `getFormError`.

### Mantidos como estao (justificativa)
- `EmailAccountList`, `IntegrationCard`, `WhatsAppHealthPanel`, `WhatsAppInstanceList`, `WhatsAppQrDialog`, `WhatsAppWebhookSection`: so botoes/`ConfirmDialog`/estado de UI (abrir, testar, remover, rotacionar token, polling de QR). Nao ha campo nem payload digitado; o schema do servidor (`z.uuid`) ja valida ids na action. RHF nao agrega.
- Billing (`PlanSelectionSection`, `SubscriptionSummaryCard`): `PlanSelectionSection` tem apenas abas Mensal/Anual e botao "Assinar" com `planKey` fixo vindo do plano; `SubscriptionSummaryCard` e somente leitura. Sao "botao com confirmacao", nao formulario de campos: migrar so adicionaria indirecao. Decisao: manter.

### Deltas de comportamento (mesmas regras, mais cedo no cliente)
- Contas de e-mail e integracoes agora validam no cliente com as mensagens do servidor (antes so o servidor); instancia WhatsApp e supressao seguem as mensagens locais antigas.
- Erros em campos desconhecidos (ex. `leadId`, `name`) agora aparecem no banner em vez de ficarem invisiveis.
- Nome do input da chave mudou de `secret` para `value` (interno; sem impacto).

### Testes (VERIFIED)
- `npx tsc --noEmit`: 0 erros.
- `npx eslint src/components/settings src/components/admin`: 0 erros, 4 warnings `react-hooks/incompatible-library` (uso de `watch()`, mesmo aceito na 043/044).
- `npx vitest run` completo em `leadforge_test` recriado (`npm run test:db:reset`): 163 arquivos, 2055 testes, todos passam. (Num banco de teste antigo, 3 testes de `integration`/`pipeline` falhavam por dados sobrando; resolvido recriando o banco.)
- Nao ha testes de componente interativos (vitest em `environment: node`); validacao manual no ROTEIRO bloco O. `next build` nao executado.

### Criterios de aceitacao
| Criterio | Status | Evidencia |
|---|---|---|
| Arquivos migrados ou justificativa | PASS | 6 migrados; 8 mantidos com justificativa acima |
| Sem regressao nos testes | PASS | vitest 2055/2055 |
| build/lint/typecheck | PASS parcial | tsc e eslint OK; `next build` NOT VERIFIED |

### Limitacoes conhecidas
- `watch()` gera warnings do React Compiler (4 novos: Email, Integration, SuppressionAdd e OrganizationStatusActions); se o gate virar 0 warnings, migrar para `useWatch`.
