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
- [ ] `TRUSTED_PROXY_IP_HEADER` — atras de proxy/CDN (ex.: `x-real-ip`, `cf-connecting-ip`), para o rate limit por IP funcionar; vazio = limita so por e-mail/token
- [ ] `ALLOW_PRIVATE_SMTP_HOSTS` — deixe `false` em producao (so `true` para SMTP interno confiavel em dev)
- Opcionais: `WHATSAPP_PROMO_WORDS`, `WHATSAPP_DISCONNECT_GRACE_MINUTES` (default 10), variaveis de teto do scheduler (ver `.env.example`)

## 2. Integracoes (hoje no `.env`; passam a ser cadastradas pelo painel na SPEC-018)
- [ ] Evolution API: `EVOLUTION_API_URL` e `EVOLUTION_API_KEY` (docker compose sobe a Evolution; a URL local exige confirmar "instancia propria" no painel)
- [ ] Conta(s) de e-mail: cadastrar em Configuracoes > E-mail (senha cifrada no banco) e clicar "Testar conexao". Gmail/Outlook exigem SENHA DE APP. SMTP real ainda NAO foi testado.
- [ ] Instancia(s) de WhatsApp: Configuracoes > WhatsApp > criar, ler o QR com o chip dedicado, conferir status "conectada". NUNCA testado contra Evolution real.
- [ ] n8n (opcional): so para chamar o tick ou orquestrar busca de leads (SPEC-014)
- [ ] Chave do provedor de IA (SPEC-019) e chave de busca de leads (SPEC-015): cadastradas em Configuracoes > Integracoes (SPEC-018)

## 3. Acoes operacionais (nada disso roda sozinho)
- [ ] Subir tudo: `docker compose up -d` (postgres, redis, evolution, n8n). Evolution e n8n ainda NAO foram levantados de ponta a ponta.
- [ ] Agendar o scheduler a cada 1-2 min chamando `POST /api/cron/tick` com `Authorization: Bearer $CRON_SECRET` (crontab, n8n ou Vercel Cron). Sem isso, NENHUMA mensagem da sequencia e enviada. Local: `npm run tick`.
- [ ] Inicio da sequencia e EXPLICITO: lead `not_started` nao recebe nada sozinho; use "iniciar sequencia" (lead/campanha) ou `Campaign.autoStart=true`. Leads do seed (`source="seed"`) nunca sao enviados (a campanha de exemplo nasce pausada); `ALLOW_SEED_SENDS=true` so em dev.
- [ ] Rodar migrations no ambiente novo: `prisma migrate deploy` (nunca `migrate reset` com dados reais)
- [ ] HTTPS obrigatorio em producao (o cookie de sessao e `Secure` em producao; em `http://` alguns navegadores nao gravam o cookie e o login "nao entra")
- [ ] Proxy reverso: mascarar o path `/api/webhooks/whatsapp/*` nos logs de acesso (o token de webhook vai no caminho da URL); repassar o IP real no cabecalho configurado
- [ ] Novos arquivos em `/public` precisam ser listados no matcher literal de `src/proxy.ts`, senao ficam atras do login
- [ ] Backup do banco (guarde a `ENCRYPTION_KEY` em outro lugar) e rotina de restauracao testada
- [ ] Banco SEPARADO para testes (hoje `npm test` usa o banco de dev e pode deixar linhas)

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
