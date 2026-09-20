# SPEC-026 — Mobile: acoes de gestao leves + push no app (backend minimo + app)
- status: DRAFT | domain: fullstack (dev-backend primeiro: endpoints POST; depois rn-expo-senior-dev) | depende de: SPEC-021, 023, 025 | ultima da serie
## Objetivo
Permitir SO acoes de gestao leves, reversiveis e seguras, mais push no app. Lista proposta (cada item confirma-se em D-M7; o que nao for aprovado sai):
| Acao | Endpoint | Reversivel | Salvaguarda |
|---|---|---|---|
| Pausar/retomar campanha | `POST /campaigns/{id}/pause` `/resume` | sim | confirmacao; retomar respeita SPEC-017 (nunca burla limites/aquecimento) |
| Kill switch dos agentes on/off | `PUT /agents/kill-switch` | sim | desligar (parar) sem atrito; LIGAR exige biometria/senha recente + confirmacao |
| Aprovar/rejeitar rascunho | `POST /drafts/{id}/approve` `/reject` (motivo) | rejeitar nao; aprovar dispara envio pela camada existente | mostra corpo truncado por demanda; sem edicao no mobile (editar = web); reusa a mesma acao/regra do web (SPEC-019), supressao e cadencia continuam decidindo |
| Assumir/marcar handoff | `POST /handoffs/{leadId}/take` | sim | agente para naquele lead (regra SPEC-019); mostra link da call |
Explicitamente FORA (fica no web): criar/editar sequencia/template/campanha/ICP, integracoes/chaves, autonomia do agente (`auto`), importar/editar leads, supressao manual, excluir qualquer coisa.
## Backend
- Cada POST: Bearer + dispositivo ativo, Zod, `Idempotency-Key` opcional, auditoria (userId, deviceId, acao, alvo, hora; sem PII) em log de auditoria existente ou tabela `MobileActionLog`, rate limit por dispositivo, resposta com estado novo. Reusar as funcoes de dominio do web (nao reimplementar); erro de regra = 409 com mensagem PT-BR.
- Aprovacao de rascunho: `GET /drafts?status=pending` retorna corpo truncado (ex.: 280 chars) e canal, com `displayName` mascarado; corpo completo so em `GET /drafts/{id}` sob demanda, `no-store`. Decisao D-M6 define se corpo aparece no mobile.
## App
- Aba **Aprovacoes** (fila, detalhe, aprovar/rejeitar com confirmacao e desfazer de 5 s SOMENTE antes de enviar a API, se aplicavel), botoes de pausar/retomar na Campanha, kill switch em Resumo, "Assumir" em handoff com botao "Abrir link da call" (allowlist de host https).
- **Ajustes do dispositivo**: nome, biometria on/off, notificacoes por tipo e silencio, dispositivos conectados (listar/revogar), versao, sair. Registro do push token (`expo-notifications`, permissao solicitada com explicacao, so apos login) e polling como fallback; toque na notificacao abre `alerts/{id}`.
- Toda acao mostra estado pendente, resultado e erro; botoes desabilitados durante a chamada (anti duplo toque).
## Criterios de aceite
1. Cada POST e idempotente ou protegido contra repeticao (segundo toque = mesmo resultado, sem segundo envio).
2. Retomar campanha com instancia pausada/limite excedido nao envia acima do permitido (teste da SPEC-017 via endpoint).
3. Aprovar rascunho de lead em opt-out/supressao = bloqueado (409), nada enviado.
4. Ligar kill switch exige reautenticacao recente; desligar funciona sem ela; estado refletido no web.
5. Handoff "assumir" faz o agente parar naquele lead (teste de dominio) e nao expoe telefone/e-mail.
6. Toda acao gera registro de auditoria sem PII; rate limit 429 testado.
7. Nenhum endpoint da lista FORA existe em `/api/mobile/v1` (teste de rotas contra allowlist).
8. App: push registra token apos permissao; negar permissao mantem polling; logout apaga token no servidor; notificacao nao contem PII; toque navega ao alerta correto.
9. Link da call so abre `https://` de hosts permitidos.
## Testes obrigatorios
Backend Vitest (dominio, idempotencia, supressao, kill switch, auditoria, rate limit, allowlist de rotas); App RNTL (confirmacao, estados, anti duplo toque, permissao de push, deep link); manual: push em aparelho real.
## Seguranca / LGPD
Menor privilegio; acao sensivel exige reautenticacao; auditoria; corpo de mensagem so sob demanda e nunca em cache persistente nem em push.
## Limitacoes de validacao
Push real e iOS dependem de aparelho/conta Apple; envio real via Evolution/SMTP depende de Docker: PENDENTE.
