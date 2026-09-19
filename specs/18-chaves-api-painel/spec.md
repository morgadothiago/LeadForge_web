# SPEC-018 — Chaves de API e integracoes pelo painel (Configuracoes)
- status: IMPLEMENTED (QA achou NEEDS_FIX na 018/APPROVED na 020; correcoes verificadas por testes 769/769, sem segundo QA; navegador, Evolution real e multi-instancia PENDENTES)| domain: fullstack | depende de: SPEC-009 (auth), SPEC-010, SPEC-011, SPEC-016
## Objetivo
O administrador cadastra as chaves/URLs das integracoes (Evolution, n8n, provedor de LLM, busca de leads etc.) em Configuracoes > Integracoes, sem editar codigo nem `.env`, com as chaves cifradas no banco e nunca exibidas de volta.
## O que NAO pode sair do .env (honesto)
Segredos de BOOTSTRAP precisam existir antes do banco: `DATABASE_URL`, `ENCRYPTION_KEY` (cifra de todos os outros segredos), `AUTH_SECRET`, `APP_BASE_URL`. Ficam no ambiente/gerenciador de segredos do deploy. O painel cobre o resto.
## Escopo proposto
- Modelo `IntegrationSecret` (id, integration enum evolution|n8n|llm|places|..., name, valor cifrado com `src/lib/crypto/secret-box.ts` (v1:iv:tag:cipher), `hint` = ultimos 4 caracteres, `baseUrl?`, `updatedById`, `updatedAt`, `lastTestedAt`, `lastTestOk`, `lastTestError` sanitizado), `@@unique([integration, name])`. Auditoria `IntegrationAuditLog` (quem, quando, acao create|rotate|delete|test, integracao; NUNCA o valor).
- Resolvedor unico `getIntegrationConfig(integration)`: le do banco (decifra so em memoria, cache curto com invalidacao ao salvar), com FALLBACK para o `.env` durante a migracao; clientes (getWhatsAppProvider, futuros n8n/LLM) passam a usar o resolvedor em vez de ler `process.env` direto. Trocar a chave vale sem reiniciar.
- Papel: so `admin` altera (hoje `User.role` existe e o seed cria admin): `requireAdmin()`; demais usuarios nem veem a aba. Todas as actions: safeAction + requireUser + requireAdmin + Zod PT-BR + AppError.
- Tela Configuracoes > Integracoes: cartao por integracao com estado (configurada/nao, ultimo teste), campo de chave write-only (nunca pre-preenchido; mostra `••••1234`), campo URL quando aplicavel, botoes "Salvar", "Testar conexao" (chama o provider com timeout, resultado PT-BR, 429 tratado), "Girar/Trocar chave", "Remover" (ConfirmDialog; bloqueia se em uso, ex.: instancias WhatsApp dependem da Evolution), aviso de que a chave nao pode ser recuperada, historico de auditoria.
- Rotacao da `ENCRYPTION_KEY`: payload versionado + comando/action de re-cifrar tudo (documentar); sem isso, trocar a chave invalida os segredos.
## Riscos e decisoes a tomar
1. SSRF: a URL da Evolution/n8n vira INPUT do administrador (antes era so env, de proposito). Mitigacao: apenas admin; bloquear SEMPRE metadados/link-local (169.254.0.0/16 etc.) reusando `src/lib/channels/ssrf.ts`; hosts privados/localhost (a Evolution costuma rodar em docker/localhost) SO com confirmacao explicita "instancia propria" por integracao. Decisao fechada: NAO existe env para liberar hosts privados. [DECISAO]
2. Um banco vazado + `ENCRYPTION_KEY` vazada expoe tudo: recomendar ENCRYPTION_KEY em gerenciador de segredos e nunca no mesmo lugar do dump.
3. Logs/erros/toasts/RSC payload/URL: nunca conter a chave (teste de vazamento; redacao existente em src/lib/http e src/lib/whatsapp/redact.ts).
4. Botao "Testar" e endpoint de teste podem ser abusados: rate limit e timeout.
5. Quem e "admin" com varios usuarios: hoje ha 1 usuario; definir se havera papeis alem de admin. [DECISAO]
6. Chaves POR INSTANCIA de WhatsApp ja sao cifradas (`WhatsAppInstance.apiKey`); manter, e a chave GLOBAL da Evolution passa a vir daqui.
## Criterios de aceite (a refinar ao aprovar)
- [ ] Chave salva cifrada; nunca aparece em query, action, RSC payload, log, toast, auditoria ou teste (teste de vazamento com console capturado).
- [ ] Nao-admin nao acessa a aba nem as actions (teste de cobertura).
- [ ] Trocar a chave no painel muda o comportamento do cliente sem reiniciar (teste com provider fake e cache invalidado).
- [ ] Fallback para `.env` quando o banco nao tem a chave; remover a chave do banco volta ao fallback.
- [ ] Testar conexao mostra resultado PT-BR, respeita timeout e 429/Retry-After (SPEC-016).
- [ ] URL de integracao passa pela checagem SSRF (metadados sempre bloqueados; privado so com confirmacao).
- [ ] Auditoria registra quem/quando/acao sem o valor.
- [ ] Rotacao/re-cifragem da ENCRYPTION_KEY documentada e testada.
- [ ] build/lint/typecheck OK.

