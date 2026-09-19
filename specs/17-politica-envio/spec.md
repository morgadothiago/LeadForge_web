# SPEC-017 — Politica de envio (gentil + anti-banimento) e supressao global
- status: IMPLEMENTED (backend + frontend, 2026-09-19; itens com navegador/Evolution reais PENDENTES) | aprovada pelo usuario 2026-09-19 | domain: fullstack | sessao: 2 | ordem: apos SPEC-012, antes/junto de SPEC-013 | depende de: SPEC-010, SPEC-011, SPEC-012
## Objetivo
Contatar sem incomodar (uma recusa ou aceite deve ser sempre facil e respeitada) e proteger o numero de WhatsApp contra denuncia/banimento. NAO ha garantia contra banimento: Baileys e nao-oficial e os limites do WhatsApp nao sao publicos; os numeros abaixo sao pontos de partida conservadores, calibrados por monitoramento.
## Decisoes do usuario (2026-09-19)
- Canal inicial: **WhatsApp primeiro** (contra a recomendacao de e-mail primeiro; risco aceito). Compensacao: aquecimento mais lento e primeiro toque de baixa pressao (abaixo).
- Limite: **3 toques por lead no WhatsApp em ~14 dias** (dias 0, 4, 10; minimo 3 dias entre eles). Depois sai da cadencia de WhatsApp (pode seguir so no e-mail).
- **Lista de supressao global** por telefone e e-mail, consultada antes de qualquer envio, todos os canais e campanhas.
## Escopo
### 1. Supressao global
- Modelo `Suppression` (id, kind phone|email, value normalizado E.164/lowercase, reason: opt_out_reply|opt_out_link|opt_out_manual|possible_opt_out_confirmed|bounce|manual, leadId?, createdAt), `@@unique([kind, value])`, migration.
- Toda origem de opt-out grava aqui (webhook SPEC-012 automatico e `confirmOptOut`, link de descadastro SPEC-010, acao manual "Adicionar a supressao" na ficha do lead).
- `isSuppressed({email?, phone?})` chamado ANTES de reservar o Touch em `sendEmail` e `sendWhatsApp` (falha tratada como `skipped` com motivo "suprimido", sem chamar provider) e na criacao/edicao de lead (createLead/updateLead: aviso claro PT-BR se o contato ja esta suprimido; permitir criar o lead mas marcado e sem envio, ou bloquear com mensagem — escolher e documentar). Backfill: opt-outs ja existentes (Lead.optedOutAt) entram na tabela por migration/seed idempotente.
### 2. Cadencia gentil (WhatsApp)
- Sequencia de WhatsApp limitada a 3 toques/lead/14 dias, minimo 3 dias entre toques, contados por Touch outbound whatsapp; regra aplicada no envio (nao so no builder de sequencias): 4o toque -> `skipped` "limite de toques".
- Janela de horario: seg-sex, 9h-12h e 14h-17h no fuso do lead (mais restrita que a 8h-18h da SPEC-011); sem feriados nacionais (lista simples anual em constante). Fim de semana/feriado -> reagenda proximo dia util.
- Nunca dois canais no mesmo dia para o mesmo lead.
- Toque 1 = pergunta curta de baixa pressao, sem link e sem anexo, identifica remetente e motivo, termina com saida facil ("Se nao fizer sentido, e so responder NAO"). Validador de template do 1o toque de WhatsApp: rejeita/avisa URL, anexo, mais de N caracteres (~350), palavras promocionais de spam (lista configuravel) e falta de linha de saida no toque 1 (aviso, nao bloqueio).
- Resposta e binaria e humana: qualquer resposta pausa (SPEC-012); "sim" gera alerta para o usuario assumir; "nao" encerra e suprime. NENHUMA resposta automatica de bot.
### 3. Aquecimento e comportamento humano (por instancia)
- Rampa de `dailyLimit` efetivo por idade da instancia (dias desde `connectedAt` da 1a conexao; campo `warmupStartedAt`): dias 1-3: 3/dia; 4-7: 6; semana 2: 12; semana 3: 20; semana 4+: teto configuravel (default 30, maximo 40). `dailyLimit` configurado e o TETO; efetivo = min(teto, rampa). So sobe se a saude estiver "boa"; se o disjuntor disparar, a rampa reinicia em degrau anterior.
- Intervalo aleatorio 45-180 s entre mensagens da instancia; rajadas de ate 5 seguidas de pausa aleatoria de 10-20 min; delay de digitacao 1-3 s (ja existe).
- Variacao de texto: template aceita 2-3 variantes por passo (ou spintax simples `{a|b|c}` validado) sorteadas deterministicamente por lead; sem mensagens identicas em massa.
- Verificar se o numero tem WhatsApp ANTES do 1o envio (`WhatsAppProvider.checkNumbers(numbers)`; Evolution: endpoint de verificacao de numeros — confirmar na v2.1.1, PENDENTE sem Evolution real); resultado cacheado em `Lead.hasWhatsapp Boolean?` + `whatsappCheckedAt`; sem WhatsApp -> `skipped` "numero sem WhatsApp" e o lead segue so por e-mail.
### 4. Saude da instancia e disjuntor
- Metricas por instancia (janela dos ultimos 50 envios e 7 dias): taxa de entrega (MESSAGES_UPDATE), falhas consecutivas, quedas/logout de conexao, taxa de resposta, taxa de opt-out ("parar"/possivel opt-out).
- Estado `health`: good | warning | paused. Pausa AUTOMATICA por 24-48 h + alerta (badge/toast/e-mail ao usuario) se: evento de logout/desconexao forcada, 2+ falhas consecutivas de envio, entrega < 80% nos ultimos 20, ou opt-out/possivel opt-out > 5% dos ultimos 50. Retomada manual ou automatica apos o prazo com rampa reduzida. `sendWhatsApp` respeita `health=paused` (Touch fica `scheduled`).
- Tela Configuracoes > WhatsApp: painel de saude (estado, aquecimento "dia X, limite hoje N", ultimas metricas, motivo da pausa) e botao "Retomar".
### 5. Recomendacoes operacionais (documentar na tela/README, nao enforceable)
Chip dedicado e descartavel (nunca o numero principal), idealmente com historico normal de uso; perfil completo (foto, nome da empresa); contatos de cadastro publico de empresa; base legal LGPD (interesse legitimo B2B) com identificacao do remetente e opt-out facil; migracao futura para API oficial (Cloud API) via provider plugavel se o volume crescer.
## Criterios de aceite
- [ ] `isSuppressed` bloqueia envio em e-mail e WhatsApp (teste com provider/transport fake: nao chama provider; Touch skipped com motivo).
- [ ] Opt-out por WhatsApp, por link e manual gravam em Suppression; lead novo com mesmo telefone/e-mail em OUTRA campanha nao recebe envio.
- [ ] 4o toque de WhatsApp em 14 dias e bloqueado; intervalo minimo de 3 dias respeitado; nunca dois canais no mesmo dia.
- [ ] Janela seg-sex 9-12/14-17 no fuso do lead e feriados testados (limites, DST/fusos).
- [ ] Rampa de aquecimento: efetivo = min(teto, rampa) por idade da instancia (testes por dia 1,4,8,15,22,30).
- [ ] Intervalo 45-180 s e rajadas com pausa: funcao pura `nextAllowedSendAt` atualizada e testada (rng injetavel).
- [ ] Variantes/spintax: sorteio deterministico por lead, validacao de sintaxe.
- [ ] Validador do 1o toque (URL, tamanho, linha de saida) com testes.
- [ ] Disjuntor: cada gatilho pausa a instancia e o envio respeita `paused` (testes); retomada reinicia a rampa.
- [ ] `checkNumbers` no provider (fake nos testes); sem WhatsApp -> skipped. Real com Evolution: PENDENTE.
- [ ] Nenhuma resposta automatica enviada apos resposta do lead (teste).
- [ ] build/lint/typecheck OK; requireUser nas actions novas.
## Limitacoes/riscos (honestos)
Sem garantia contra banimento; limites do WhatsApp nao sao publicos e podem mudar; Baileys viola os termos do WhatsApp; risco maior por ser WhatsApp primeiro (escolha do usuario); metricas de "denuncia/bloqueio" nao sao visiveis (usa-se opt-out e entrega como proxy); rate limits em memoria; scheduler (SPEC-013) precisa serializar envios por instancia (intervalo e teto dependem disso).

