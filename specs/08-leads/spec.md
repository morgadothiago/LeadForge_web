# SPEC-008 — Lista e detalhe de Leads
- status: IMPLEMENTED | domain: fullstack | sessao: 1 | ordem: 9 | depende de: SPEC-001, SPEC-003, SPEC-007
## Escopo
Backend: listagem paginada server-side (cursor ou offset) com filtros campanha/stage/canal/score-min e busca nome/email (searchParams validados por Zod); CRUD manual de lead (+ criacao automatica da Opportunity `novo_lead`), importacao CSV [D13: incluir?], tags, LeadNote, mover etapa (reusa SPEC-007), validacao telefone BR (55+DDD+9+8 digitos) e normalizacao E.164 em lib pura testada.
Frontend: tabela @tanstack/react-table com status badges e filtros na URL; detalhe: ficha, timeline de Touch (in/out), tags, anotacoes, botao mover etapa, status da sequencia (ativa/pausada por resposta/opt-out) e botao pausar/retomar manual.
## Criterios de aceite
- [x] Filtros combinados retornam subconjunto correto (testes de query com seed).
- [x] Busca case-insensitive por nome/email.
- [x] Paginacao estavel; URL reflete filtros.
- [x] Telefone invalido rejeitado; valido normalizado (testes unitarios).
- [x] Duplicado (campanha+email) retorna erro amigavel.
- [x] Timeline ordenada desc com canal colorido.
- [x] Adicionar nota e tag persiste.
- [x] build/lint/typecheck OK.
## Decisoes pendentes
D13.

## Backend (implementado; status da SPEC segue APPROVED ate o frontend fechar)
Decisoes aplicadas: D6 lead em 1 campanha (campanha imutavel no updateLead), D11 stage livre, D13 sem CSV. Sem mudanca de schema/migration.

Arquivos: `src/lib/domain/phone.ts` (+test), `src/lib/domain/move-opportunity.ts` (nucleo compartilhado extraido de `actions/pipeline.ts`, contrato de `moveOpportunity` inalterado), `src/lib/schemas/lead.ts`, `src/lib/queries/leads.ts`, `src/lib/actions/lead.ts` (+`lead.test.ts`).

### Telefone (`normalizeBrPhone(raw): {ok:true,e164}|{ok:false,error}`)
Aceita mascara/espacos, `55`/`+55` opcional. Regra: DDD (11-99) + 9 + 8 digitos; so celular. Saida `+55DDD9XXXXXXXX`. Fixo e rejeitado.

### Queries (`@/lib/queries/leads`)
- `listLeads(params?: LeadListParams): Promise<LeadListResult>`; params (todos opcionais, invalidos caem no default): `campaignId` uuid, `stage` Stage, `channel` (canal do ultimo touch por createdAt), `scoreMin`/`scoreMax` >=0, `q` (nome/email/empresa, case-insensitive, <=100), `sort` `score|name|createdAt` (default createdAt), `dir` `asc|desc` (default desc), `page` (>=1, default 1), `pageSize` (1-100, default 20). Paginacao por OFFSET com desempate por id.
- `LeadListResult { items: LeadListItem[]; total; page; pageSize; pageCount }`; `LeadListItem { id,name,company,email,phone,score,tags,sequenceStatus,createdAt,campaign:{id,name},opportunity:{id,stage,value}|null,lastChannel:Channel|null }`.
- `getLead(id): Promise<LeadDetail|null>`: lead (name, company, email, phone, website, linkedin, source, score, tags, timezone, createdAt/updatedAt, campaign), `sequenceStatus, currentStepOrder, nextTouchAt, repliedAt, optedOutAt`, `opportunity {id,stage,value,lostReason,notes}|null`, `touches[]` (createdAt desc: id,channel,direction,status,scheduledAt,sentAt,repliedAt,error,content,createdAt), `notes[]` (desc), `meetings[]` (scheduledAt desc). `rawData` nao exposto.

### Actions (`@/lib/actions/lead`, todas `safeAction` + `requireUser`, retornam `ActionResult<T>`)
- `createLead(input)`: `{campaignId, name, company?, email?, phone?, website?, linkedin?, source?}` -> `{id, opportunityId}`. Cria Opportunity `novo_lead` (fim da coluna) + StageHistory. `source` default `"manual"`. Email trim+lowercase; telefone E.164. Duplicata (campanha+email / campanha+phone) -> erro em `email`/`phone`.
- `updateLead(input)`: `{leadId, ...campos opcionais}` -> `{id}`. Ausente = inalterado; `null`/`""` limpa (exceto name).
- `addTag({leadId, tag})` / `removeTag({leadId, tag})` -> `{tags: string[]}`. Tag: trim, espacos colapsados, minusculas, 1-30 chars; max 20 por lead (erro em `tag`); add duplicada e idempotente.
- `addNote({leadId, body})` (1-5000) -> `{id}`; `deleteNote({noteId})` -> `{id}`.
- `moveLeadStage({leadId, toStage, lostReason?})` -> `MoveResult {id,stage,position,changed}`. Usa `runMoveOpportunity` (mesmo nucleo de `moveOpportunity`: StageHistory, lostReason, encerramento de sequencia em fechado/perdido). Vai ao fim da coluna destino.
- `deleteLead(id)` -> `{id}`. Cascade do schema.

### Perguntas em aberto (SPEC omissa)
1. Regra de `deleteLead` (bloquear se tem Touch enviado/reuniao? soft delete?). Implementado hard delete com cascade.
2. Lead sem email e sem telefone e permitido? (implementado: permitido, so name obrigatorio).
3. Limites de tag (30 chars / 20 por lead) e pageSize max 100 sao escolhas minhas.
4. Botao pausar/retomar sequencia manual (frontend da SPEC) nao tem action; nao pedido neste escopo.
5. `score` nao editavel manualmente.

### Adendo (decisões do usuário)
1. `deleteLead`: bloqueia (erro `_form` PT-BR orientando mover para Perdido) se houver Touch com status fora de pending/scheduled/skipped (sent/delivered/failed/replied), Touch inbound ou Meeting. Sem histórico de contato: exclusão em cascata. Verificação + delete na mesma `$transaction` (Serializable); P2003 tratado. Resolve pergunta 1.
2. Contato mínimo: `createLead`/`updateLead` exigem e-mail OU telefone (erro em `email`); em `updateLead` vale sobre o estado resultante (limpar o último contato é recusado). Resolve pergunta 2.

## Implementation Notes (Frontend)
- Arquivos: `src/app/(app)/leads/{page,loading}.tsx`, `leads/[id]/{page,loading}.tsx`, `src/components/leads/*` (LeadFilters, LeadsTable, LeadFormDialog, LeadActions, LeadTags, LeadNotes, LeadTimeline, lead-format.ts + test); `PipelineCard.tsx` (nome do lead vira link p/ `/leads/[id]`).
- Testes: vitest 122/122 (VERIFIED), tsc e lint limpos, build OK; curl 200 em /leads, ?q=a&page=1, ?campaignId=..., /leads/<id seed>.
- Decisoes: tabela HTML propria (server) em vez de @tanstack/react-table, pois filtros/ordenacao/paginacao sao server-side via URL; mobile vira cards; link real na linha (after:inset-0); ordenacao por cabecalho com aria-sort; faixa de score = min/max numericos; criar/editar em dialog; mover etapa reutiliza LostReasonDialog.
- Limitacoes: pausar/retomar sequencia manual nao implementado (sem action, ver pergunta 4); regra de bloqueio de deleteLead depende do backend (mensagem `_form` exibida no ConfirmDialog); teste visual mobile/desktop nao feito em navegador.