## Decisoes fechadas (usuario, 2026-09-19)
- SSRF: enderecos de metadados/link-local (169.254.0.0/16, fd00:ec2::254 etc.) SEMPRE bloqueados; localhost e redes privadas (127/8, ::1, 10/8, 172.16/12, 192.168/16, fc00::/7) so aceitos se o admin marcar explicitamente "instancia propria" ao salvar a integracao (campo `allowPrivateHost`, gravado e auditado); a checagem roda ao SALVAR e de novo ao CONECTAR (resolve DNS e checa o IP; conecta no IP checado; sem redirecionamento cruzado para hosts nao permitidos). Reusar `src/lib/channels/ssrf.ts`.
- Papeis: SO `admin` ve e altera integracoes (`requireAdmin()`); nao-admin nem ve a aba. Sem papel intermediario agora.
## Ordem de execucao
Backend (dev-backend) primeiro: modelo + migration, resolvedor com cache/fallback, migrar `getWhatsAppProvider` para o resolvedor, actions, auditoria, testes; depois frontend (dev-frontend): Configuracoes > Integracoes; depois QA (com foco em vazamento de segredo).

## Backend (contrato para o frontend) — implementado 2026-09-19
Status da SPEC segue APPROVED ate o frontend. Migrations: `20260919230000_integration_secrets`, `20260919230100_integration_audit_private_host`.
Tudo e SO admin (`requireUser` + `requireAdmin`). Nao-admin: actions retornam `{ok:false, errors:{_form:["Sem permissão."]}}`; queries LANCAM `ForbiddenError` (sem sessao: `UnauthorizedError`). A aba deve ser escondida para nao-admin (checar `User.role === "admin"`).
Tipos: `src/lib/integrations/types.ts` (`IntegrationKindName = "evolution"|"n8n"|"llm"|"places"`, `IntegrationOrigin = "db"|"env"|"none"`), `view.ts` (`IntegrationSummary`, `IntegrationItemView`), `test-connection.ts` (`ConnectionTestResult`).
### Queries (`@/lib/queries/integration`)
- `listIntegrations(): IntegrationSummary[]` — sempre 4 entradas: `{integration, label, origin, configured, requiresBaseUrl, testAvailable, items: IntegrationItemView[]}`. `origin`: `db` (cadastrada no painel), `env` (so fallback do `.env`, valor nao revelado; items vazio), `none`. Item: `{id, integration, name, hint, hintDisplay ("••••1234"), baseUrl, allowPrivateHost, updatedAt, lastTestedAt, lastTestOk, lastTestError}`. Nunca traz valor cifrado nem decifrado.
- `listIntegrationAudit({integration?, page?}): {items:[{id,userId,userName,integration,action(create|rotate|delete|test|update_url),hostMasked,allowPrivateHost,at}], page, pageSize:20, total, totalPages}`. Sem valor.
### Actions (`@/lib/actions/integration`, `ActionResult<T>`; erros de campo em `errors.<campo>`)
- `saveIntegration({integration, name?="default", value?, baseUrl?, allowPrivateHost?})` -> `ActionResult<IntegrationItemView>`. `value` write-only (12-512 chars, sem espacos): obrigatorio na criacao ("Informe a chave."), vazio em edicao MANTEM a atual (rotacao = enviar novo value). `baseUrl` obrigatorio para evolution/n8n ("Informe a URL."); http/https, sem usuario/senha, sem `#`, sem `?`. `allowPrivateHost:true` = confirmacao "instancia propria" (auditada); sem ela localhost/redes privadas dao erro em `errors.baseUrl` ("...Marque \"instância própria\" para permitir."); metadados/link-local sempre bloqueados ("...sempre bloqueado."). Evolution so aceita `name="default"`. Editar preserva a chave; mudar URL zera o ultimo teste. Conflito de edicao concorrente: "A integração foi alterada por outra sessão...".
- `removeIntegration({id, confirm:true})` -> `ActionResult<{id}>`. Evolution com instancias WhatsApp: erro em `_form` "Não é possível remover: N instância(s) de WhatsApp dependem da Evolution...". Apos remover, o resolvedor volta ao `.env` (se houver).
- `testIntegration(id: string)` -> `ActionResult<ConnectionTestResult>` `{available, ok, message, retryAfterSeconds?}`. So Evolution tem teste real (`GET /instance/fetchInstances`, timeout, sem retry, sem redirecionamento, 429 -> `retryAfterSeconds`); n8n/llm/places: `available:false` "Teste de conexão indisponível...". Limite 5 testes/min por usuario (em memoria por processo): `_form` "Muitos testes seguidos. Tente novamente em Ns." Resultado disponivel grava `lastTested*` e auditoria `test`.
- Depois de salvar/remover/testar, a action chama `revalidatePath("/configuracoes/integracoes")`: a pagina deve ficar nessa rota ou o frontend deve ajustar.
### Resolvedor (`@/lib/integrations/config`)
`getIntegrationConfig(integration, name="default")`: banco -> fallback `.env` (so evolution: `EVOLUTION_API_URL/KEY`). Cache 30 s por processo, invalidado ao salvar/remover no processo atual (outras instancias do app: ate 30 s). `IntegrationConfig` esconde o valor em `toJSON`/`inspect`; use `reveal()` so para montar o cliente. `getWhatsAppProvider(kind, {timeoutMs?, retry?})` mantem a assinatura; a config e resolvida a cada chamada de metodo (erro `config` na chamada, nao na criacao).
### Limitacoes conhecidas
Rate limit de teste e cache sao por processo. Origem `env` e tratada como confiavel (sem checagem SSRF, comportamento anterior). Testes de n8n/LLM/places dependem dos clientes (SPEC-014/015/019). Rotacao da ENCRYPTION_KEY exige app parado.

