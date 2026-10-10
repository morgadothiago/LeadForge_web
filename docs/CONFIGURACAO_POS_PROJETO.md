# LeadForge — o que configurar depois que o projeto estiver pronto

Este arquivo e a lista unica do que ainda depende de VOCE (credenciais reais, decisoes e verificacoes).
Tudo abaixo tem um valor padrao seguro ja adotado; nada quebra se voce nao mexer, mas nada dispara mensagem real sem as credenciais.
Marque cada item quando concluir. Segredos NUNCA vao para o codigo nem para o git.

## 1. Segredos de bootstrap (ficam no ambiente/servidor, nao no painel)
Precisam existir antes do banco funcionar. Gere com `openssl rand -base64 32` (ou 48).
- [ ] `DATABASE_URL` e `POSTGRES_PASSWORD` — banco do app (no dev ja existe; em producao use senha forte)
- [ ] `AUTH_SECRET` (32+ chars) — assina a sessao de login; trocar desloga todos
- [ ] `AUTH_URL` e `APP_BASE_URL` — URL publica do app; a Evolution precisa alcancar `{APP_BASE_URL}/api/webhooks/whatsapp/{token}`
- [ ] `ENCRYPTION_KEY` (32 bytes base64) — cifra senhas SMTP/chaves e assina link de descadastro; TROCAR invalida senhas e links ja emitidos (guarde num gerenciador de segredos, longe do backup do banco)
- [ ] `CRON_SECRET` (32+ chars) — autentica `/api/cron/tick`; sem ele o endpoint responde 503 (fechado, por seguranca)
- [ ] `ADMIN_EMAIL` / `ADMIN_PASSWORD` (12+ chars) — usuario admin criado por `npm run db:seed`; TROQUE a senha de dev antes de producao
- [ ] `N8N_ENCRYPTION_KEY` — so se usar n8n
- [ ] `INGEST_SECRET` (32+ chars, valor DIFERENTE do `CRON_SECRET`) e `INTEGRATION_LEADS_ENABLED=true` — so se quiser ingerir leads via `POST /api/integrations/leads`; o endpoint vem DESLIGADO (503) e so liga com AMBOS
- [ ] `TRUSTED_PROXY_IP_HEADER` — atras de proxy/CDN (ex.: `x-real-ip`, `cf-connecting-ip`), para o rate limit por IP funcionar. **OBRIGATORIA em producao**: vazio = limite por IP desativado (cada requisicao recebe chave unica, sem bucket global que permitiria DoS; vale so o limite por e-mail/usuario/token; signup por convite/codigo fica sem teto por IP). Rate limit e em memoria/por processo (SPEC-049, D-049-14)
- [ ] `ALLOW_PRIVATE_SMTP_HOSTS` — deixe `false` em producao (so `true` para SMTP interno confiavel em dev)
- [ ] `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` — SPEC-038: sem isso, o e-mail de "esqueci minha senha" (redefinicao de senha) nao e enviado (a resposta ao usuario continua generica por seguranca, mas nenhum e-mail sai; a falha e so logada no servidor)
- Opcionais: `WHATSAPP_PROMO_WORDS`, `WHATSAPP_DISCONNECT_GRACE_MINUTES` (default 10), variaveis de teto do scheduler (ver `.env.example`)

