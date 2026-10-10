# Primeiros passos: fazer o LeadForge funcionar (checklist)

Marque cada item e rode o "Como verificar". Complementa o `docs/GUIA.md` (referência completa) e o
`docs/CONFIGURACAO_POS_PROJETO.md` (o que configurar depois de cada SPEC) e o `docs/ROTEIRO_DE_TESTES.md` (o que
clicar e o que esperar). Revisado contra o código em 2026-10-10 (noite). Onde estiver escrito "não verificado",
ninguém rodou no navegador/serviço real: só leitura de código e testes automatizados.

> **Estado do seu ambiente nesta data** (só nomes, nunca valores):
> - `.env` tem `POSTGRES_PASSWORD`, `DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`,
>   `ENCRYPTION_KEY`, `CRON_SECRET`, `INGEST_SECRET`, `N8N_ENCRYPTION_KEY`, `EVOLUTION_*` e `SMTP_*`. Faltam (todas
>   opcionais): `RESEND_API_KEY`, `APP_BASE_URL` (os links dos e-mails caem em `AUTH_URL`, depois em
>   `http://localhost:3000`; em produção defina-a) e qualquer chave de LLM.
>   Também ausentes de propósito: `LEAD_SEARCH_ENABLED` (busca de leads desligada), `CREATIVE_*`, `STORAGE_*`.
> - **E-mail já desviado para o Mailpit:** `SMTP_HOST=localhost`, `SMTP_PORT=1025`, `ALLOW_PRIVATE_SMTP_HOSTS=true`.
>   Container `mailpit` no ar; caixa em http://localhost:8025. Nada sai para a internet.
> - **Migrations:** 40 no repo, a última é `20261013120000_billing_reminder_kinds_052b` (SPEC-052b, adiciona 4 valores ao enum `BillingReminderKind`; **ainda não aplicada no banco de dev**: rode `npx prisma migrate deploy`). No banco de dev
>   `npx prisma migrate status` diz "Database schema is up to date" (conferido em 2026-10-10). Em outro clone/banco,
>   aplique com `npx prisma migrate deploy` (ver 1.3).
> - **Containers no ar:** `leadforge-postgres-1`, `leadforge-redis-1` e `mailpit` (o `evolution` e o `n8n` não).
> - `PAYMENT_PROVIDER` não está definido: o default `mock` já basta.

---

## Fase 1: o app abre e você entra (obrigatório)

- [ ] **1.1 Docker rodando.** No Mac com Colima: `colima start`.
  - Verificar: `docker ps` não dá erro.
- [ ] **1.2 Postgres e Redis no ar.** `docker compose up -d postgres redis`
  - Verificar: `docker ps` mostra `leadforge-postgres-1` e `leadforge-redis-1`.
  - Sintoma de que esqueceu: a página `/` devolve **500** (a landing lê os planos no banco).
- [ ] **1.3 Migrations aplicadas.** Use **`npx prisma migrate deploy`** (sem as migrations de criativos e de `EmailDispatchLog`, `/criativos` e os e-mails de cobrança dão erro de tabela inexistente). Depois **reinicie** o `npm run dev`.
  - **NÃO use `prisma migrate dev` neste banco** (aviso ainda procede, reconferido em 2026-10-10 com
    `prisma migrate diff`): o banco de dev tem colunas que o schema atual não tem (`User.document`/`documentType`,
    `Organization.document`/`documentType`/`documentBlocked`/`trialBlocked`, `Plan.abacatepayProductId` e os índices
    `User_document_*`), criadas por migrations `20260928*` de outro clone que **não existem neste repo**. O
    `migrate dev` proporia **apagar essas colunas e os dados**. Um banco novo (clone limpo) não tem esse drift.
  - Verificar: `npx prisma migrate status` não lista migrations pendentes.
