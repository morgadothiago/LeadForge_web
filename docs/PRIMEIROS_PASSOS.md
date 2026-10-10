# Primeiros passos: fazer o LeadForge funcionar (checklist)

Marque cada item e rode o "Como verificar". Complementa o `docs/GUIA.md` (referência completa) e o
`docs/CONFIGURACAO_POS_PROJETO.md` (o que configurar depois de cada SPEC) e o `docs/ROTEIRO_DE_TESTES.md` (o que
clicar e o que esperar). Atualizado em 2026-10-10 (noite).

> **Estado do seu ambiente nesta data** (só nomes, nunca valores):
> - `.env` tem `DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ENCRYPTION_KEY`,
>   `CRON_SECRET`, `INGEST_SECRET`, `EVOLUTION_*` e `SMTP_*`. Faltam (todas opcionais): `RESEND_API_KEY`,
>   `APP_BASE_URL` e qualquer chave de LLM.
> - **E-mail já desviado para o Mailpit:** `SMTP_HOST=localhost`, `SMTP_PORT=1025`, `ALLOW_PRIVATE_SMTP_HOSTS=true`.
>   Container `mailpit` no ar; caixa em http://localhost:8025. Nada sai para a internet.
> - **Migrations aplicadas no banco de dev:** até `20261010120000_multi_tenant_nn_orgs`. **Pendente:**
>   `20261011120000_creatives` (SPEC-051); aplique com `npx prisma migrate deploy` (ver 1.3).
> - `PAYMENT_PROVIDER` não está definido: o default `mock` já basta.

---

## Fase 1: o app abre e você entra (obrigatório)

- [ ] **1.1 Docker rodando.** No Mac com Colima: `colima start`.
  - Verificar: `docker ps` não dá erro.
- [ ] **1.2 Postgres e Redis no ar.** `docker compose up -d postgres redis`
  - Verificar: `docker ps` mostra `leadforge-postgres-1` e `leadforge-redis-1`.
  - Sintoma de que esqueceu: a página `/` devolve **500** (a landing lê os planos no banco).
- [ ] **1.3 Migrations aplicadas.** Use **`npx prisma migrate deploy`** (hoje falta a dos criativos, `20261011120000_creatives`;
  sem ela `/criativos` dá erro de tabela inexistente). Depois **reinicie** o `npm run dev`.
  - **NÃO use `prisma migrate dev` neste banco**: ele detecta drift (colunas `document*`, `trialBlocked`,
    `abacatepayProductId` criadas por migrations de outro clone) e proporia **apagar essas colunas e os dados**.
  - Verificar: `npx prisma migrate status` não lista migrations pendentes.
- [ ] **1.4 Seed (admin + dados de exemplo).** `npm run db:seed`
  - Os leads do seed têm `source="seed"` e **nunca recebem mensagem real**.
- [ ] **1.5 Subir o app.** `npm run dev` → http://localhost:3000
  - Verificar: `curl -s -o /dev/null -w "%{http_code}\n" localhost:3000` → `200`.
- [ ] **1.6 Entrar.** http://localhost:3000/login com `ADMIN_EMAIL` / `ADMIN_PASSWORD` do `.env`.
  - Verificar: cai no `/dashboard`.

## Fase 2: cadastro, planos e cobrança sem gastar nada

- [ ] **2.1 Cobrança em modo mock: nada a configurar.** Sem `PAYMENT_PROVIDER` o default já é `mock`: checkout e
  trial funcionam ponta a ponta sem conta nem chaves externas. `MOCK_WEBHOOK_SECRET` só é necessário para chamar a
  rota HTTP `POST /api/billing/webhook` (sem ele ela responde 503); o checkout interno não depende dele.
  - Verificar: o signup de uma conta nova chega ao checkout fictício sem pedir cartão.
