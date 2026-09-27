# SPEC-041 — Captacao de leads: Google Ads Lead Form + Meta Lead Ads
- status: APPROVED (usuario, 2026-09-27) | domain: fullstack | depende de: 018 (IntegrationSecret, agora por-org via 030), 014 (padrao /api/integrations/leads), 030 (multi-tenant)

## Objetivo
Hoje o LeadForge capta leads por 3 caminhos: busca por ICP via Google Places (SPEC-015), webhook proprio `/api/integrations/leads` (SPEC-014, `campaignId` explicito no payload, Bearer `INGEST_SECRET` GLOBAL — nao por org, ver risco abaixo) e cadastro manual. NAO existe integracao com Google Ads Lead Form Extensions nem Meta Lead Ads (Facebook/Instagram). O usuario quer adicionar as duas.

## Contexto tecnico das 2 plataformas (para orientar a decisao)
- **Google Ads Lead Form Extensions**: o Google Ads oferece 2 caminhos oficiais — (a) "Lead form download" via API do Google Ads (o anunciante consulta periodicamente os leads novos de uma campanha via API, com OAuth2 + Google Ads API), ou (b) webhook direto configurado na extensao do formulario (o Google envia um POST assinado pra uma URL do anunciante a cada novo lead, formato JSON com `google_key`/payload + assinatura HMAC pra validar). O webhook (b) e mais proximo do padrao ja usado no projeto (`/api/integrations/leads`); a API (a) exige OAuth2 completo (refresh token por conta de anuncios) e polling.
- **Meta Lead Ads (Facebook/Instagram)**: fluxo em 2 etapas — (1) Meta envia uma notificacao de webhook (Graph API "leadgen" subscription, assinado com `X-Hub-Signature-256` usando o App Secret) contendo so o `leadgen_id`, NAO os dados do lead; (2) o servidor do anunciante busca os dados completos do lead via `GET /{leadgen_id}` na Graph API, usando um Page Access Token (token de longa duracao da Pagina do Facebook vinculada ao formulario). Exige: App do Facebook registrado (App ID/App Secret), assinatura do webhook verificada, Page Access Token por Pagina (que pode ser de longa duracao, renovavel).

## Escopo proposto
- Reaproveitar ao maximo o padrao de credenciais por-org ja existente (SPEC-018, `IntegrationSecret`, ja escopado por `orgId` pela SPEC-030): novos `IntegrationKind` (`google_ads_leads`, `meta_leads` — nomes a confirmar) com os segredos por plataforma (Google: OAuth2 client id/secret + refresh token OU segredo de validacao do webhook, dependendo da decisao D-041-1; Meta: App Secret + Page Access Token por pagina).
- 2 novos webhooks (rotas publicas, no padrao de `/api/integrations/leads`): `POST /api/integrations/leads/google-ads` e `POST /api/integrations/leads/meta` (ou payload unificado num unico endpoint com campo de origem — a decidir). Diferente do `INGEST_SECRET` global atual, estes DEVEM resolver a organizacao a partir de algo que identifique de forma inequivoca qual conta de anuncios/pagina pertence a qual org (D-041-3) — nunca um segredo global unico compartilhado entre todas as orgs (esse e exatamente o padrao de risco ja documentado no `/api/integrations/leads` atual, INGEST_SECRET global, e o tipo de vazamento que ja mordeu esta sessao varias vezes em outras specs).
- Meta: verificacao de assinatura do webhook (`X-Hub-Signature-256`), depois busca do lead via Graph API com o Page Access Token da org/pagina correta.
- Google Ads: verificacao/validacao conforme D-041-1 (webhook assinado OU API com OAuth2 + polling).
- Mapeamento de campos do lead (nome/telefone/e-mail/pergunta customizada) — ambas plataformas permitem campos customizados no formulario; ver D-041-2.
- Criacao do lead reaproveitando `createLeadCore`/logica de supressao ja existente (`src/lib/domain/lead-create.ts`, `src/lib/domain/suppression.ts`).

## Fora do escopo (nesta proposta inicial)
- Sincronizacao de status do lead DE VOLTA pra Google Ads/Meta (ex.: marcar "qualificado" na plataforma de anuncios) — so importacao unidirecional por enquanto.
- Qualquer coisa em `../mobile/`.

## Decisoes fechadas (usuario, 2026-09-27, aceitou recomendacoes do orquestrador)

D-041-1: Google Ads via WEBHOOK DIRETO (nao API/OAuth2+polling) — reaproveita o padrao ja usado no projeto.

D-041-2: Mapeamento de campos FIXO (nome/telefone/e-mail nos campos padrao do `Lead`); qualquer campo customizado extra do formulario vai pro `Lead.rawData` (Json, ja existe no schema), sem UI de mapeamento configuravel nesta fase.

D-041-3: Vinculo 1:1 EXPLICITO — cada Conta de Anuncios do Google / Pagina do Meta e cadastrada pelo Provider, vinculada a exatamente 1 Campaign. O identificador que chega no payload do webhook resolve a org/campanha via essa tabela de vinculo, nunca via segredo global compartilhado (evita repetir o padrao de risco do `INGEST_SECRET` global do `/api/integrations/leads` atual).

D-041-4: Configuracao das credenciais em Configuracoes > Integracoes (SPEC-018), reaproveitando a tela existente — 2 cartoes novos (Google Ads, Meta Lead Ads) no mesmo padrao visual dos existentes.

## Riscos
- Google Ads e Meta ambos exigem processo de verificacao/aprovacao da PLATAFORMA (nao so tecnico) para producao (ex.: Meta exige App Review pra permissoes de leadgen em produção real, nao so em modo de teste/desenvolvedor) — isso e um processo externo ao codigo, fora do controle do time de dev, deve ser sinalizado ao usuario como dependencia externa antes do launch real.
- Se D-041-1 escolher OAuth2 (opcao 2), o refresh token por conta de anuncios precisa do mesmo cuidado de cifragem/rotacao ja aplicado a outros segredos (`IntegrationSecret`), e expira/pode ser revogado pelo dono da conta a qualquer momento — precisa de tratamento de erro claro quando isso acontecer.

## Ordem de execucao
Backend (dev-backend) primeiro, depois frontend (dev-frontend) para os cartoes novos em Configuracoes > Integracoes, depois QA. Aprovada, decisoes fechadas — pode implementar direto.
