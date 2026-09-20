# SPEC-025 — Mobile: telas de monitoramento (somente leitura)
- status: DRAFT | domain: mobile | agente: rn-expo-senior-dev | depende de: SPEC-022, SPEC-024, SPEC-023 (Alertas por polling) | bloqueia: 026
## Objetivo
Abas de acompanhamento. Nenhuma acao de escrita alem de "marcar alerta como lido".
## Telas
- **Resumo** (aba inicial): periodo 7d/30d; cards de leads novos/contatados/respondidos/opt-out, taxa de resposta, enviadas hoje vs limite (barra), reunioes; faixa "Atencao" (alertas nao lidos, handoffs, rascunhos, falhas de envio); saude em 4 chips (WhatsApp, Scheduler, Agentes, Busca) com cor + icone + texto (nunca so cor); pull-to-refresh; polling 60 s em foreground.
- **Campanhas**: lista de campanhas em andamento (enviados, respostas, taxa, proximo envio) e detalhe com serie 7d (grafico simples acessivel, com resumo textual).
- **Pipeline**: funil por stage (barras horizontais + numeros).
- **Alertas**: lista por severidade, nao lidos primeiro, marcar lido/todos, detalhe do alerta com o estado atual (ex.: instancia, scheduler), abre por deep link.
- **Saude** (dentro de Resumo ou aba propria, D-M-UX): instancias WhatsApp (status, saude, aquecimento, enviadas/limite, alertas de banimento/opt-out; numero mascarado), Scheduler (ultima rodada, parado?), Agentes (gasto vs teto, kill switch estado, rascunhos, "Precisa de voce"), Busca de leads (ultimas execucoes).
## Criterios de aceite
1. Cada tela tem quatro estados renderizados e testados: loading, sucesso, vazio, erro (+ offline com selo).
2. Numeros exibidos = payload da API (teste de componente com fixtures da SPEC-022; formatacao pt-BR, `null` -> "—").
3. Nenhuma tela mostra telefone/e-mail; numeros de instancia mascarados; nenhuma lista de leads.
4. Semaforo de saude usa cor+icone+texto; leitor de tela le "WhatsApp: desconectado, alerta critico".
5. Fonte 200% nao corta conteudo; alvos >= 44 pt; contraste AA em claro/escuro.
6. Polling pausa em background e retoma ao voltar; sem requests concorrentes duplicados.
7. Marcar lido atualiza contador da aba imediatamente (otimista com rollback em erro).
8. Nenhum dado com nome de lead persistido em disco (verificacao do cache).
## Testes obrigatorios
RNTL por tela/estado, formatadores, hooks de polling (timers falsos), a11y roles/labels, snapshot de payload sem PII.
## Seguranca / LGPD
Somente agregados/mascarados; deep link de alerta valida uuid e exige sessao.
## Fora do escopo
Aprovacoes e acoes (026); listas/detalhe de leads; editar qualquer coisa.
## Limitacoes de validacao
Sem simulador: layout/graficos e leitor de tela reais (VoiceOver/TalkBack) PENDENTES do usuario.