## Implementation Notes — Frontend (2026-09-19)
- Arquivos: `src/app/(app)/configuracoes/integracoes/{page,loading}.tsx`; `src/components/settings/{IntegrationCard,IntegrationFormDialog,IntegrationAuditList}.tsx`, `integration-format.ts` (+ `.test.ts`); aba em `SettingsTabs.tsx`.
- Criterios de UI: [x] cartao por integracao (estado/origem/hint/URL/instancia propria/ultimo teste); [x] dialog write-only (password, new-password, mostrar/ocultar, vazio=manter, limpo ao salvar/fechar); [x] checkbox instancia propria com aviso; [x] testar/remover com ConfirmDialog (confirm:true), toasts, aria-live; [x] auditoria paginada por GET; [x] avisos de segredos de bootstrap e ENCRYPTION_KEY; [x] estado "sem permissao".
- Testes: `npm test` completo, typecheck e lint OK. Nao verificado em navegador (rota responde 307 sem cookie).
- A aba "Integracoes" ja e escondida para nao-admin (a pagina tambem trata a negacao).

## Implementation Notes — Correcoes de QA (2026-09-19)
- M1 hint: `secretHint()` em `src/lib/schemas/integration.ts`: chave >=16 chars mostra os 4 ultimos; 8-15 mostra 2; <8 nada (UI cai em `••••`). Minimo aceito subiu de 8 para 12 (chaves reais Evolution/LLM/Places tem 20+; nao quebra integracoes reais). Contrato do hint mudou de "4 ultimos" para "ate 4"; `view.ts`/UI nao precisaram mudar (maskHint aceita hint curto/vazio).
- M2 SSRF (`url-guard.ts`): parser IPv6 proprio; IPv4 embutido extraido e reclassificado em `::/96`, NAT64 `64:ff9b::/96` e `64:ff9b:1::/48`, SIIT `::ffff:0:0:0/96`, 6to4 `2002::/16`, Teredo `2001::/32` (bloqueado inteiro), mapped `::ffff:0:0/96` (confirmado). Destino privado/reservado atras de transicao = bloqueado sempre; so mapped/loopback/privados diretos dependem de `allowPrivateHost`. Tambem bloqueados: `fec0::/10`, `192.0.0.0/24`, `198.18.0.0/15`, `100.64.0.0/10`, `240.0.0.0/4`, multicast, `0.0.0.0/8`. IPv4 alternativo (decimal/octal/hex, 1-4 partes) normalizado antes; numerico fora de faixa = bloqueado. Ponto final removido (`localhost.`, `metadata.google.internal.`); `localhost`/`*.localhost` resolvem localmente (sem DNS). Vale ao salvar e ao conectar (mesma `assertAllowedHost`, IP resolvido reclassificado). Metadados sempre bloqueados, mesmo com `allowPrivateHost=true`.
- M3 oraculo: DNS inexistente usa mensagem unica ("Não foi possível conectar ao servidor informado. Verifique o endereço, a porta e se o serviço está no ar."); em `testIntegration` com `allowPrivateHost=true`, erro sem status HTTP (recusa, timeout, DNS, bloqueio) = mesma mensagem, detalhe so em `console.error(safeErrorForLog)`. Status HTTP do servidor alcancado (401/403/404/5xx/429) continua informando (o admin precisa saber que a chave foi rejeitada). Rate limit: teste 5/min por usuario + 8/min por integracao; `saveIntegration` 10/min por usuario; `SlidingLimiter` (`integrations/rate-limit.ts`) com teto de chaves (1000) e limpeza. Limitacao: por processo.
- M4: `integration-auth-coverage.test.ts` agora verifica a ORDEM (requireUser -> requireAdmin antes de prisma./getIntegrationConfig/assertAllowedHost/runConnectionTest/cotas).
- B6: `removeIntegration` conta dependentes + deleta + audita numa unica transacao Serializable (`withSerializableRetry`); P2025 segue tratado por `safeAction`.
- Testes: `url-guard.test.ts` (tabela), `rate-limit.test.ts`, `integration.test.ts` (M3/B6/hint), `integration-auth-coverage.test.ts`.
