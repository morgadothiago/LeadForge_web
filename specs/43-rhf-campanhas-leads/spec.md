# SPEC-043 — react-hook-form: Campanhas, ICP, Leads
- status: APPROVED (usuario, 2026-09-27) | domain: frontend | depende de: 042 (padrao definido + validado no piloto de Auth)

## Objetivo
Migrar para o padrao `react-hook-form`+`zodResolver` definido/validado na SPEC-042 os formularios de: `CampaignForm.tsx`, `IcpFields.tsx`, `IcpManager.tsx`, `CampaignLeadSearch.tsx`, `CampaignStartSequence.tsx`, `LeadFormDialog.tsx`, `PossibleOptOutAlert.tsx`.

## Escopo
Mesmo padrao da SPEC-042 (`useForm({resolver: zodResolver(schema)})` com o schema Zod ja usado na action correspondente, erro de servidor via `setError`/`getFormError`, mesmo comportamento de validacao de hoje). Nao mudar regra de validacao.

## Fora do escopo
Qualquer coisa em `../mobile/`. Mudanca de regra de validacao.

## Criterios de aceitacao
- [ ] Todos os 7 arquivos migrados, mesmo comportamento de validacao client+server de antes.
- [ ] Nenhuma regressao nos testes existentes.
- [ ] build/lint/typecheck OK.

## Ordem de execucao
dev-frontend, apos SPEC-042 `IMPLEMENTED`. Aguardando aprovacao (`APROVAR SPEC-043`).