## Backend (implementado 2026-09-19; status da SPEC continua APPROVED ate o frontend fechar)
### Decisoes
- createLead/updateLead: PERMITE criar/editar lead com contato suprimido; o resultado traz `suppressed: true` (aditivo) e todo envio fica bloqueado (Touch `skipped` "suprimido"). `LeadListItem.suppressed?` e `LeadDetail.suppressed?` (+ `hasWhatsapp?`, `whatsappCheckedAt?`) tambem aditivos.
- Supressao cobre e-mail E telefone do lead em toda origem (opt-out por resposta, `confirmOptOut`, link `/api/webhooks/unsubscribe`, acao manual). Ja existente = mantem o motivo original. `removeFromSuppression` nao reabre leads ja encerrados; so libera o contato.
- Janela 9-12/14-17 seg-sex substitui a de 8-18 (SPEC-011). Feriados: `src/lib/whatsapp/holidays.ts` (fixos federais + Carnaval seg/ter, Sexta Santa, Corpus Christi por calculo de Pascoa; avaliados na data LOCAL do lead; sem feriados estaduais/municipais).
- Rampa (`warmup.ts`): dia 1-3: 3; 4-7: 6; 8-14: 12; 15-21: 20; 22+: teto (default 30, max 40). `warning` desce 1 degrau; `paused` = 0. Retomada recua 1 degrau (`warmupStartedAt` reescrito) e zera a janela de metricas (`healthResetAt`).
- Saude (`health.ts`): pausa 24h (falhas >= 2 consecutivas; entrega < 80% nos ultimos 20 com amostra >= 10 e envios com >= 10 min; opt-out/possivel opt-out > 5% com amostra >= 20 leads) e 48h (desconexao de instancia que estava `connected`, via CONNECTION_UPDATE). `warning`: 1 falha, entrega < 90%, opt-out > 2% (amostra >= 10). Alertas em `InstanceAlert` (sem e-mail). Retomada automatica ao vencer `pausedUntil` (no `sendWhatsApp` e em `evaluateAllInstances`, para o scheduler SPEC-013).
- `nextAllowedSendAt(recentSentAts[], now, rng?)`: 45-180 s; rajada de 5 (envios com intervalos < 10 min) -> pausa 10-20 min; rng default semeado no ultimo envio (sorteio estavel entre tentativas).
- Spintax `{a|b|c}` (sem aninhamento) expandido ANTES de `{{var}}`, semente `leadId:stepId`; validado no schema de template do WhatsApp.
### Contrato para o frontend (tudo aditivo)
- Actions novas: `addToSuppression({leadId?|email?|phone?, reason?: opt_out_manual|manual|bounce, note?})`, `removeFromSuppression({id, reason, confirm: true})`, `resumeInstance(instanceId)` -> `{id, resumed}`, `dismissInstanceAlerts(instanceId)`.
- Queries novas: `listSuppressions({kind?,q?,page?,pageSize?})`, `isContactSuppressed({email?,phone?})`, `getInstanceHealth(instanceId)`, `listUnreadInstanceAlerts()`.
- Campos aditivos: `createLead`/`updateLead` -> `suppressed?`; `createTemplate`/`updateTemplate` -> `warnings: string[]`; `previewTemplate` -> `warnings?`; `WhatsAppInstance.health/pausedUntil/pausedReason/warmupStartedAt`; `dailyLimit` agora <= 40.
- Env: `WHATSAPP_PROMO_WORDS` (opcional).
### PENDENTE
- Evolution real v2.1.1: `POST /chat/whatsappNumbers/{instance}` (`checkNumbers`) nao verificado; comportamento de CONNECTION_UPDATE/logout e de MESSAGES_UPDATE (taxa de entrega) idem. Criterios com Evolution real seguem PENDENTES.

