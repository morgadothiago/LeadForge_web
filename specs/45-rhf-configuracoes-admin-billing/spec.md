# SPEC-045 — react-hook-form: Configuracoes, Integracoes, WhatsApp, Supressao, Admin, Billing
- status: APPROVED (usuario, 2026-09-27) | domain: frontend | depende de: 042 (padrao definido + validado no piloto de Auth)

## Objetivo
Migrar para o padrao da SPEC-042 os formularios de: `EmailAccountFormDialog.tsx`, `EmailAccountList.tsx`, `IntegrationCard.tsx`, `IntegrationFormDialog.tsx`, `SuppressionAddDialog.tsx`, `SuppressionRemoveDialog.tsx`, `WhatsAppHealthPanel.tsx`, `WhatsAppInstanceFormDialog.tsx`, `WhatsAppInstanceList.tsx`, `WhatsAppQrDialog.tsx`, `WhatsAppWebhookSection.tsx`, `OrganizationStatusActions.tsx` (admin), e avaliar `PlanSelectionSection.tsx`/`SubscriptionSummaryCard.tsx` (billing — sao mais botao-com-confirmacao do que formulario de campos; decidir durante a implementacao se vale migrar ou manter como esta, documentando a escolha).

## Escopo
Mesmo padrao da SPEC-042. E o maior grupo (12 arquivos) — se o volume se mostrar dificil de revisar de uma vez durante a implementacao, o dev-frontend pode propor quebrar em sub-entregas (ex.: Email/Integracoes/WhatsApp separado de Supressao/Admin/Billing), documentando a divisao no relatorio, sem precisar de nova aprovacao formal (mesma spec, mesma decisao ja aprovada). Nao mudar regra de validacao.

## Fora do escopo
Qualquer coisa em `../mobile/`. Mudanca de regra de validacao.

## Criterios de aceitacao
- [ ] Todos os arquivos listados migrados (ou justificativa documentada para os que ficarem de fora, ex. billing).
- [ ] Nenhuma regressao nos testes existentes.
- [ ] build/lint/typecheck OK.

## Ordem de execucao
dev-frontend, apos SPEC-042 `IMPLEMENTED`. Aguardando aprovacao (`APROVAR SPEC-045`).