- [ ] **1.4 Seed (admin + dados de exemplo).** `npm run db:seed`
  - Os leads do seed têm `source="seed"` e **nunca recebem mensagem real** (a menos que `ALLOW_SEED_SENDS` esteja ligada;
    não ligue).
  - Cria/atualiza o admin a partir de `ADMIN_EMAIL`/`ADMIN_PASSWORD` (senha de 12+ caracteres; sem elas o admin com
    senha não é criado e o login fica indisponível). Idempotente.
- [ ] **1.5 Subir o app.** `npm run dev` → http://localhost:3000
  - Verificar: `curl -s -o /dev/null -w "%{http_code}\n" localhost:3000` → `200`.
- [ ] **1.6 Entrar.** http://localhost:3000/login com `ADMIN_EMAIL` / `ADMIN_PASSWORD` do `.env`.
  - Verificar: cai no `/dashboard`.

## Fase 2: cadastro, planos e cobrança sem gastar nada

- [ ] **2.1 Cobrança em modo mock: nada a configurar** (a Stripe é só um stub; o adapter da AbacatePay, SPEC-047, existe
  mas exige conta e chaves `ABACATEPAY_*`: não testado com conta real). Sem `PAYMENT_PROVIDER` o default já é `mock`: checkout e
  trial funcionam ponta a ponta sem conta nem chaves externas. `MOCK_WEBHOOK_SECRET` só é necessário para chamar a
  rota HTTP `POST /api/billing/webhook` (sem ele ela responde 503); o checkout interno não depende dele.
  - Verificar: o signup de uma conta nova chega ao checkout fictício sem pedir cartão.
- [ ] **2.2 Criar uma conta nova** em `/signup` e conferir que cai em outra organização.
  - Com o Mailpit (Fase 3) aberto, o e-mail **"início do trial"** deve aparecer para o owner (SPEC-052a; idempotente: um
    por organização). No checkout mock, o e-mail "Assinatura confirmada" é esperado; o **recibo** só sai para renovação
    ou PIX pago (não para o checkout mock). Esperado por leitura de código, **não verificado em navegador**.
- [ ] **2.3 Multi-tenant (SPEC-049, já entregue)**: criar 2ª organização em `/organizacoes`, convidar um e-mail em
  `/configuracoes/equipe`, aceitar em `/convite/[token]` (o e-mail chega no Mailpit) e trocar de organização no seletor.
  Roteiro completo: bloco C de `docs/ROTEIRO_DE_TESTES.md` (o texto dele ainda diz que a 049b não existe: está
  desatualizado). Em bancos antigos, `npm run org:backfill-last` preenche `User.lastOrgId` (idempotente; só imprime
  contagens). Validação em navegador: **não feita**.
- [ ] **2.4 Menu lateral (SPEC-057, agrupada em seções: Captação de leads, Criativos, Automação, Conta).** Marcada
  IMPLEMENTED no `specs/README.md`, mas o código da sidebar ainda está sendo ajustado nesta branch: **em andamento**,
  confira visualmente depois que parar de mudar. O `platform_admin` vê só o item "Administração" (`/admin/organizacoes`).

## Fase 3: e-mail (escolha UMA opção)

