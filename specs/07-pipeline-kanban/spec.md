# SPEC-007 — Pipeline Kanban
- status: IMPLEMENTED | domain: fullstack | sessao: 1 | ordem: 8 | depende de: SPEC-001, SPEC-003 (dados via seed; leads reais via SPEC-008)
## Escopo
Backend: query de oportunidades agrupadas por stage (filtro campanha); Server Action `moveOpportunity(id, stage, position?)` com validacao de transicao [D11: livre ou regras]; mover para `perdido` pede motivo opcional; `reuniao_agendada` cria Meeting opcional (fora: calendario). Ordenacao intra-coluna: `Opportunity.position` (adicionar em SPEC-001 se aprovado) ou por updatedAt [D12].
Frontend: 7 colunas (Fechado e Perdido separados) com cor e contagem, dnd-kit, update otimista com rollback em erro, estilo drag (opacity-50, scale-105, drop zone tracejada primary), card com nome/empresa/canal/score, click abre detalhe (SPEC-008).
## Criterios de aceite
- [ ] Arrastar card muda stage no banco (teste de action) e persiste apos reload.
- [ ] Falha na action reverte UI e mostra toast.
- [ ] Contagens por coluna corretas; filtro por campanha funciona.
- [ ] Acessivel por teclado (mover card com setas/space).
- [ ] 1 query agrupada, sem N+1.
- [ ] build/lint/typecheck OK.
## Decisoes pendentes
D11, D12.

## Adendo (autorizado pelo usuario) - StageHistory
- Helper pronto: `src/lib/domain/stage-history.ts` -> `recordStageChange(tx, opportunityId, from, to, changedAt?)`. Ao mover card, chamar dentro da mesma `$transaction` que atualiza `Opportunity.stage`. Ignora from === to. Sem isso o dashboard nao enxerga a mudanca.

## Backend (implementado)
Arquivos: `src/lib/schemas/pipeline.ts`, `src/lib/queries/pipeline.ts`, `src/lib/actions/pipeline.ts` (+ `pipeline.test.ts`).
- `getPipelineBoard({campaignId?, q?}) -> BoardColumn[]` (7 colunas fixas na ordem Novo Lead, Contactado, Em Follow-up, Interessado, Reuniao Agendada, Fechado, Perdido). Coluna: `{stage,label,count,totalValue,cards[]}`. Card: `{id,stage,position,value,notes,lead{id,name,company,score},channel,campaign{id,name}}`. `channel` = canal do ultimo Touch do lead (null se nenhum). Ordem `position, createdAt, id`. Busca (`q`) insensivel em lead.name/company/email. Contadores/soma refletem filtro+busca. 1 query Prisma (touch via select aninhado). Sem limite/paginacao por coluna (SPEC omissa).
- `moveOpportunity({opportunityId, toStage, toIndex, campaignId?}) -> ActionResult<{id,stage,position,changed}>`: stage livre (D11); uma `$transaction` Serializable; reindexa coluna destino e origem 0..n-1; `recordStageChange` na mesma tx; `toIndex` > tamanho vira fim; no-op (`changed:false`, sem revalidacao) se mesma coluna e mesmo indice. `campaignId` opcional = escopo da coluna (filtro do board); se informado e diferente da campanha da oportunidade, erro. Oportunidade inexistente -> erro `_form` PT-BR; conflito de serializacao (P2034) -> pede recarregar. Revalida `/pipeline` e `/`.
- `updateOpportunity({opportunityId, value?, notes?}) -> ActionResult<{id}>`: value >= 0 ou null; notes trim, vazio -> null.
- Nao implementado (SPEC ambigua): motivo de `perdido`, criacao de Meeting em `reuniao_agendada`, efeitos na sequencia do lead.