## 2. Integracoes (hoje no `.env`; passam a ser cadastradas pelo painel na SPEC-018)
> SPEC-018 pronta (backend + tela em Configuracoes > Integracoes, so admin; verificacao em navegador pendente). O `.env` segue valendo como FALLBACK da Evolution. Chaves: minimo 12 caracteres; a tela mostra so os ultimos 2-4.
- **Vai no painel (so admin, cifrado no banco, nunca exibido de volta):** chave/URL da Evolution (global), n8n, LLM, busca de leads. O painel tem precedencia sobre o `.env`; remover do painel volta ao `.env`.
- **Fica no ambiente:** `DATABASE_URL`, `ENCRYPTION_KEY`, `AUTH_SECRET`, `APP_BASE_URL` (bootstrap) e, se quiser, `EVOLUTION_API_URL/KEY` como fallback. NAO existe env para liberar hosts privados: so a confirmacao "instancia propria" por integracao. Metadados/link-local (169.254.x, fd00:ec2::254) sao sempre bloqueados.
- **Rotacao da ENCRYPTION_KEY:** com o app parado, `OLD_ENCRYPTION_KEY=... NEW_ENCRYPTION_KEY=... npm run secrets:reencrypt` (dry-run, so contagens); depois `npm run secrets:reencrypt -- --apply` (tudo-ou-nada: integracoes, chaves de instancia WhatsApp e senhas de e-mail). Alternativa: `--stdin` com 2 linhas (antiga, nova). Chaves nunca por argumento. Depois troque `ENCRYPTION_KEY` para a nova e reinicie.
- [ ] Evolution API: `EVOLUTION_API_URL` e `EVOLUTION_API_KEY` (docker compose sobe a Evolution; a URL local exige confirmar "instancia propria" no painel)
- [ ] Conta(s) de e-mail: cadastrar em Configuracoes > E-mail (senha cifrada no banco) e clicar "Testar conexao". Gmail/Outlook exigem SENHA DE APP. SMTP real ainda NAO foi testado.
- [ ] Instancia(s) de WhatsApp: Configuracoes > WhatsApp > criar, ler o QR com o chip dedicado, conferir status "conectada". NUNCA testado contra Evolution real.
- [ ] n8n (opcional, SPEC-014): so para chamar o tick e/ou postar leads. Guia: `docs/N8N.md`; workflows em `n8n/workflows/`. NAO testado contra um n8n real (importacao/execucao PENDENTES).
- [ ] Chave do provedor de IA (SPEC-019) e chave de busca de leads (SPEC-015): cadastradas em Configuracoes > Integracoes (SPEC-018)

## 2b. E-mail de sistema: Azure Communication Services (SPEC-048, opcional)
1. No Azure: crie um recurso **Communication Services** e um **Email Communication Service**; adicione um dominio (proprio, com DKIM/SPF/DMARC verificados, ou o dominio gerenciado `azurecomm.net` para teste) e conecte-o ao recurso Communication Services.
2. Em **MailFrom addresses** do dominio, cadastre os remetentes (ex.: `DoNotReply@seudominio.com`, `suporte@...`, `cobranca@...`).
3. Copie a **connection string** do recurso (Keys) e configure `AZURE_COMMUNICATION_CONNECTION_STRING` (segredo, so server-side), `ACS_FROM_NOREPLY`, `ACS_FROM_SUPPORT`, `ACS_FROM_BILLING` e `EMAIL_PROVIDER=acs`.
4. Ordem: ACS -> Resend (se `RESEND_API_KEY`) -> SMTP. Sem `EMAIL_PROVIDER=acs` o ACS nao e usado. O envio ACS e assincrono: pedido aceito = "enviado" (sem acompanhar entrega). Dominio nao verificado/remetente invalido faz o ACS falhar e o sistema cai no proximo provider.
5. Nao afeta o SMTP por usuario das campanhas (SPEC-010).