- [x] **3.A Sem enviar nada (JÁ CONFIGURADO neste ambiente).** Mailpit local, com autenticação liberada:
  `docker run -d --name mailpit --restart unless-stopped -p 1025:1025 -p 8025:8025 -e MP_SMTP_AUTH_ACCEPT_ANY=1 -e MP_SMTP_AUTH_ALLOW_INSECURE=1 axllent/mailpit`
  - `.env`: `SMTP_HOST=localhost`, `SMTP_PORT=1025`, `ALLOW_PRIVATE_SMTP_HOSTS=true` (reinicie o app ao mudar).
  - Ver as mensagens em http://localhost:8025. As mensagens somem se o container for recriado.
  - O e-mail de sistema (reset de senha, convite, trial, cobrança) usa, nesta ordem, ACS (`EMAIL_PROVIDER=acs`), Resend
    (se `RESEND_API_KEY`) e por fim o SMTP do `.env`; sem os dois primeiros, cai no Mailpit.
  - **E-mails transacionais das SPECs 052a/052b que você vê aqui:** início do trial (signup ou nova organização),
    "Assinatura confirmada", recibo (renovação/PIX), **falha de pagamento imediata**, **régua D+3/D+5/D+7** (D+7 = último
    aviso antes de suspender; igual para cartão e PIX; o grace de 7 dias não mudou), **pagamento regularizado**,
    **próxima cobrança** (7 dias antes, só anual e PIX) e **troca de plano**. Disparo local via webhook do provedor mock e
    `npm run dev:tick` (passos E6 a E10 do `docs/ROTEIRO_DE_TESTES.md`). **Não existe:** e-mail de falha/recuperação de
    **cartão** do AbacatePay (Q-052-5 aberta, nomes dos eventos desconhecidos) e PDF/nota fiscal (recibo é só informativo).
    As SPECs 053-056 (cancelamento, exclusão LGPD, boas-vindas/verificação, e-mails de organização) estão **DRAFT: não existem**.
  - **Para voltar a enviar pelo Gmail de verdade:** `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, remova
    `ALLOW_PRIVATE_SMTP_HOSTS` e reinicie. Sem isso nenhum e-mail sai da sua máquina.
- [ ] **3.B Resend (grátis, 100/dia).** `RESEND_API_KEY=` e `RESEND_FROM_NOREPLY=` (domínio verificado).
- [ ] **3.C Azure Communication Services (SPEC-048).** `EMAIL_PROVIDER=acs`,
  `AZURE_COMMUNICATION_CONNECTION_STRING=` e `ACS_FROM_NOREPLY=` (MailFrom do domínio verificado no ACS).
  Passo a passo em `docs/CONFIGURACAO_POS_PROJETO.md` seção 2b.
  - Verificar (qualquer opção): `/esqueci-senha` com o e-mail do admin e conferir que a mensagem chegou.
  - Custo: Mailpit grátis; Resend 100/dia grátis (confirme no site); ACS cobra por e-mail (confirme no portal Azure).
  - Nunca testado contra Resend nem ACS reais: só testes com provider mockado.

## Fase 4: arquivos (SPEC-050), funciona sem Azure

- [ ] **4.1 Nada a fazer para testar.** Sem `AZURE_STORAGE_CONNECTION_STRING` o provider **`local`** grava em `.storage/`
  (`STORAGE_LOCAL_DIR` muda a pasta; ignorada pelo git). Em produção sem Azure e sem `STORAGE_PROVIDER=local` a feature
  responde 503. Limites opcionais: `STORAGE_MAX_FILE_BYTES`, `STORAGE_ALLOWED_MIME`. Rotas: `/api/storage/files`.
  Custo local: zero. Limitação: disco local não serve para produção em Vercel (sistema de arquivos efêmero).
- [ ] **4.2 Azure Blob de verdade (depois).** `AZURE_STORAGE_CONNECTION_STRING=` + `AZURE_STORAGE_CONTAINER=` (container
  **privado**). Seção 2c de `docs/CONFIGURACAO_POS_PROJETO.md`.
  - Nunca foi testado contra Azure real: só mock e SAS offline.

## Fase 5: WhatsApp (opcional)

- [ ] **5.1** `docker compose up -d evolution` (não sobe junto com 1.2; porta 8080; precisa de `EVOLUTION_API_URL` e
  `EVOLUTION_API_KEY` no `.env`, já presentes).
  - Verificar: `docker ps` mostra o container da Evolution e a tela de WhatsApp lista a instância.
  - O `n8n` (SPEC-014, `docker compose up -d n8n`, porta 5678) é opcional; a ingestão `POST /api/integrations/leads` só
    liga com `INTEGRATION_LEADS_ENABLED=true` e `INGEST_SECRET` de 32+ caracteres. Ver `docs/N8N.md`.
- [ ] **5.2** Em Configurações > WhatsApp, criar a instância e ler o QR code.
  - Use um **chip descartável**: a Evolution é não-oficial e o número pode ser banido. Custo: o chip. Não verificado
    de ponta a ponta nesta revisão.

## Fase 6: LLM dos agentes (SPEC-018/019)

**Realidade hoje:** o código só tem `ClaudeProvider` (`https://api.anthropic.com`, pago, sem tier grátis) e um
`FakeLlmProvider` de testes. **Não existe LLM gratuito pronto no projeto.** Verifique: `src/lib/agents/provider.ts`.
A SPEC-036 (LLM gratuito OpenAI-compatible) está APROVADA, mas **a implementação está pendente**.