- [ ] **2.2 Criar uma conta nova** em `/signup` e conferir que cai em outra organização.
- [ ] **2.3 Multi-tenant (SPEC-049, já entregue)**: criar 2ª organização em `/organizacoes`, convidar um e-mail em
  `/configuracoes/equipe`, aceitar em `/convite/[token]` (o e-mail chega no Mailpit) e trocar de organização no seletor.
  Roteiro completo: bloco C de `docs/ROTEIRO_DE_TESTES.md`.

## Fase 3: e-mail (escolha UMA opção)

- [x] **3.A Sem enviar nada (JÁ CONFIGURADO neste ambiente).** Mailpit local, com autenticação liberada:
  `docker run -d --name mailpit --restart unless-stopped -p 1025:1025 -p 8025:8025 -e MP_SMTP_AUTH_ACCEPT_ANY=1 -e MP_SMTP_AUTH_ALLOW_INSECURE=1 axllent/mailpit`
  - `.env`: `SMTP_HOST=localhost`, `SMTP_PORT=1025`, `ALLOW_PRIVATE_SMTP_HOSTS=true` (reinicie o app ao mudar).
  - Ver as mensagens em http://localhost:8025. As mensagens somem se o container for recriado.
  - **Para voltar a enviar pelo Gmail de verdade:** `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, remova
    `ALLOW_PRIVATE_SMTP_HOSTS` e reinicie. Sem isso nenhum e-mail sai da sua máquina.
- [ ] **3.B Resend (grátis, 100/dia).** `RESEND_API_KEY=` e `RESEND_FROM_NOREPLY=` (domínio verificado).
- [ ] **3.C Azure Communication Services (SPEC-048).** `EMAIL_PROVIDER=acs`,
  `AZURE_COMMUNICATION_CONNECTION_STRING=` e `ACS_FROM_NOREPLY=` (MailFrom do domínio verificado no ACS).
  Passo a passo em `docs/CONFIGURACAO_POS_PROJETO.md` seção 2b.
  - Verificar (qualquer opção): `/esqueci-senha` com o e-mail do admin e conferir que a mensagem chegou.

## Fase 4: arquivos (SPEC-050), funciona sem Azure

- [ ] **4.1 Nada a fazer para testar.** Sem `AZURE_STORAGE_CONNECTION_STRING` o provider **`local`** grava em `.storage/`
  (ignorado pelo git). Em produção sem Azure e sem `STORAGE_PROVIDER=local` a feature responde 503.
- [ ] **4.2 Azure Blob de verdade (depois).** `AZURE_STORAGE_CONNECTION_STRING=` + `AZURE_STORAGE_CONTAINER=` (container
  **privado**). Seção 2c de `docs/CONFIGURACAO_POS_PROJETO.md`.
  - Nunca foi testado contra Azure real: só mock e SAS offline.

## Fase 5: WhatsApp (opcional)

- [ ] **5.1** `docker compose up -d evolution` (não sobe junto com 1.2).
- [ ] **5.2** Em Configurações > WhatsApp, criar a instância e ler o QR code.
  - Use um **chip descartável**: a Evolution é não-oficial e o número pode ser banido.

## Fase 6: LLM dos agentes (SPEC-018/019)

**Realidade hoje:** o código só tem `ClaudeProvider` (`https://api.anthropic.com`, pago, sem tier grátis) e um
`FakeLlmProvider` de testes. **Não existe LLM gratuito pronto no projeto.** Verifique: `src/lib/agents/provider.ts`.

- [ ] **6.1 Testar sem LLM (grátis).** Deixe os agentes desligados (kill switch global, que é o padrão) e use templates
  fixos nos passos da sequência.
- [ ] **6.2 Testar com Claude.** Configurações > Integrações > LLM: cole a chave da Anthropic. Fica cifrada com a
  `ENCRYPTION_KEY`. É pago.
- [ ] **6.3 Usar um LLM grátis.** Exige uma SPEC nova: um adapter que implemente `LlmProvider` e escolha o provedor
  em `getLlmProvider()`. Opções para avaliar (confirme limites e termos na página oficial antes, mudam sempre):

