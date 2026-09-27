# SPEC-044 — react-hook-form: Sequences, Templates, Agentes, Calendario
- status: APPROVED (usuario, 2026-09-27) | domain: frontend | depende de: 042 (padrao definido + validado no piloto de Auth)

## Objetivo
Migrar para o padrao da SPEC-042 os formularios de: `SequenceBuilder.tsx`, `TemplateManager.tsx`, `AgentsPanel.tsx`, `DraftQueue.tsx`, `MeetingDialog.tsx`.

## Escopo
Mesmo padrao da SPEC-042. Nao mudar regra de validacao.

## Fora do escopo
Qualquer coisa em `../mobile/`. Mudanca de regra de validacao.

## Criterios de aceitacao
- [ ] Todos os 5 arquivos migrados, mesmo comportamento de validacao client+server de antes.
- [ ] Nenhuma regressao nos testes existentes.
- [ ] build/lint/typecheck OK.

## Ordem de execucao
dev-frontend, apos SPEC-042 `IMPLEMENTED`. Aguardando aprovacao (`APROVAR SPEC-044`).