## 2c. Storage de arquivos: Azure Blob Storage (SPEC-050, opcional)
1. No Azure: crie uma **Storage account** (StorageV2, redundancia a gosto). O container (`leadforge-files` por padrao, `AZURE_STORAGE_CONTAINER`) e criado automaticamente como **privado**; confirme que "Allow Blob anonymous access" esta desligado na conta.
2. Em **Access keys**, copie a connection string e configure `AZURE_STORAGE_CONNECTION_STRING` (segredo, so server-side) e `STORAGE_PROVIDER=azure`. Sem connection string o provider e `local` (pasta `.storage/`, ignorada pelo git) em dev/teste; em producao sem Azure a feature responde 503 e o app segue funcionando.
3. Chaves: `orgs/{orgId}/{creative|knowledge|attachment}/{uuid}-{nome}` (container unico, prefixo por org). Leitura so por URL SAS `r` de ate 15 min (padrao 5) gerada apos checar a org; `getUploadUrl` (SAS `cw`) existe na interface, mas nao ha UI/rota (upload e via servidor: `POST /api/storage/files?category=&name=` com o corpo cru e `Content-Type`). Se um dia usar upload direto do browser, configure CORS no container.
4. Limites: `STORAGE_MAX_FILE_BYTES` (default 50 MB; atencao ao limite de body da hospedagem, ex. Vercel) e `STORAGE_ALLOWED_MIME` (allowlist + checagem de magic bytes; tipos sem assinatura conhecida so passam se `text/*`). Sem cota por plano ainda.
5. Remocao: soft delete + blob removido na hora. A purga LGPD (SPEC-033, 90 dias apos cancelamento) apaga `orgs/{orgId}/`. Opcional: lifecycle management na conta para blobs orfaos; a reconciliacao `reconcileOrgBlobs` (src/lib/storage/service.ts) e manual por enquanto.

## 2d. Criativos: videos de avatar com IA (SPEC-051a, backend; opcional)
1. **Provedor**: nenhum provedor real foi escolhido (Q-051-1). Hoje so existe o adapter `mock` (padrao em dev/teste): catalogo fixo de avatares/vozes (pt-BR e en) e um "video" MP4 placeholder deterministico, custo zero, nunca acessa a rede. Em **producao** a feature fica indisponivel (erro generico) ate `CREATIVE_PROVIDER=mock` ser definido de forma explicita. Um adapter real futuro implementa `AvatarVideoProvider` (`src/lib/creatives/provider.ts`) e e registrado em `factory.ts`; a chave ficara numa env global (sem BYOK, D-051-2), so server-side, nunca em log/resposta.
2. **Execucao**: por polling no `/api/cron/tick` (SPEC-013; o mesmo cron do scheduler, a cada 1-2 min). Backoff exponencial (5 s a 60 s, jitter 20%), timeout total `CREATIVE_JOB_TIMEOUT_MS` (30 min), limite de `CREATIVE_JOB_MAX_ATTEMPTS` e retomada de jobs presos (lease de 5 min). Nao ha rota de webhook (so o esqueleto opcional `verifyWebhook?` na interface). Sem o cron rodando nada avanca da fila; nao ha dependencia de duracao longa de funcao serverless (cada tick faz passos curtos; o download/upload do video e por stream).
3. **Limites** (por org, por env): `CREATIVE_MAX_CONCURRENT_JOBS_PER_ORG` (2), `CREATIVE_MAX_PER_MONTH_PER_ORG` (20; conta criativos enviados no mes UTC; cancelar antes de chamar o provedor devolve a cota; excluir NAO devolve; retry de falha no mesmo mes nao consome de novo), `CREATIVE_MAX_DURATION_SEC` (120), `CREATIVE_MAX_SCRIPT_CHARS` (3000). Sem acoplamento ao `Plan`.
4. **Moderacao**: so limite de tamanho + `CREATIVE_SCRIPT_BLOCKLIST` (termos separados por virgula). Isto NAO e moderacao de conteudo real: ao adotar um provedor real, revise os termos de uso/filtros dele (uso de imagem/voz, LGPD, consentimento). So avatares/vozes de catalogo; sem clonagem de voz/avatar do cliente.
5. **Armazenamento**: o video final vai para o Blob/local da SPEC-050 (`category=creative`, `orgs/{orgId}/creative/...`), por stream, respeitando `STORAGE_MAX_FILE_BYTES` (50 MB por padrao: videos reais maiores exigem aumentar) e `STORAGE_ALLOWED_MIME` (precisa permitir `video/mp4`). A leitura e por URL SAS curta (5 min).
6. **Migration**: `prisma/migrations/20261011120000_creatives/` (aditiva, escrita a mao; `down.sql` para reverter). Aplique com `prisma migrate deploy`.

