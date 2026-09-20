# Guia do LeadForge

Guia para o dono do produto: o que o sistema faz, como configurar do zero, como usar de ponta a ponta e como rodar tudo de graca antes de ir para producao.

Fonte da verdade: o codigo e as specs em `specs/`. Este guia resume; em caso de duvida, vale a spec (`specs/README.md` tem o indice e o status de cada uma). Documentos relacionados: `docs/N8N.md` (n8n) e `docs/CONFIGURACAO_POS_PROJETO.md` (lista do que depende de voce).

## Indice

1. [O que e o LeadForge e mapa de telas](#1-o-que-e-o-leadforge-e-mapa-de-telas)
2. [Configuracao passo a passo do zero](#2-configuracao-passo-a-passo-do-zero)
3. [Uso de ponta a ponta](#3-uso-de-ponta-a-ponta)
4. [Rodar tudo de graca antes de producao](#4-rodar-tudo-de-graca-antes-de-producao)
5. [Solucao de problemas](#5-solucao-de-problemas)
6. [Checklist antes de producao](#6-checklist-antes-de-producao)
7. [O que ainda nao existe](#7-o-que-ainda-nao-existe)

---

## 1. O que e o LeadForge e mapa de telas

O LeadForge e um CRM/SDR (prospeccao de vendas) em Next.js. Voce define uma campanha com um perfil de cliente ideal (ICP), monta uma sequencia de mensagens (WhatsApp e e-mail), coloca leads nela, e o sistema envia os toques de forma espacada, detecta resposta e opt-out, e leva o lead pelo funil (pipeline). Opcionalmente, agentes de IA redigem as mensagens, sempre com aprovacao humana por padrao.

Pecas:

| Peca | Papel |
|---|---|
| App Next.js (porta 3000) | Telas, regras, scheduler (`/api/cron/tick`), webhooks |
| Postgres (porta 5434 no host) | Banco do app; tambem hospeda os bancos `evolution` e `n8n` |
| Redis | Cache da Evolution API |
| Evolution API (porta 8080) | Ponte com o WhatsApp (via WhatsApp Web, nao oficial) |
| n8n (porta 5678), opcional | Agenda o tick e/ou injeta leads de qualquer fonte |
| SMTP (Nodemailer) | Envio de e-mail; contas cadastradas pelo painel |

### Mapa de funcionalidades por tela

Todas as telas (menos `/login`) exigem login. Itens do menu lateral: Dashboard, Pipeline, Leads, Campanhas, Sequences, Aprovacoes, Configuracoes.

| Tela | Rota | O que faz |
|---|---|---|
| Login | `/login` | Entrada por e-mail e senha (sessao propria, SPEC-009) |
| Dashboard | `/dashboard` | Metricas de prospeccao, grafico semanal, atividades recentes, filtros (SPEC-004) |
| Campanhas | `/campanhas` | Lista de campanhas com status e acoes (SPEC-005) |
| Nova campanha | `/campanhas/nova` | Cria campanha e seu ICP |
| Detalhe da campanha | `/campanhas/[id]` | Edicao, iniciar sequencia para os leads, busca de leads (Places, se ligada) |
| ICPs | `/campanhas/icps` | ICPs reutilizaveis (nicho, localizacao, palavras-chave) |
| Leads | `/leads` | Tabela com filtros, criar lead manual, badges (Suprimido, Tem WhatsApp) (SPEC-008) |
| Ficha do lead | `/leads/[id]` | Linha do tempo de toques, respostas, notas, tags, iniciar/pausar sequencia, "Adicionar a supressao", alerta de possivel opt-out |
| Pipeline | `/pipeline` | Kanban por etapa; arrastar cards; motivo de perda (SPEC-007) |
| Sequences | `/sequences` | Lista de sequencias |
| Nova sequencia | `/sequences/nova` | Cria sequencia |
| Editor de sequencia | `/sequences/[id]` | Passos: canal, atraso, template ou agente de IA (SPEC-006) |
| Templates | `/sequences/templates` | Mensagens por campanha, variaveis `{{var}}`, spintax `{a\|b\|c}`, avisos do validador do 1o toque |
| Aprovacoes | `/aprovacoes` | Fila de rascunhos dos agentes: editar+aprovar, rejeitar com motivo, lote (so Follow-up); secao "Precisa de voce" com "Assumir" (SPEC-019) |
| Configuracoes | `/configuracoes` | Ponto de entrada das abas abaixo |
| Config. E-mail | `/configuracoes/email` | Contas SMTP (presets Gmail, Outlook, Zoho, outro), "Testar conexao" (SPEC-010) |
| Config. WhatsApp | `/configuracoes/whatsapp` | Instancias, QR code, painel de saude, aquecimento, "Retomar envios", URL de webhook (SPEC-011/012/017) |
| Config. Integracoes | `/configuracoes/integracoes` | Chaves de Evolution, n8n, LLM e Places, cifradas no banco; so admin (SPEC-018) |
| Config. Agentes | `/configuracoes/agentes` | Kill switch, teto de gasto, agentes SDR/Follow-up/Closer, base de conhecimento, "Simular"; so admin (SPEC-019) |
| Config. Supressao | `/configuracoes/supressao` | Lista global de contatos que nunca recebem mensagem (SPEC-017) |
| Design system | `/design` | Vitrine de componentes (uso interno de desenvolvimento) |

Endpoints (nao sao telas): `POST|GET /api/cron/tick` (scheduler), `POST /api/integrations/leads` (ingestao, desligado por padrao), `/api/webhooks/whatsapp/{token}` (eventos da Evolution), `/api/webhooks/unsubscribe/{token}` (link de descadastro do e-mail).

Existe codigo de uma API para app mobile (`src/app/api/actions`, `src/app/api/openapi`), mas ela ainda nao tem SPEC e nao faz parte deste guia; vira depois.

---

## 2. Configuracao passo a passo do zero

### 2.1 Pre-requisitos

- Node.js 22 (o projeto foi desenvolvido com v22) e npm.
- Docker. No macOS voce precisa de um runtime: Docker Desktop, ou Colima (gratuito): `brew install colima docker docker-compose` e depois `colima start`. Se `docker compose` disser que nao acha o daemon, o Colima esta parado (ver [Solucao de problemas](#5-solucao-de-problemas)).
- `openssl` (ja vem no macOS) para gerar segredos.

### 2.2 Instalar dependencias

```bash
cd leadforge
npm install --legacy-peer-deps   # a regra do projeto e usar --legacy-peer-deps ao adicionar pacotes
```

### 2.3 Criar o `.env`

```bash
cp .env.example .env
```

Edite o `.env` preenchendo, no minimo: `POSTGRES_PASSWORD` (e a mesma senha dentro de `DATABASE_URL`), `EVOLUTION_API_KEY`, `N8N_ENCRYPTION_KEY`, `AUTH_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`. O `docker compose` recusa subir se faltar `POSTGRES_PASSWORD`, `EVOLUTION_API_KEY` ou `N8N_ENCRYPTION_KEY`.

Como gerar segredos:

```bash
openssl rand -base64 48                                   # AUTH_SECRET (32+ chars)
openssl rand -base64 32                                   # ENCRYPTION_KEY (32 bytes em base64), N8N_ENCRYPTION_KEY, EVOLUTION_API_KEY
openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n'      # CRON_SECRET e INGEST_SECRET (32+ chars; use valores diferentes)
```

#### Tabela de variaveis de ambiente

Confira tambem os comentarios em `.env.example`. "Obrigatoria" significa: sem ela o app (ou a funcao citada) nao funciona.

| Variavel | Obrigatoria? | Para que serve / como definir |
|---|---|---|
| `POSTGRES_PASSWORD` | Sim (compose) | Senha do Postgres do Docker. Use a mesma em `DATABASE_URL` |
| `DATABASE_URL` | Sim | Conexao do app. Ex.: `postgresql://leadforge:SENHA@localhost:5434/leadforge` |
| `EVOLUTION_API_URL` | Opcional | URL da Evolution (`http://localhost:8080`). Vira FALLBACK: o painel (Configuracoes > Integracoes) tem precedencia |
| `EVOLUTION_API_KEY` | Sim (compose) | Chave global da Evolution (`AUTHENTICATION_API_KEY` no compose). Tambem fallback do painel |
| `CONFIG_SESSION_PHONE_VERSION` | Opcional | Le-se no compose (nao esta no `.env.example`). Versao do WhatsApp Web usada no pareamento; default no compose `2.3000.1047967752`. Atualize se o QR nao aparecer (secao 5) |
| `N8N_ENCRYPTION_KEY` | Sim (compose) | Cifra as credenciais do n8n. Perder a chave torna as credenciais ilegiveis. So e usada se voce subir o n8n, mas o compose exige |
| `LEADFORGE_URL` | Opcional | URL do LeadForge vista de dentro do container do n8n. Default `http://host.docker.internal:3000` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Nao usadas no envio | Existem no schema e no `.env.example`, mas o envio usa contas cadastradas em Configuracoes > E-mail (senha cifrada no banco). Nao dependa delas |
| `AUTH_SECRET` | Sim | Assina a sessao de login, 32+ caracteres. Trocar desloga todos |
| `AUTH_URL` | Recomendada | URL publica do app (`http://localhost:3000`). Tambem e o default de `APP_BASE_URL` |
| `APP_BASE_URL` | Opcional (obrigatoria para webhook/descadastro reais) | URL publica do app. Monta o webhook da Evolution (`{APP_BASE_URL}/api/webhooks/whatsapp/{token}`, precisa ser alcancavel pela Evolution) e o link de descadastro. Default: `AUTH_URL` |
| `ADMIN_EMAIL` | Recomendada | E-mail do admin criado pelo seed |
| `ADMIN_PASSWORD` | Recomendada | Senha do admin (12+ chars). Se ausente, o seed pula a criacao do admin com aviso e voce nao consegue logar |
| `TRUSTED_PROXY_IP_HEADER` | Opcional | Atras de proxy/CDN, o cabecalho de IP que ele sobrescreve (`x-real-ip`, `cf-connecting-ip`). Sem ele, o limite de tentativas e por e-mail/token, nao por IP |
| `ALLOW_PRIVATE_SMTP_HOSTS` | Opcional | `true` so em dev/SMTP interno (ex.: Mailpit local). Default false: hosts que resolvem para rede interna sao bloqueados (anti-SSRF) |
| `ENCRYPTION_KEY` | Sim para e-mail e chaves do painel | 32 bytes base64. Cifra senhas SMTP e chaves de integracao (AES-256-GCM) e assina o link de descadastro. Trocar invalida senhas gravadas e links emitidos; para rotacionar use `npm run secrets:reencrypt` |
| `OLD_ENCRYPTION_KEY`, `NEW_ENCRYPTION_KEY` | So na rotacao | Usadas por `npm run secrets:reencrypt`. Uso pontual; nao deixe salvas |
| `WHATSAPP_PROMO_WORDS` | Opcional | Palavras promocionais (separadas por virgula) que o validador do 1o toque avisa. Default: lista embutida |
| `WHATSAPP_DISCONNECT_GRACE_MINUTES` | Opcional | Minutos de queda antes de pausar a instancia. Default 10. Nao esta no `.env.example` (documentada na SPEC-017 e em `CONFIGURACAO_POS_PROJETO.md`) |
| `CRON_SECRET` | Sim para o scheduler | 32+ chars. Autentica `/api/cron/tick`. Sem ele o endpoint responde 503. `npm run tick` nao usa HTTP |
| `SCHEDULER_TIME_BUDGET_MS` | Opcional | Orcamento de tempo por rodada. Default 25000 (teto 25000) |
| `SCHEDULER_MAX_SENDS` | Opcional | Maximo de envios por rodada. Default 20 |
| `INTEGRATION_LEADS_ENABLED` | Opcional | `true` (exato) liga `POST /api/integrations/leads`. Default desligado (503) |
| `INGEST_SECRET` | Necessaria se ingestao ligada | 32+ chars, diferente do `CRON_SECRET`. Bearer da ingestao |
| `ALLOW_SEED_SENDS` | Opcional | `true` so em dev: libera envio real a leads de seed. Nunca em producao |
| `LEAD_SEARCH_ENABLED` | Opcional | `true` liga a busca de leads (Google Places). Default desligado; exige tambem a chave `places` no painel |
| `LEAD_SEARCH_MAX_RESULTS` | Opcional | Leads por execucao. Default 20 (maximo 60) |
| `LEAD_SEARCH_DAILY_MAX_REQUESTS` | Opcional | Chamadas pagas por campanha por dia. Default 3 (maximo 50) |
| `LEAD_SEARCH_MAX_CAMPAIGNS_PER_TICK` | Opcional | Campanhas buscadas por tick. Default 3 |
| `LEAD_SEARCH_TICK_DEADLINE_MS` | Opcional | Prazo do tick para iniciar novas buscas. Default 30000 |
| `TEST_DATABASE_URL` | Opcional | Banco de testes (precedencia sobre o derivado `<nome>_test`) |
| `TEST_DB_ALLOW_OTHER_HOST` | Opcional | `1` permite `TEST_DATABASE_URL` em outro host/porta que o `DATABASE_URL` |

Observacoes: `EVOLUTION_WEBHOOK_SECRET` foi removida (o segredo agora e um token por instancia, no caminho da URL). Chaves de LLM e Places nao tem variavel de ambiente: sao cadastradas so pelo painel (Configuracoes > Integracoes).

### 2.4 Subir a infraestrutura

```bash
colima start          # so no macOS com Colima
docker compose up -d  # postgres, redis, evolution, n8n
docker compose ps
```

O script `docker/init-databases.sh` cria os bancos `evolution` e `n8n` na primeira subida do Postgres. Se o volume `pgdata` ja existia antes, ele nao roda de novo; crie os bancos manualmente se faltarem. Para o basico (sem WhatsApp nem n8n) basta `docker compose up -d postgres`.

### 2.5 Migrar e popular o banco

```bash
npm run db:migrate    # prisma migrate dev (aplica as migrations)
npm run db:seed       # dados de exemplo + admin (usa ADMIN_EMAIL/ADMIN_PASSWORD)
```

O seed cria leads com `source="seed"`: eles NUNCA recebem mensagem real (a campanha de exemplo nasce pausada). Em ambiente novo/producao use `npx prisma migrate deploy` (nunca `migrate reset` com dados reais).

### 2.6 Rodar e entrar

```bash
npm run dev           # http://localhost:3000
```

Abra `http://localhost:3000/login` e entre com `ADMIN_EMAIL` e `ADMIN_PASSWORD`. Depois cadastre em Configuracoes: uma conta de e-mail, uma instancia de WhatsApp (QR code) e, se quiser, as integracoes.

### 2.7 Testes

```bash
npm test                  # vitest run
npm run typecheck
npm run lint
```

- `npm test` roda SEMPRE no banco `<nome>_test` (ex.: `leadforge_test`), derivado do `DATABASE_URL` trocando so o nome, no mesmo Postgres. O banco de desenvolvimento nunca e tocado.
- O setup global cria o banco de teste se faltar, roda `prisma migrate deploy` e o seed idempotente. Se o nome do banco nao terminar em `_test`, a suite aborta.
- `npm run test:db:reset` recria o banco de teste do zero (drop, create, migrate, seed). Use se ele ficar sujo.
- Rode uma execucao de testes por vez: duas simultaneas colidem no mesmo banco de teste (secao 5).

Outros scripts: `npm run tick` (uma rodada do scheduler), `npm run secrets:reencrypt` (rotacao da `ENCRYPTION_KEY`), `npm run build` / `npm start` (producao; rode `build` com o dev server desligado, pois usam a mesma pasta `.next`).

---

## 3. Uso de ponta a ponta

### 3.1 Fluxo completo

1. **Campanha + ICP.** Em `/campanhas/nova`, crie a campanha e defina o ICP (nicho, localizacao, palavras-chave). ICPs podem ser reutilizados (`/campanhas/icps`).
2. **Sequencia.** Em `/sequences/nova`, crie a sequencia; em `/sequences/templates`, crie os templates da campanha (variaveis `{{var}}`, spintax `{a|b|c}` para variar o texto); em `/sequences/[id]`, monte os passos (canal, atraso, template ou agente).
3. **Leads.** Tres caminhos: criar manualmente em `/leads`; ingestao por n8n/API (3.5); busca automatica por Google Places (3.7). Nao ha importacao de CSV na interface (decisao D13). Leads entram como `not_started`.
4. **Iniciar.** Nada e enviado sozinho: use "iniciar sequencia" no lead ou na campanha (`/campanhas/[id]`), ou `Campaign.autoStart` (evite em campanhas alimentadas por n8n).
5. **Follow-up automatico.** O scheduler (3.3) processa os passos vencidos, respeitando a politica de envio (3.2).
6. **Resposta / opt-out.** Qualquer resposta do lead pausa a sequencia e move o card para Interessado. Opt-out por mensagem curta exata ("parar" e similares) encerra e suprime; textos ambiguos geram alerta de "possivel opt-out" para voce confirmar na ficha do lead. Nao ha resposta automatica de bot.
7. **Pipeline.** Acompanhe e mova cards em `/pipeline`; marque motivo ao perder.
8. **Agentes e aprovacoes.** Se usar agentes (3.6), os rascunhos caem em `/aprovacoes` para voce aprovar, editar ou rejeitar.

### 3.2 Politica de envio gentil e anti-banimento (SPEC-017)

Nao ha garantia contra banimento: a Evolution usa o WhatsApp Web (nao oficial) e os limites do WhatsApp nao sao publicos. Os numeros abaixo sao pontos de partida conservadores.

- **Limite de toques:** WhatsApp: 3 toques por lead em ~14 dias (dias 0, 4, 10), minimo 3 dias entre eles; o 4o vira `skipped`. Nunca dois canais no mesmo dia para o mesmo lead.
- **Janela horaria:** segunda a sexta, 9h-12h e 14h-17h no fuso do lead, sem feriados nacionais (Carnaval, Sexta Santa e Corpus Christi incluidos; sem feriados estaduais/municipais).
- **Aquecimento por instancia (limite diario efetivo):** dias 1-3: 3; 4-7: 6; 8-14: 12; 15-21: 20; a partir do dia 22: o teto configurado (default 30, maximo 40).
- **Ritmo:** 45 a 180 s aleatorios entre mensagens; a cada 5 seguidas, pausa de 10 a 20 min.
- **Verificacao de numero:** antes do 1o envio checa se o numero tem WhatsApp; sem WhatsApp, o lead segue so por e-mail.
- **Primeiro toque:** pergunta curta, sem link nem anexo, identifica remetente e termina com saida facil ("responda NAO"). O editor de templates avisa violacoes.
- **Disjuntor de saude:** a instancia pausa sozinha (24 h ou 48 h) em desconexao forcada, falhas consecutivas, entrega baixa ou opt-out alto; a retomada e manual ("Retomar envios") ou automatica ao fim do prazo, com rampa reduzida. O painel em `/configuracoes/whatsapp` mostra estado, dia de aquecimento e motivo.
- **Supressao global:** telefone e e-mail suprimidos (por opt-out em resposta, link de descadastro, acao manual ou bounce) nao recebem nada, em nenhuma campanha ou canal. Gerencie em `/configuracoes/supressao`.
- **Leads de seed** nunca sao enviados, salvo `ALLOW_SEED_SENDS=true` (so dev).

### 3.3 Scheduler (tick)

Sem o tick, nenhuma mensagem de sequencia e enviada. Cada rodada tem orcamento de ~25 s e no maximo 20 envios (`SCHEDULER_*`), e ha trava contra rodadas concorrentes. Frequencia recomendada: 1 minuto.

- Dev local, sem HTTP: `npm run tick` (imprime so contadores).
- HTTP: `POST` (ou `GET`) em `/api/cron/tick` com o header `Authorization: Bearer $CRON_SECRET`:

```bash
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/tick
```

- Agendar com crontab (`* * * * * curl ...`), com o workflow `n8n/workflows/tick.json`, ou com Vercel Cron (a Vercel envia GET com Bearer; ver limites de plano gratis na secao 4).
- A busca de leads (Places) tambem roda dentro do tick.

### 3.4 Webhook da Evolution

Cada instancia de WhatsApp tem um `webhookToken` proprio, embutido na URL `{APP_BASE_URL}/api/webhooks/whatsapp/{token}`; o webhook global da Evolution fica desligado. A URL e configurada por instancia ao criar/rotacionar (tela `/configuracoes/whatsapp`). A Evolution precisa alcancar essa URL: em dev local com a Evolution em Docker, `APP_BASE_URL` deve apontar para algo que o container enxergue (ex.: `http://host.docker.internal:3000`); em hospedagem, para a URL publica em HTTPS. Em proxy reverso, mascare esse caminho nos logs de acesso (o token vai na URL).

### 3.5 n8n (opcional) e ingestao por API

O n8n so serve para agendar o tick e/ou injetar leads. Guia completo, com credenciais, importacao dos workflows e riscos: `docs/N8N.md`. Resumo:

- `docker compose up -d n8n`, interface em `http://localhost:5678`.
- Crie as credenciais Header Auth `LeadForge CRON_SECRET` e `LeadForge INGEST_SECRET` e, depois de importar `n8n/workflows/*.json`, reselecione a credencial em cada no HTTP Request.
- Ingestao: `INTEGRATION_LEADS_ENABLED=true` + `INGEST_SECRET`, `POST /api/integrations/leads` em lotes de ate 100, com `Idempotency-Key`. Mantenha `autoStart` desligado nessas campanhas e inicie manualmente apos revisar.
- A integracao n8n NAO foi testada contra um n8n real (aviso do proprio `docs/N8N.md`).

### 3.6 Agentes de IA (SPEC-019)

Tres papeis: SDR (1o toque), Follow-up (lembretes) e Closer (conversa apos a resposta). O agente PROPOE; a politica de envio (supressao, cadencia, janela, aquecimento, saude) DECIDE se pode enviar.

- **Tudo desligado por padrao.** Um agente so roda com: kill switch global desligado, agente ativo, teto mensal de gasto definido e chave de LLM cadastrada.
- **Autonomia:** `draft` (padrao: todo texto vai para `/aprovacoes`), `sampled` (uma porcentagem vai para revisao, resto sai automatico) e `auto`. O Closer em `auto` exige confirmacao explicita e o aviso de IA ligado; sem isso volta para revisao.
- **Kill switch global** (Configuracoes > Agentes): default ligado, ou seja, agentes desligados. Existe tambem controle por agente.
- **Teto de orcamento:** por agente e global; alerta em 80%, parada em 100%. O custo e calculado no codigo com uma tabela de precos (Haiku 4.5: US$ 1/5 por milhao de tokens entrada/saida; Sonnet 4.5: 3/15; Opus 4.5: 5/25; modelo desconhecido usa o mais caro).
- **Guardrails no codigo:** tamanho, links so se permitidos, sem preco/prazo fora da base de conhecimento, nunca afirmar ser humano; falha vira `blocked` + handoff, nunca envio. Texto do lead e tratado como dado nao confiavel (injecao de prompt).
- **Closer e `callLink`:** campo com o link (https) de agendamento da call. E o unico link que o Closer pode usar; e anexado ao motivo do handoff para o humano.
- **Handoff:** quando o agente para (baixa confianca, regra de escalonamento, pergunta fora da base), o lead aparece em "Precisa de voce" e voce assume a conversa.
- **Simular:** dry-run com o mesmo prompt e guardrails, sem enviar. Atencao: ele chama o LLM de verdade e gasta tokens (respeita kill switch e teto).

### 3.7 Busca de leads por Google Places (SPEC-015)

Desligada por padrao. Para ligar: `LEAD_SEARCH_ENABLED=true` e a chave `places` em Configuracoes > Integracoes. Usa so a API oficial (Text Search), sem scraping. Tetos: `LEAD_SEARCH_MAX_RESULTS`, `LEAD_SEARCH_DAILY_MAX_REQUESTS`. Resultados entram deduplicados e passam pela supressao. Base legal: interesse legitimo B2B, so contatos de cadastro publico de empresas.

### 3.8 Chaves de API pelo painel (SPEC-018)

Em Configuracoes > Integracoes (so admin) cadastre Evolution, n8n, LLM e Places. Ficam cifradas no banco com a `ENCRYPTION_KEY`, nunca sao exibidas de volta (so os ultimos caracteres) e tem precedencia sobre o `.env` (que so vale como fallback da Evolution). URLs locais/rede privada exigem confirmar "instancia propria"; enderecos de metadados de nuvem sao sempre bloqueados. Guarde a `ENCRYPTION_KEY` fora do backup do banco; perde-la torna as chaves ilegiveis.

---

## 4. Rodar tudo de graca antes de producao

Data da consulta de precos e limites: **2026-09-19**. Precos e limites de terceiros mudam com frequencia; confirme na pagina do fornecedor antes de decidir. Onde nao consegui confirmar um numero, esta escrito "nao confirmado".

### 4.1 Tabela resumo

| Componente | Gratis? | Limite / risco | Alternativa paga |
|---|---|---|---|
| Postgres, Redis, Evolution, n8n local (Docker) | Sim, so custa a maquina | Precisa de maquina ligada; sem HTTPS publico nem alta disponibilidade | VPS/nuvem; Postgres gerenciado |
| WhatsApp via Evolution | Sim (sem tarifa) | Nao oficial (WhatsApp Web): risco real de banimento do numero; use chip descartavel e volume baixo | WhatsApp Cloud API oficial (tarifa por template) |
| E-mail (SMTP) | Sim, com limites | Gmail com senha de app: limite diario baixo; Brevo 300/dia; Resend 100/dia; Mailtrap 150/dia | Plano pago do provedor; dominio proprio com SPF/DKIM/DMARC |
| E-mail para teste sem enviar | Sim (Mailpit/MailHog local) | Nada sai de verdade | n/a |
| LLM dos agentes | Nao no codigo atual | So existe Claude (pago, sem tier gratis) e provider fake (so testes). Gratis hoje = agentes desligados | Claude pago; ou implementar outro provedor |
| Google Places | Parcial | Cota mensal gratis por SKU e depois pago por requisicao; desligado por padrao | Mesma API paga; ingestao por n8n/API/manual |
| n8n community self-host | Sim | Voce opera; nao expor na internet | n8n Cloud (nao confirmado) |
| Hospedagem gratis do app | Parcial | Cron por minuto nao cabe na Vercel Hobby; Evolution/Docker nao cabem na Vercel | VPS ou plano pago |

### 4.2 Infra local em Docker (custo zero)

`docker compose up -d` sobe Postgres, Redis, Evolution e n8n na sua maquina. Custo zero alem de energia e do computador ligado. Limites: so voce acessa (a Evolution precisa alcancar o app para o webhook; local funciona via `host.docker.internal`); sem HTTPS e sem alta disponibilidade. Para testar webhook a partir de fora, um tunel (ex.: Cloudflare Tunnel, ngrok) resolve; os planos gratis deles nao foram verificados aqui (nao confirmado).

### 4.3 WhatsApp

- **Evolution (gratis):** usa o WhatsApp Web de forma nao oficial. Nao ha tarifa, mas viola os termos do WhatsApp e o numero pode ser banido. Mitigacao: chip dedicado e descartavel (nunca o numero principal), perfil completo, aquecimento gradual (o sistema aplica a rampa da secao 3.2), volume baixo, base que ja conhece voce, opt-out facil.
- **Alternativa oficial (WhatsApp Cloud API):** sem risco de banimento por uso nao oficial, mas com tarifa por mensagem de template. Segundo fontes secundarias consultadas hoje, marketing no Brasil custa cerca de US$ 0,0625 por mensagem entregue (nao verifiquei a tabela oficial da Meta; tratar como nao confirmado), e respostas em texto livre dentro da janela de 24 h aberta pelo cliente sao gratuitas. Exige conta Business e templates aprovados. O projeto usa provider de WhatsApp plugavel (SPEC-011: `src/lib/whatsapp/provider.ts`, hoje com a implementacao Evolution e uma fake), entao a troca exige escrever um provider novo para a Cloud API; ela ainda nao existe no codigo.

### 4.4 E-mail

O envio usa Nodemailer com contas cadastradas em `/configuracoes/email`.

- **Gmail com senha de app** (exige 2FA): a documentacao de terceiros varia; e citado 500 destinatarios/dia (Workspace: 2.000), mas ha relatos de 100/dia por SMTP em contas pessoais. Limite exato: nao confirmado; trate como algumas dezenas a poucas centenas por dia e conta pessoal pode ser bloqueada.
- **Brevo (plano gratis):** 300 e-mails por dia (fontes secundarias; a pagina de precos oficial nao expos o numero na consulta). Tem SMTP relay.
- **Resend (plano gratis):** 3.000 e-mails/mes e no maximo 100/dia, 3 dominios (pagina oficial de precos consultada).
- **Mailtrap:** envio gratis de 150/dia (~4.000/mes) segundo a busca; a caixa de teste (sandbox) tem 50 e-mails/mes (uma fonte diz 100; nao confirmado).
- **Testar sem enviar:** rode Mailpit ou MailHog local (ex.: `docker run -p 1025:1025 -p 8025:8025 axllent/mailpit`) e cadastre a conta SMTP em `localhost:1025`, sem senha/TLS conforme o formulario aceitar. Como localhost e rede interna, e preciso `ALLOW_PRIVATE_SMTP_HOSTS=true` (so dev). As mensagens aparecem em `http://localhost:8025`. Este uso nao foi testado por mim contra o app.
- **SPF, DKIM e DMARC:** sao registros DNS do seu dominio. SPF lista quem pode enviar por ele; DKIM assina cada mensagem; DMARC diz ao destinatario o que fazer se as checagens falharem. Sem eles (e sem dominio proprio), os e-mails tendem a cair no spam. Provedores como Brevo/Resend mostram quais registros criar. Reputacao de dominio se constroi aos poucos: comece com poucos envios/dia, aumente gradualmente, mantenha taxa baixa de bounce e reclamacao, inclua descadastro (o sistema envia link e `List-Unsubscribe`). Nao use o dominio principal da empresa para testar prospeccao fria.
- SMTP real ainda nao foi testado ponta a ponta (SPEC-010).

### 4.5 LLM dos agentes: o que e realmente gratis hoje

Leitura do codigo (`src/lib/agents/provider.ts`): existem apenas `ClaudeProvider` (chama `https://api.anthropic.com/v1/messages` com a chave `llm` do painel) e `FakeLlmProvider` (respostas roteirizadas, usado nos testes; nao ha tela nem configuracao que o ligue). O "Simular" usa o provedor real e gasta tokens.

Conclusao clara: **gratuito hoje = deixar os agentes desligados** (kill switch global ligado, que e o padrao) e usar templates fixos nos passos da sequencia. Nao ha modo dry-run gratuito na interface.

O que existe no mercado, para uma futura troca de provedor:

- **Claude (Anthropic):** a API nao tem tier gratis permanente. Ha relatos conflitantes sobre credito inicial de cerca de US$ 5 (nao confirmado; fontes recentes dizem que nao ha mais).
- **Gemini API (Google):** tem tier gratuito com limites de taxa em varios modelos Flash (pagina oficial consultada; limites exatos nao confirmados; no tier gratis o conteudo pode ser usado para melhorar produtos, o que importa para dados de leads/LGPD).
- **Modelos locais via Ollama:** gratis (custo da maquina), sem dado saindo do computador; qualidade e velocidade dependem do hardware. Nao verifiquei modelos ou requisitos.

Para usar qualquer um desses e preciso desenvolvimento: implementar uma nova classe que satisfaca a interface `LlmProvider` (`generate(req)` devolvendo JSON no schema de `agentOutputSchema`), escolher o provedor em `getLlmProvider()`, adaptar a tabela de custo em `budget.ts` (modelo desconhecido cai no preco mais caro) e ajustar os nomes de modelo por agente. Isso exigiria uma SPEC.

### 4.6 Google Places (busca de leads)

Fica DESLIGADA por padrao. Sem chave, use ingestao por n8n/API ou criacao manual de leads (nao ha CSV na interface).

Preco consultado na pagina oficial de precos do Google Maps Platform em 2026-09-19: **Text Search Pro** tem 5.000 eventos gratis por mes e depois US$ 32 por 1.000 requisicoes (faixa de 5.001 a 100.000); **Text Search Enterprise** tem 1.000 gratis por mes e depois US$ 35 por 1.000. A pagina nao menciona o antigo credito de US$ 200 mensais. O codigo pede os campos telefone internacional e website; em geral campos de contato podem enquadrar a requisicao na SKU Enterprise, mas nao confirmei qual SKU o mapa de campos do projeto aciona; portanto o custo por requisicao real (US$ 0,032 ou US$ 0,035) e **nao confirmado**. Ha cadastro de faturamento (cartao) na Google para obter a chave. O projeto limita o custo com `LEAD_SEARCH_DAILY_MAX_REQUESTS` (default 3/dia por campanha) e `LEAD_SEARCH_MAX_RESULTS`.

### 4.7 n8n

A edicao community self-host e gratis (imagem `n8nio/n8n:1.82.1` no compose). Custo: voce opera. Nao exponha a porta 5678 na internet. Preco do n8n Cloud: nao confirmado.

### 4.8 Hospedagem gratis para testar

Consulta em 2026-09-19 (fontes secundarias, exceto quando dito):

| Servico | O que oferece de gratis | Limites relevantes para o LeadForge |
|---|---|---|
| Vercel Hobby | App Next.js | Cron so 1 vez por dia (documentacao oficial: expressoes mais frequentes falham no deploy), com precisao de +-59 min; o tick por minuto exige plano Pro ou outro agendador externo. Nao roda Docker/Evolution. Duracao maxima de funcao no Hobby: nao confirmado (a rota do tick pede `maxDuration` 60 s) |
| Neon (Postgres) | Plano gratis: 0,5 GB, 100 CU-horas por projeto, suspende apos 5 min de inatividade (pagina oficial) | Cold start no primeiro acesso; 0,5 GB e pouco se guardar muito historico |
| Supabase | 500 MB de banco, 2 projetos, pausa apos 7 dias sem atividade, sem backups | Pausa derruba o app se ninguem consulta por uma semana |
| Render | Web service gratis (512 MB), dorme apos 15 min, ~1 min para acordar; Postgres gratis de 1 GB que expira em 30 dias (+14 de graca) | Dormir impede tick e webhook confiaveis; Postgres gratis nao serve para manter |
| Railway | Trial unico de US$ 5 por 30 dias; depois Hobby a US$ 5/mes | Nao e gratis de forma continua |
| Fly.io | Sem plano gratis para contas novas; trial de 2 h ou 7 dias | Pago por segundo de maquina |
| Oracle Cloud Always Free | VM ARM gratis; relatos de corte de 4 OCPU/24 GB para 2 OCPU/12 GB em 2026-06 (fonte secundaria, sem confirmacao oficial) | Cadastro pode ser recusado, falta de capacidade, instancia ociosa pode ser recuperada pela Oracle |

**Arquitetura minima gratuita recomendada (teste):** tudo no seu computador, com Docker/Colima: Postgres + Redis + Evolution (e n8n se quiser), app com `npm run dev` (ou `build` + `start`), tick por `npm run tick` ou crontab local chamando `/api/cron/tick`, e-mail por Mailpit para ensaio e um provedor gratis (Brevo/Resend) para um teste real com poucos destinatarios, WhatsApp com chip descartavel e 1 a 3 contatos que aceitem ser testados, agentes desligados, Places desligado. Se precisar de um servidor sempre ligado e gratis, a opcao mais completa (Docker + Evolution + app + Postgres na mesma VM) e a VM Oracle Always Free, com as ressalvas acima; nao testei.

**O que muda para producao paga:** VPS ou nuvem pequena (app + Postgres + Evolution; Postgres gerenciado com backup), dominio proprio com HTTPS e SPF/DKIM/DMARC, provedor de e-mail transacional pago, agendador por minuto (crontab do servidor, n8n ou Vercel Pro), avaliacao da Cloud API oficial do WhatsApp, LLM pago com teto de orcamento, e chave Places com faturamento e teto.

---

## 5. Solucao de problemas

**Evolution nao gera QR code (statusReason 405).** A Evolution v2.1.x precisa da versao correta do WhatsApp Web. O compose passa `CONFIG_SESSION_PHONE_VERSION` (default `2.3000.1047967752`). Se voltar a falhar, pegue a versao atual em `https://raw.githubusercontent.com/wppconnect-team/wa-version/main/versions.json`, defina `CONFIG_SESSION_PHONE_VERSION=...` no `.env` e rode `docker compose up -d evolution`.

**Imagem da Evolution.** O compose usa `evoapicloud/evolution-api:v2.1.1` (a imagem antiga `atendai/evolution-api` nao deve ser usada). Se o pull falhar, confira o nome e a tag.

**n8n: "Found credential with no ID".** Os workflows JSON referenciam credenciais so pelo nome. Depois de importar, abra cada no HTTP Request e reselecione a credencial (`LeadForge CRON_SECRET` ou `LeadForge INGEST_SECRET`).

**n8n: importacao pela CLI falha com "workflows.map is not a function".** O CLI espera um array/diretorio. Use `docker compose exec n8n n8n import:workflow --separate --input=<diretorio com os .json>/`. Ou importe pela interface (Workflows > Import from File).

**`docker compose` diz que nao encontra o daemon (macOS).** Com Colima, rode `colima start` e confirme com `docker ps`. Se usar Docker Desktop, abra o app.

**Compose recusa subir ("defina ... no .env").** Falta `POSTGRES_PASSWORD`, `EVOLUTION_API_KEY` ou `N8N_ENCRYPTION_KEY`.

**Testes falham de forma intermitente com "locked".** Dois processos usando o mesmo Postgres de teste ao mesmo tempo (duas execucoes de `npm test`, ou outra ferramenta escrevendo no banco `_test`). Rode uma por vez; se o banco ficar sujo, `npm run test:db:reset`.

**Login "nao entra" em producao.** O cookie de sessao e `Secure` em producao; sem HTTPS alguns navegadores nao o gravam.

**Login indisponivel logo apos o seed.** `ADMIN_PASSWORD` estava vazio ou com menos de 12 caracteres; defina e rode `npm run db:seed` de novo (e idempotente).

**`/api/cron/tick` responde 503.** `CRON_SECRET` ausente ou com menos de 32 caracteres. **401:** header `Authorization: Bearer ...` errado.

**Ingestao responde 503.** Faltam `INTEGRATION_LEADS_ENABLED=true` (exato) e/ou `INGEST_SECRET` com 32+ chars; reinicie o app.

**E-mail: erro de conexao com host local.** Hosts que resolvem para rede interna sao bloqueados; para Mailpit/SMTP interno em dev use `ALLOW_PRIVATE_SMTP_HOSTS=true`. Gmail/Outlook exigem senha de app.

**Mensagens nao saem.** Verifique nesta ordem: o tick esta agendado? A sequencia foi iniciada no lead? Fora da janela seg-sex 9-12/14-17? Lead suprimido ou de seed? Instancia pausada por saude ou no limite diario (aquecimento)? Toque em `skipped` mostra o motivo na linha do tempo do lead.

**Chaves do painel ilegiveis apos trocar `ENCRYPTION_KEY`.** Use `npm run secrets:reencrypt` com `OLD_ENCRYPTION_KEY`/`NEW_ENCRYPTION_KEY` (dry-run primeiro, depois `-- --apply`) antes de trocar a chave.

---

## 6. Checklist antes de producao

- [ ] Segredos fortes e unicos (`AUTH_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET`, `INGEST_SECRET`, `EVOLUTION_API_KEY`, `N8N_ENCRYPTION_KEY`, senha do Postgres, senha do admin trocada); nada no git.
- [ ] HTTPS no app; `APP_BASE_URL`/`AUTH_URL` publicas; n8n e Evolution nao expostos diretamente; mascarar `/api/webhooks/whatsapp/*` nos logs do proxy.
- [ ] Backup do Postgres com restauracao testada; `ENCRYPTION_KEY` guardada separada do backup.
- [ ] Rate limit e por processo (em memoria): com varias instancias do app o limite nao e compartilhado. Defina `TRUSTED_PROXY_IP_HEADER` atras de proxy.
- [ ] Migrations com `prisma migrate deploy`; `ALLOW_SEED_SENDS` e `ALLOW_PRIVATE_SMTP_HOSTS` ausentes/false.
- [ ] LGPD: base legal registrada (interesse legitimo B2B), remetente identificado nas mensagens, opt-out facil e respeitado (a supressao global ajuda), sem lista comprada, politica de retencao de dados.
- [ ] Aquecimento gradual do numero de WhatsApp e do dominio de e-mail; SPF, DKIM e DMARC configurados.
- [ ] Monitoramento: painel de saude da instancia, faixa de alertas, historico do tick, gasto dos agentes contra o teto.
- [ ] Rodar `npm run build` e testar login, envio real, webhook e descadastro de ponta a ponta.

---

## 7. O que ainda nao existe

- **API para app mobile:** o codigo em `src/app/api/actions` e `src/app/api/openapi` esta em andamento e sem SPEC; a SPEC-021 (futura) vai defini-la.
- **Selo "Precisa de voce" no Kanban:** a secao "Precisa de voce" existe em Aprovacoes, mas o indicador no Kanban/leads previsto na SPEC-019 nao foi confirmado como entregue.
- **Validacao visual em navegador pendente** em varias telas (SPECs 002 a 008, 010, 015, 019): mobile/tablet/desktop, arrastar no Kanban, teclado e foco de dialogos.
- **Verificacoes com servicos reais pendentes:** Evolution v2.1.1 ponta a ponta (formato de webhook, checagem de numeros, logout), SMTP real, n8n real, envio real pelo scheduler, e `next build` de producao.
- **Outros provedores de LLM** alem do Claude, **WhatsApp Cloud API oficial** e **importacao de CSV** nao existem.