- [ ] **6.1 Testar sem LLM (grátis).** Deixe os agentes desligados (kill switch global, que é o padrão) e use templates
  fixos nos passos da sequência.
- [ ] **6.2 Testar com Claude.** Configurações > Integrações > LLM: cole a chave da Anthropic. Fica cifrada com a
  `ENCRYPTION_KEY`. É pago.
- [ ] **6.3 Usar um LLM grátis.** Exige uma SPEC nova: um adapter que implemente `LlmProvider` e escolha o provedor
  em `getLlmProvider()` (é exatamente a SPEC-036, já aprovada). Opções para avaliar (confirme limites e termos na página oficial antes, mudam sempre):

| Opção | Custo | Observação |
|---|---|---|
| Gemini API (Google AI Studio) | tier gratuito com limite de taxa | no tier grátis o conteúdo pode ser usado para melhorar produtos (atenção a LGPD/dados de leads) |
| Groq | tier gratuito com limite de taxa | API compatível com o formato OpenAI; modelos abertos |
| OpenRouter | alguns modelos `:free` | disponibilidade e limites variam |
| Ollama (local) | grátis, só a máquina | nenhum dado sai do computador; qualidade depende do hardware; API compatível com OpenAI em `localhost:11434` |

  Recomendação: **um único adapter "OpenAI-compatible"** (base URL + chave + modelo configuráveis) cobre Groq,
  OpenRouter, Ollama e o endpoint de compatibilidade do Gemini. Escopo já coberto pela **SPEC-036** (a SPEC-052 agora é de e-mails de cobrança); falta só implementar.

## Fase 7: criativos com avatar (SPEC-051, implementada com provedor de demonstração; avatar mock)

- [ ] **7.1** Aplicar a migration (1.3) e reiniciar. Entrar em **`/criativos`** (item "Criativos" na sidebar).
- [ ] **7.2** Nada a configurar: o provider padrão é **`mock`** (vídeo placeholder, custo zero, nunca usa a rede) e a tela
  mostra o aviso "Provedor de demonstração (mock)". Em produção só liga com `CREATIVE_PROVIDER=mock` explícito.
- [ ] **7.3 Os criativos só avançam quando o tick roda.** Em local ninguém chama o tick sozinho. Em um **segundo terminal**,
  deixe rodando: `npm run dev:tick` (chama `POST /api/cron/tick` a cada 15 s; `DEV_TICK_INTERVAL_MS` ajusta, mínimo 2000).
  O criativo sai de "Na fila" e conclui em ~15-30 s (o mock leva ~3 s, `CREATIVE_MOCK_DELAY_MS`). Manual, sem loop:
  `npm run tick` (também processa criativos; a 1a rodada envia ao mock e a 2a conclui) ou
  `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/tick`. Sem tick o criativo fica em "Na fila".
- [ ] **7.4** Limites por org (envs `CREATIVE_*`, ver `.env.example`): 2 gerações simultâneas e 20 criativos por mês.
- Provedor real (HeyGen, D-ID, Synthesia, Tavus ou Azure AI Speech Avatar): decisão em aberto (Q-051-1). Antes de ligar
  um, cumpra o D-051-15 da SPEC-051 (proteção SSRF e timeouts no download do vídeo).