## 2d. Multi-tenant N:N: varias organizacoes por usuario (SPEC-049a, backend)
1. Migration aditiva `20261010120000_multi_tenant_nn_orgs` (`OrgInvite`, `OrgAuditLog`, `User.lastOrgId`, `Organization.joinCode*`); rollback manual em `down.sql` na mesma pasta. Aplique com `prisma migrate deploy`.
2. Depois da migration rode UMA vez (idempotente, pode repetir) `npm run org:backfill-last` para preencher `User.lastOrgId` dos usuarios existentes (org mais antiga). Sem isso o login ainda funciona (cai na primeira org).
3. Papeis: `owner` (convida, remove, altera papeis, gere billing e codigo de entrada; varios owners permitidos, a org nunca fica sem owner) e `member`. Convite nominal por e-mail (token 32 bytes, so o hash no banco, 7 dias, uso unico, e-mail da conta = e-mail do convite) e codigo reutilizavel opcional (20 simbolos, expira e limita usos; entrada cria `member` sem aprovacao). O e-mail de convite usa o remetente NOREPLY (cenario `org_invite`).
4. Org ativa fica no JWT; `switchActiveOrganization` reemite o token. Usuario removido/que saiu perde a sessao daquela org na proxima requisicao (`requireUser` confere a Membership). Segunda org criada pelo usuario abre trial proprio (como no signup); sem limite de orgs por usuario por ora (cada uma abre um trial: observe abuso).
5. Limitacoes: rate limits em memoria (por processo); a API mobile (`src/lib/mobile/org.ts`) ainda resolve a PRIMEIRA org do usuario (nao a ativa do web); membros nao contam como assento (sem limite por plano).

## 3. Acoes operacionais (nada disso roda sozinho)
- [ ] Subir tudo: `docker compose up -d` (postgres, redis, evolution, n8n). Evolution e n8n ainda NAO foram levantados de ponta a ponta.
- [ ] **Vercel:** o `vercel.json` já declara o cron `/api/cron/tick` a cada minuto (`* * * * *`). Defina `CRON_SECRET` nas variáveis do projeto (a Vercel envia `Authorization: Bearer $CRON_SECRET` sozinha). Cron por minuto exige plano pago (Hobby só permite 1x/dia: nesse caso use um agendador externo e remova o `crons`). Fora da Vercel, use a linha abaixo.
- [ ] Agendar o scheduler a cada 1-2 min chamando `POST /api/cron/tick` com `Authorization: Bearer $CRON_SECRET` (crontab, n8n ou Vercel Cron). Sem isso, NENHUMA mensagem da sequencia e enviada. Local: `npm run dev:tick` (loop, em outro terminal) ou `npm run tick` (uma rodada).
- [ ] Inicio da sequencia e EXPLICITO: lead `not_started` nao recebe nada sozinho; use "iniciar sequencia" (lead/campanha) ou `Campaign.autoStart=true`. Leads do seed (`source="seed"`) nunca sao enviados (a campanha de exemplo nasce pausada); `ALLOW_SEED_SENDS=true` so em dev.
- [ ] Rodar migrations no ambiente novo: `prisma migrate deploy` (nunca `migrate reset` com dados reais)
- [ ] HTTPS obrigatorio em producao (o cookie de sessao e `Secure` em producao; em `http://` alguns navegadores nao gravam o cookie e o login "nao entra")
- [ ] Proxy reverso: mascarar o path `/api/webhooks/whatsapp/*` nos logs de acesso (o token de webhook vai no caminho da URL); repassar o IP real no cabecalho configurado
- [ ] Novos arquivos em `/public` precisam ser listados no matcher literal de `src/proxy.ts`, senao ficam atras do login
- [ ] Backup do banco (guarde a `ENCRYPTION_KEY` em outro lugar) e rotina de restauracao testada