## Implementation Notes (Frontend)
- Arquivos: `src/app/(app)/pipeline/{page,loading,error}.tsx`; `src/components/pipeline/{PipelineBoard,PipelineColumn,PipelineCard,EditOpportunityDialog}.tsx`, `board-state.ts` (+ `.test.ts`).
- Page Server Component (searchParams assincrono, form GET sem JS). Board client: dnd-kit (PointerSensor distancia 6 + KeyboardSensor, alca de arrastar dedicada, anuncios aria-live PT-BR), menu "Mover para..." por card (alternativa nao-drag), update otimista via `applyMove` puro com rollback + toast (`_form`) + `router.refresh()`, `campaignId` do filtro enviado em toda chamada, `changed:false` sem tratamento extra (nao reverte). Dialog de edicao de valor/notas.
- Testes: vitest 76/76 (7 novos, logica pura) VERIFIED; tsc, lint, build VERIFIED; curl 200 em /pipeline, ?campaignId=seed, ?q=a VERIFIED.
- Criterios: persistencia/teste de action (backend, pipeline.test.ts) PASS; rollback+toast PASS (codigo, sem teste de UI); contagens/filtro PASS; teclado PASS (implementado, NOT VERIFIED manualmente em browser); 1 query PASS; build/lint/typecheck PASS.
- Limitacoes: click no card para detalhe (SPEC-008) nao implementado (pagina de lead inexistente); sem motivo de perda/Meeting/pausa de sequencia; dnd sem previa ao vivo entre colunas (move ao soltar); nao testado visualmente em browser.

## Adendo (autorizado pelo usuario) - Motivo de perda e efeito na sequencia
- `Opportunity.lostReason String?` (migration `opportunity_lost_reason`). `moveOpportunity` aceita `lostReason?: string|null` OPCIONAL (trim, max 500, vazio -> null); contrato anterior intacto. Gravado somente com `toStage=perdido` (mesmo stage perdido com motivo diferente atualiza o motivo, `changed:true`); ao mover PARA FORA de perdido, limpa para null; outros stages ignoram o campo.
- `BoardCard.lostReason?: string | null` (aditivo, opcional no tipo para nao quebrar literais existentes; a query sempre preenche).
- Ao mover para `fechado` ou `perdido` (stage realmente mudou), na MESMA `$transaction` Serializable: `Lead.sequenceStatus = completed` (exceto `opted_out`, preservado), `nextTouchAt = null`, Touches `pending`/`scheduled` do lead -> `skipped` (TouchStatus NAO tem `cancelled`; `skipped` e o equivalente). Nao toca `repliedAt`/`optedOutAt`. Idempotente (no-op nao escreve). Nota: lead `paused_replied` vira `completed` (repliedAt preservado).
- Reabrir (mover para stage aberto) NAO reativa a sequencia automaticamente; reativacao e acao manual futura.

## Implementation Notes (UI do adendo motivo de perda) 
- Novo `LostReasonDialog.tsx` (Dialog "Motivo da perda (opcional)", textarea 500 com contador aria-live, foco automatico na textarea, Esc/Cancelar = nao move, botoes Confirmar e "Perder sem motivo"). `PipelineBoard` intercepta qualquer move para `perdido` vindo de outra coluna (drag, teclado, menu "Mover para...") e so aplica update otimista + `moveOpportunity({lostReason})` apos confirmar; rollback/toast de erro mantidos. Toast de sucesso com descricao "Sequencia automatica encerrada." ao fechar/perder.
- `board-state.ts`: `MoveIntent.lostReason?`, `nextLostReason`, `needsLostReason` (+2 testes). Card em Perdido mostra "Motivo: ..." truncado com title; EditOpportunityDialog exibe motivo somente leitura.
- Criterios de UI: dialogo pre-move PASS; cancelar nao move PASS (codigo); motivo no card/edicao PASS; toast sequencia PASS. Verificado: tsc, lint, vitest, build. NOT VERIFIED em browser.
- Limitacao: reordenar dentro de Perdido nao reabre dialogo (motivo preservado).

## Implementation Notes (correcao do retry Serializable, QA SPEC-013 A1)
- O retry de `runMoveOpportunity` so capturava `PrismaClientKnownRequestError` P2034; com adapter-pg o conflito e `DriverAdapterError` (`TransactionWriteConflict`), entao nao havia tentativa e `pipeline.test.ts > movimentos concorrentes` falhava ~2/3. Agora usa `withSerializableRetry`/`isRetryableTxConflict` (`src/lib/db/tx-conflict.ts`, unificado com tags, deleteLead, stopSequence, suppression, confirmOptOut, webhook WhatsApp). Esgotadas as 6 tentativas -> `conflict` ("O quadro foi alterado por outra acao..."). O teste exige os 4 movimentos ok e posicoes integras.
- VERIFIED: teste concorrente 10/10 e `pipeline.test.ts` inteiro 10/10; `npm test` 2x (614 testes) OK.
