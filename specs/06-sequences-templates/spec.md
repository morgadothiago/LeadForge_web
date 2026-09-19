# SPEC-006 — Sequences (builder) + Templates
- status: IMPLEMENTED | domain: fullstack | sessao: 1 | ordem: 7 | depende de: SPEC-001, SPEC-003, SPEC-005
## Escopo
Backend: CRUD Sequence/SequenceStep/MessageTemplate; duplicar sequencia (copia steps); validar: dias nao decrescentes, `order` unico, template do mesmo canal e da mesma campanha [D10: templates por campanha vs globais]; variaveis permitidas `{{name}}`, `{{company}}`, ... (lib `renderTemplate` pura, testavel). Sequencia default 0,2,5,7,10 no seed.
Frontend: builder visual de steps (dia + canal + template), reordenar (dnd-kit), preview renderizado com lead exemplo, duplicar, editor de templates com contador e variaveis.
## Criterios de aceite
- [x] Criar sequencia com steps 0/2/5/7/10 e persistir na ordem.
- [x] Duplicar gera nova sequencia independente (ids novos).
- [x] `renderTemplate` substitui variaveis; variavel desconhecida gera erro de validacao (testes unitarios).
- [x] Nao permite remover template usado por step (Restrict) com mensagem.
- [x] Preview mostra texto final por step.
- [x] Reordenar via teclado funciona (dnd-kit sensors).
- [x] build/lint/typecheck OK.
## Decisoes pendentes
D10.

## Backend (implementado; status segue APPROVED até o frontend fechar)
Arquivos: `src/lib/templates/render.ts`, `src/lib/schemas/{template,sequence}.ts`, `src/lib/actions/{template,sequence}.ts`, `src/lib/queries/sequences.ts`, testes `render.test.ts` e `sequence.test.ts`. Sem mudança de schema Prisma.
Todas as actions: `ActionResult<T>`, `requireUser()`, erros PT-BR por campo (`steps.<i>.day`, `steps.<i>.templateId`, `_form`).
- `renderTemplate(body, vars, {channel?, field?: "subject"|"body"}) -> {ok:true,text,missing[]} | {ok:false,unknown[]}`. Variáveis: `name, firstName, company, email, phone, website`. Desconhecida = erro (nada renderiza). Conhecida sem valor = `""` + listada em `missing`. Passo único (valores nunca reprocessados = sem injeção); remove caracteres de controle; subject vira linha única (sem CR/LF/U+2028/9); body normaliza CRLF. Texto puro (sem HTML).
- Templates: `createTemplate`, `updateTemplate`, `deleteTemplate`, `previewTemplate` (rascunho, lead exemplo). E-mail exige `subject`; outros canais proíbem. Variáveis validadas no schema. Template usado em step: não exclui (mensagem com sequências), não troca canal nem campanha.
- Sequências: `createSequence({name, steps[{day,channel,templateId}]})`, `renameSequence`, `saveSequenceSteps({sequenceId, steps[{id?,day,channel,templateId}]})` (substitui lista, preserva ids, transação, ordem = índice), `reorderSteps({sequenceId, stepIds})` (permutação completa, transação em 2 fases por causa do `@@unique`), `duplicateSequence(id)` (nome "(cópia)", steps novos, templates compartilhados), `deleteSequence(id)`.
- Regras: dias não decrescentes; canal do step == canal do template; todos os templates de uma sequência da MESMA campanha (Sequence não tem campaignId; interpretação da regra "mesma campanha" com sequência N campanhas). Edição de sequência em uso por campanha ativa é permitida e retorna `activeCampaigns` (aviso p/ UI); exclusão é bloqueada se houver campanha ativa (paused/archived ficam com sequência nula via SetNull).
- Queries: `listSequences`, `getSequence`, `listTemplates(campaignId, channel?)`, `previewSequence(id, lead?)` (lead exemplo `SAMPLE_LEAD`).
- Testes: 57 passando (vitest, DB 5434), typecheck e lint limpos.

## Implementation Notes — hardening de erros (safeAction)
- Todas as actions de `src/lib/actions/{sequence,template}.ts` agora executam dentro de `safeAction` (assinaturas e tipos de retorno inalterados). UnauthorizedError -> "Sessão expirada"; Prisma P2025/P2003/P2002 -> mensagens PT-BR; demais -> genérica; detalhe só em `console.error` no servidor.
- Corrida: `deleteSequence` faz contagem de campanhas ativas + delete na mesma `$transaction`; `saveSequenceSteps`/`reorderSteps` já são transacionais (falha P2002/P2025 em qualquer fase vira ActionResult e faz rollback); `deleteTemplate` cai em P2003 (Restrict) -> "Operação inválida..." caso um passo seja criado entre checagem e delete.
- Testes novos em `sequence.test.ts`: UnauthorizedError, P2025 sem vazar mensagem, sequência inexistente, conflito P2002 do `@@unique([sequenceId, order])` (simulado via $transaction rejeitada). typecheck, lint e 61 testes VERIFIED.
- Limitação: o conflito de unique é simulado (mock), não provocado por concorrência real.

## Implementation Notes (Frontend)
- Arquivos: `src/app/(app)/sequences/{page,loading}.tsx`, `nova/page.tsx`, `[id]/page.tsx`, `templates/page.tsx`; `src/components/sequences/{SequenceBuilder,StepRow,SequenceActions,TemplateManager,load-options,types}`.
- Builder: dnd-kit (PointerSensor + KeyboardSensor), botões subir/descer, anúncios pt-BR + aria-live; dias ajustados automaticamente na reordenação e salvos via `saveSequenceSteps` (não usa `reorderSteps`); templates filtrados pela campanha do 1º template; aviso `activeCampaigns`; preview por step via `previewTemplate` (lead de exemplo).
- Validação: typecheck, lint, 61 testes, build OK; curl 200 em /sequences, /sequences/nova, /sequences/<seed>, /sequences/templates.
- Limitações: reordenação por teclado/dnd verificada por código, sem teste E2E; backend revalida `/sequencias` (rota real é `/sequences`), então a UI depende de `router.refresh()`.