## 4. WhatsApp: praticas para nao ser banido (nao ha garantia)
- [ ] Usar chip DEDICADO e descartavel, nunca o numero principal; perfil completo (foto, nome da empresa)
- [ ] Manter o aquecimento padrao (3/dia nos dias 1-3, 6 ate o dia 7, 12 na semana 2, 20 na semana 3, teto configurado, maximo 40)
- [ ] Manter 3 toques em ~14 dias, janela seg-sex 9-12/14-17, sem resposta automatica de bot
- [ ] Nao contatar lista comprada; base legal LGPD (interesse legitimo B2B), identificar o remetente e manter opt-out facil
- [ ] Acompanhar o painel de saude da instancia; se pausar, resolver a causa antes de "Retomar"
- [ ] Se o volume crescer: avaliar a API oficial (Cloud API) pelo provider plugavel

## 5. Ainda NAO verificado (precisa de voce ou de servico real)
- [ ] Usar o app no navegador: arrastar no Kanban, teclado/foco dos dialogos, QR e polling, mobile, `/design`
- [ ] Login autenticado real ponta a ponta e o redirecionamento para `/dashboard`
- [ ] Evolution v2.1.1 real: formato de `/webhook/set`, `/chat/whatsappNumbers`, `messages.update`, `apikey` no corpo, evento de logout, `key.id`
- [ ] SMTP real: envio, `List-Unsubscribe`, descadastro por link
- [ ] `next build` de producao (nao foi rodado no fim porque o servidor de dev usa a mesma pasta `.next`); rode com o dev server desligado
- [ ] Envio real ponta a ponta pelo scheduler (SPEC-013) com Evolution e SMTP reais

## 5b. Banco de testes (SPEC-020)
- `npm test` roda SEMPRE no banco `<nome>_test` (ex.: `leadforge_test`, mesmo Postgres), derivado do `DATABASE_URL` do `.env` (so troca o nome); `TEST_DATABASE_URL` tem precedencia. O banco de dev nunca e tocado. `TEST_DATABASE_URL` em OUTRO host:porta que o `DATABASE_URL` e recusado, a menos que `TEST_DB_ALLOW_OTHER_HOST=1`.
- O `globalSetup` cria o banco se faltar, roda `prisma migrate deploy` e o seed idempotente so nele; nao apaga entre execucoes.
- Trava: se o nome do banco nao terminar em `_test`, a suite aborta ("Recusando rodar testes contra banco que nao e de teste").
- `npm run test:db:reset`: drop + create + migrate + seed do banco de teste (recusa nomes sem `_test` ou iguais ao de dev). Use se o banco de teste ficar sujo/corrompido.
- Duas execucoes simultaneas de `npm test` ainda colidem (banco de teste unico): rode uma por vez.

## 6. Decisoes com padrao ja adotado (revise quando quiser)
| Decisao | Padrao adotado |
|---|---|
| Canal inicial | WhatsApp primeiro (escolha sua; e-mail primeiro reduziria o risco) |
| Toques no WhatsApp | 3 em ~14 dias, minimo 3 dias entre eles |
| Resposta do lead | Pausa a sequencia e move o card para Interessado; opt-out so por mensagem curta exata |
| Supressao | Global por telefone/e-mail, todos os canais |
| Executor do scheduler | Endpoint `/api/cron/tick` por cron |
| n8n (D20) | Opcional; so dispara o tick se voce quiser |
| Busca de leads (D21-23) | Somente API oficial (ex.: Google Places), sem scraping de LinkedIn; desligada ate haver chave e orcamento |
| Agentes de IA (D24-28) | Tudo em modo RASCUNHO com aprovacao humana; Claude como provedor; teto de gasto a definir; aviso de IA ligado no Closer |
| Chaves pelo painel (018) | So admin; localhost/rede privada so com confirmacao "instancia propria"; metadados sempre bloqueados |