- Limitação: o vídeo é um placeholder; nenhum avatar real é gerado. Custo: zero (mock). O único provider aceito em
  `CREATIVE_PROVIDERS` é `mock`.
- Status: 051a (backend) e 051b (frontend) constam como IMPLEMENTED no `specs/README.md`; **não validado em navegador
  autenticado**.

## Fase 8: busca de leads pelo Google Maps / Places (SPEC-015; botão "Buscar leads" na campanha)

**Desligada por padrão** (`LEAD_SEARCH_ENABLED` ausente no seu `.env`). O app usa só a **Places API (New)** (`POST places.googleapis.com/v1/places:searchText`) com uma chave
de API. Não usa Maps JavaScript, mapa nem geocoding. A chave vai só no servidor (header `X-Goog-Api-Key`) e fica cifrada no banco.
Traz nome, telefone, site, endereço e nota. **Não traz e-mail de decisor.**

- [ ] **8.1 Projeto no Google Cloud.** console.cloud.google.com > criar projeto.
- [ ] **8.2 Faturamento.** O Google exige cartão para liberar a chave, mesmo dentro da cota grátis.
- [ ] **8.3 Ativar a "Places API (New)".** Não confundir com a "Places API" antiga: o código usa a nova.
- [ ] **8.4 Criar a chave** em APIs e serviços > Credenciais > chave de API.
- [ ] **8.5 Restringir a chave** só à "Places API (New)". **Não** restrinja por site (a chamada sai do servidor); por IP só se o
  servidor tiver IP fixo.
- [ ] **8.6 Teto e alerta de orçamento** em Faturamento. É a sua proteção real contra gasto.
- [ ] **8.7 Cadastrar no app.** Logado como **admin**: `/configuracoes/integracoes` > Places > colar a chave.
- [ ] **8.8 Ligar.** No `.env`: `LEAD_SEARCH_ENABLED=true` e reinicie o `npm run dev`.
  Tetos opcionais: `LEAD_SEARCH_MAX_RESULTS` (padrão 20, máx. 60), `LEAD_SEARCH_DAILY_MAX_REQUESTS` (padrão 3/dia/campanha, busca
  diária pelo tick), `LEAD_SEARCH_MAX_CAMPAIGNS_PER_TICK` (padrão 3), `LEAD_SEARCH_TICK_DEADLINE_MS` (padrão 30000) e, da
  SPEC-058, `LEAD_SEARCH_MANUAL_DAILY_MAX_REQUESTS` (padrão 2/dia/campanha)
  e `LEAD_SEARCH_ORG_DAILY_MAX_REQUESTS` (padrão 10/dia/org).
- [ ] **8.9 Testar.** Crie uma campanha **ativa** com ICP (ex.: nicho "dentistas", local "Curitiba"), abra `/campanhas/[id]` e
  use **Buscar leads** (ou deixe o `npm run dev:tick` rodando para a busca diária). Os leads entram em `/leads` e no
  Pipeline como `novo_lead`, deduplicados e sem contatos em opt-out.
  - Verificar: o resultado mostra novos/duplicados; repetir a mesma busca devolve quase só duplicados (1 página de até 20
    resultados por chamada; paginação fica para SPEC futura).

**Custo (consultado em 2026-09-19 no `docs/GUIA.md` 4.6; confirme na página oficial, muda):** Text Search Pro 5.000 grátis/mês e
depois US$ 32 por 1.000; Enterprise 1.000 grátis/mês e depois US$ 35 por 1.000. Campos de telefone e site tendem a cair na
Enterprise, mas **o SKU realmente acionado não foi confirmado**.

**Riscos:** os termos da Places API restringem cache/armazenamento de dados; confirme os termos vigentes antes de operar em
escala. Base legal registrada: interesse legítimo B2B, com opt-out aplicado antes de criar o lead.

