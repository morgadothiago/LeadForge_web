# SPEC-017 — Politica de envio (gentil + anti-banimento) e supressao global
- status: APPROVED (usuario, 2026-09-19) | domain: fullstack | sessao: 2 | ordem: apos SPEC-012, antes/junto de SPEC-013 | depende de: SPEC-010, SPEC-011, SPEC-012
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