## Frontend (implementado 2026-09-19)
### Criterios de UI
- [x] Limite diario 1-40 no formulario de instancia (validacao local `validateDailyLimit`, dica "teto, nao o valor de hoje", rampa exibida) — teste `health-format.test.ts`.
- [x] Painel de saude por instancia (estado com icone+texto, dia de aquecimento, barra `role=progressbar`, pausa "ate <data> por: <motivo>", metricas com "dados insuficientes", warnings, alertas + Dispensar, Retomar envios com ConfirmDialog, toasts, `router.refresh()`).
- [x] Faixa global `HealthBanner` (alertas nao lidos) no layout `(app)`, com Suspense e falha isolada (guarda de auth intacta).
- [x] `/configuracoes/supressao` (aba, filtros GET, paginacao, mascara/revelar, motivos PT-BR, skeleton, vazio, adicionar, remover com motivo >= 5 + checkbox `confirm` + aviso LGPD).
- [x] Leads: badge "Suprimido" (lista e ficha), "Tem WhatsApp", botao "Adicionar a supressao" com ConfirmDialog, aviso de `suppressed: true` ao criar/editar.
- [x] Templates: avisos (`warnings`) do preview (role=status) e toast apos salvar; erros de spintax via `errors.body`; dica de sintaxe.
- [x] Token `--warning`/`--warning-foreground` (contraste AA testado); `text-stage-contactado` substituido como cor de aviso.
- [ ] PENDENTE: verificacao visual em navegador (mobile/tablet/desktop) e fluxos autenticados; Evolution real.
### Implementation Notes
- Arquivos: `src/components/settings/{health-format,suppression-format}.ts(+test)`, `WhatsAppHealthPanel`, `Suppression{List,AddDialog,RemoveDialog,Filters}`, `SettingsTabs`, `WhatsAppInstance{FormDialog,List}`; `src/components/layout/HealthBanner.tsx`; `src/components/leads/{SuppressedBadge,LeadActions,LeadFormDialog,LeadsTable,lead-format}`; `src/components/sequences/TemplateManager.tsx`; `src/app/(app)/configuracoes/{supressao,whatsapp}`, `(app)/layout.tsx`, `leads/[id]/page.tsx`; `globals.css`; `design-tokens.test.ts`.
- Saude carregada no Server (uma `getInstanceHealth` por instancia, em paralelo, falha isolada) porque `getInstanceHealth` e query (nao action); sem polling. Metricas em bloco expansivel.
- Banner global usa so alertas nao lidos (nao ha query de instancias pausadas alem da view de saude); alertas sao criados na pausa.
- Templates: avisos pos-salvamento via toast (o formulario fecha ao salvar); avisos persistentes no preview.
- Validacao: tsc, eslint, vitest (501 testes) OK; rotas novas respondem 307 sem cookie. `next build` nao executado (regra).