| Opção | Custo | Observação |
|---|---|---|
| Gemini API (Google AI Studio) | tier gratuito com limite de taxa | no tier grátis o conteúdo pode ser usado para melhorar produtos (atenção a LGPD/dados de leads) |
| Groq | tier gratuito com limite de taxa | API compatível com o formato OpenAI; modelos abertos |
| OpenRouter | alguns modelos `:free` | disponibilidade e limites variam |
| Ollama (local) | grátis, só a máquina | nenhum dado sai do computador; qualidade depende do hardware; API compatível com OpenAI em `localhost:11434` |

  Recomendação: **um único adapter "OpenAI-compatible"** (base URL + chave + modelo configuráveis) cobre Groq,
  OpenRouter, Ollama e o endpoint de compatibilidade do Gemini. Pedir como **SPEC-052**.

## Fase 7: criativos com avatar (SPEC-051, implementada com provedor de demonstração)

- [ ] **7.1** Aplicar a migration (1.3) e reiniciar. Entrar em **`/criativos`** (item "Criativos" na sidebar).
- [ ] **7.2** Nada a configurar: o provider padrão é **`mock`** (vídeo placeholder, custo zero, nunca usa a rede) e a tela
  mostra o aviso "Provedor de demonstração (mock)". Em produção só liga com `CREATIVE_PROVIDER=mock` explícito.
- [ ] **7.3 Os criativos só avançam quando o tick roda.** Em local, ninguém chama o tick sozinho. Depois de enviar um
  criativo, rode a cada ~1 min: `npm run tick`, ou
  `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/tick`
  (o mock leva ~3 s, `CREATIVE_MOCK_DELAY_MS`, até ficar pronto). Sem o tick o criativo fica em "Na fila".
- [ ] **7.4** Limites por org (envs `CREATIVE_*`, ver `.env.example`): 2 gerações simultâneas e 20 criativos por mês.
- Provedor real (HeyGen, D-ID, Synthesia, Tavus ou Azure AI Speech Avatar): decisão em aberto (Q-051-1). Antes de ligar
  um, cumpra o D-051-15 da SPEC-051 (proteção SSRF e timeouts no download do vídeo).
- Status: o frontend (051b) **ainda está em correção** após a revisão de QA; não foi validado em navegador autenticado.

---

## Testes

- [ ] `npx tsc --noEmit` e `npm run lint`
- [ ] `npm test` (vitest): **use um banco de teste limpo**. O `leadforge_test` acumula lixo e gera falsas falhas
  (`Unique constraint failed on WhatsAppInstance_instanceName_key`, contagens 21 vs 20). Num banco novo:
  `TEST_DATABASE_URL=postgresql://leadforge:<senha>@localhost:5434/leadforge_clean_test npm test`
  (o setup cria, migra e semeia o banco sozinho; o nome precisa terminar em `_test`).
  **Nunca rode os testes sem `TEST_DATABASE_URL`**: cairiam no `leadforge_test` compartilhado e sujo.
  Última rodada completa em banco limpo: 141 arquivos, 1732 testes passando.

## Se algo der errado

| Sintoma | Causa provável | Ação |
|---|---|---|
| `/` retorna 500 | Postgres fora do ar | 1.1 e 1.2 |
| `docker ps` falha com "colima.sock" | Colima parado | `colima start` |
| `prisma migrate dev` quer dropar colunas | drift do banco de dev | **não confirme**; use `migrate deploy` |
| App não sobe em produção | falta `TRUSTED_PROXY_IP_HEADER` | defina (ex.: `x-real-ip`); é obrigatória em produção (SPEC-049) |
| Rate limit por IP "desligado" em produção | mesma causa | idem |
| E-mail não chega na caixa | olhando o lugar errado | com o Mailpit, abra http://localhost:8025 (não o Gmail) |
| E-mail não chega no Mailpit | container parado ou `.env` sem reiniciar | `docker ps` mostra `mailpit`? Reinicie o `npm run dev` |
| Criativo fica em "Na fila" | o tick não rodou | `npm run tick` (7.3) |
| `/criativos` dá erro de tabela | migration dos criativos não aplicada | 1.3 |
