# SPEC-018 — Chaves de API e integracoes pelo painel (Configuracoes)
- status: APPROVED (usuario, 2026-09-19; decisoes fechadas abaixo; implementar DEPOIS do scheduler SPEC-013 terminar, por causa de migrations e da fabrica de provider) | domain: fullstack | depende de: SPEC-009 (auth), SPEC-010, SPEC-011, SPEC-016
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
1. SSRF: a URL da Evolution/n8n vira INPUT do administrador (antes era so env, de proposito). Mitigacao: apenas admin; bloquear SEMPRE metadados/link-local (169.254.0.0/16 etc.) reusando `src/lib/channels/ssrf.ts`; hosts privados/localhost (a Evolution costuma rodar em docker/localhost) SO com confirmacao explicita "instancia propria" por integracao e/ou env `ALLOW_PRIVATE_INTEGRATION_HOSTS`. [DECISAO]
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