## Implementation Notes - correcoes do QA (2026-09-19)
- M2 `channels/reserve.ts` (novo) + `whatsapp.ts`/`email.ts`: (a) Touch `failed` com erro iniciado por `NEEDS_REVIEW_PREFIX` (timeout do WhatsApp) NAO e reservado automaticamente; reenvio so pela action `retryTouch({touchId, confirm:true})` (requireUser) em `actions/whatsapp-health.ts`, que devolve o Touch a `scheduled` (sem coluna nova); (b) `leadStopped` relê o lead do banco logo antes do provider/SMTP: `repliedAt > touch.createdAt` ou sequenceStatus paused_replied/opted_out/completed -> `skipped` "lead respondeu/sequencia encerrada" (reason `replied`), tambem no inicio do doSend; (c) invariante estatica cobre `channels/whatsapp.ts` (um unico sendText, precedido de `leadStopped`; sem import de inbound) e teste comportamental "inbound entre reserva e envio" (WhatsApp e e-mail).
- M3 `health.ts`: maquina pura `connectionTransition`/`decideDisconnectPause`. Logout confirmado -> pausa 48 h imediata; queda simples -> `WhatsAppInstance.disconnectedAt`, pausa (48 h) so se persistir >= N min (default 10, env `WHATSAPP_DISCONNECT_GRACE_MINUTES`) ao rodar `evaluateInstanceHealth`/`evaluateAllInstances`; reconexao limpa a marca sem pausa e cria no maximo 1 `warning`. PENDENTE: formato real do logout na Evolution v2.1.1.
- B7: consulta de supressao movida para ANTES da reserva (Touch suprimido vai direto a `skipped`, nunca passa por `sending`); mantida tambem no doSend.
- B8 `unsubscribe.ts`: lead + touches + `addSuppression(tx)` na mesma `$transaction` (teste de atomicidade).
- B9: migration `20260919200000_disconnected_at_backfill_fix` (idempotente) completa o backfill: telefone normalizado para E.164 e `sequenceStatus=opted_out` sem `optedOutAt`; a 180000 nao foi editada. Testada executando o SQL 2x.
- Migrations novas: `20260919200000_disconnected_at_backfill_fix` (coluna `disconnectedAt` + backfill).
- Validacao: prisma validate, migrate status (up to date), tsc, eslint, vitest 518/518 OK. `next build` nao executado.