**Estado:** SPEC-058 IMPLEMENTADA (058a backend e 058b frontend, QA aprovado em 2026-10-10): só o **owner** dispara "Buscar agora";
tetos manual 2/dia/campanha e 10/dia/org, separados do teto da busca diária; estado "rodando" sobrevive a recarregar a
página; resultado com novos/duplicados/suprimidos. **Nunca foi rodada com a API real do Google** (só testes com resposta
mockada) e a tela nunca foi vista em navegador: use o bloco G de `docs/ROTEIRO_DE_TESTES.md`.

---

## Testes

- [ ] `npx tsc --noEmit` (ou `npm run typecheck`) e `npm run lint`
  - Estado em 2026-10-10 (após a SPEC-058): `tsc` limpo; `lint` 0 erros (14 warnings que já existiam); vitest completo em banco
    novo: 149 arquivos, 1852 testes passando.
- [ ] `npm test` (vitest): **use um banco de teste limpo**. O `leadforge_test` acumula lixo e gera falsas falhas
  (`Unique constraint failed on WhatsAppInstance_instanceName_key`, contagens 21 vs 20). Num banco novo:
  `TEST_DATABASE_URL=postgresql://leadforge:<senha>@localhost:5434/leadforge_clean_test npm test`
  (o setup cria, migra e semeia o banco sozinho; o nome precisa terminar em `_test`).
  **Nunca rode os testes sem `TEST_DATABASE_URL`**: cairiam no `leadforge_test` compartilhado e sujo.
  Hoje há **144 arquivos de teste** (`*.test.ts(x)`). A última rodada completa registrada em banco limpo foi de 141
  arquivos e 1732 testes passando; **não foi reexecutada nesta revisão** (e o código de busca de leads está em mudança).
  `npm run test:db:reset` recria o banco de teste.

## Se algo der errado

| Sintoma | Causa provável | Ação |
|---|---|---|
| `/` retorna 500 | Postgres fora do ar | 1.1 e 1.2 |
| `docker ps` falha com "colima.sock" | Colima parado | `colima start` |
| `prisma migrate dev` quer dropar colunas | drift do banco de dev | **não confirme**; use `migrate deploy` |
| App não sobe em produção | falta `TRUSTED_PROXY_IP_HEADER` | defina (ex.: `x-real-ip`); é obrigatória em produção (SPEC-049; o `next build` não exige) |
| Nenhuma mensagem/busca/criativo roda sozinho em produção | falta agendar o tick ou `CRON_SECRET` (32+ caracteres; sem ele `/api/cron/tick` responde 503) | `vercel.json` já agenda o tick por minuto (exige plano pago na Vercel); defina `CRON_SECRET`; ver `docs/CONFIGURACAO_POS_PROJETO.md` |
| `/criativos` ou `/api/storage/*` dão 503 em produção | `CREATIVE_PROVIDER=mock` e/ou storage não definidos | Fases 4 e 7 |
| Rate limit por IP "desligado" em produção | mesma causa | idem |
| E-mail não chega na caixa | olhando o lugar errado | com o Mailpit, abra http://localhost:8025 (não o Gmail) |
| E-mail não chega no Mailpit | container parado ou `.env` sem reiniciar | `docker ps` mostra `mailpit`? Reinicie o `npm run dev` |
| Busca de leads "indisponível"/sem resultados | `LEAD_SEARCH_ENABLED` ausente, chave `places` não cadastrada ou campanha inativa | Fase 8 |
| E-mail de trial/recibo não chega depois de uma migration nova | o `npm run dev` antigo segura o Prisma Client velho (falha em silêncio) | pare e reinicie o `npm run dev` |
| Criativo fica em "Na fila" | o tick não rodou | `npm run dev:tick` em outro terminal (7.3) |
| `/criativos` dá erro de tabela | migration dos criativos não aplicada | 1.3 |
