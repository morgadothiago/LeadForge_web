# SPEC-061 — Exportacao de dados pessoais (LGPD art. 18, V — portabilidade) com confirmacao por e-mail, geracao assincrona e entrega por link assinado
- status: DRAFT (aguardando APROVAR SPEC-061) | domain: fullstack (061a backend / 061b frontend; `## Backend`, `## Frontend`) | depende de: 049 (org ativa, owner/membro), 050 (storage + URL assinada), 054 (padrao de token/janela/retencao; `retention.ts`), 059 (rate limit persistente) | tambem usa: 052 (`sendOnce`), 013 (tick) | catalogo: LGPD (P0 conformidade; fecha Q-054-6/D-054-6)
- Premissas minhas estao marcadas **INFERRED** (revisaveis). Nada aqui e parecer juridico.

## Objetivo
Permitir que o usuario autenticado peca uma copia dos seus dados pessoais em formato estruturado e de uso comum (LGPD art. 18, V, portabilidade; art. 18, II acesso), com confirmacao por e-mail, geracao assincrona por job no tick, entrega por link de download de curta duracao, e-mails "pedido recebido / pronto / expirado" e auditoria. Quando o usuario e **owner** de uma organizacao, pode (opcionalmente, por org) incluir os dados da organizacao que administra. A resposta completa deve sair dentro do prazo legal (D-061-14).

## Contexto (lido no repo)
- Nao existe exportacao hoje (grep em `src/lib/actions/`: nenhuma `export*Data`). A 054 deixou explicito fora de escopo (D-054-6 / Q-054-6) e o `docs/RETOMAR.md` (secao 3, item 5) lista como "SPEC futura".
- Modelo de pedido sensivel ja existe: `AccountDeletionRequest` (`schema.prisma:1117`): `userId` sem FK, so hash de token/e-mail, ciclo pedido -> confirmado -> executado/cancelado; token via `newDeletionToken()`/`hashDeletionToken` (`src/lib/account-deletion/constants.ts`, 32 bytes base64url, sha256 no banco, TTL 24h). Padrao reaproveitavel (reautenticar com senha, e-mail de confirmacao, pagina publica que so faz preview no GET e consome no clique).
- `src/lib/account-deletion/retention.ts` e a fonte unica do que e apagado/anonimizado/retido (`DELETED_ITEMS`, `ANONYMIZED_ITEMS`, `RETAINED_ITEMS`); apos a purga a linha do `User` fica anonimizada e `Campaign.userId` e Restrict.
- Storage (SPEC-050): `StorageProvider` (`src/lib/storage/provider.ts`) com `put/delete/exists/getReadUrl/list`; URL assinada somente-leitura, **TTL maximo 900 s** (`MAX_SIGNED_URL_TTL_SECONDS`), default 300 s. Chaves hoje sempre `orgs/{orgId}/{category}/{uuid}-{nome}` (`keys.ts`, `assertKeyInOrg`), `StoredFileCategory` e enum de banco (`creative|knowledge|attachment`). `service.ts`: `getFileUrl(orgId,id)`, `purgeOrgFiles`, `reconcileOrgBlobs` (reconciliacao ignora o que nao e StoredFile? **precisa ser verificado** antes de gravar o ZIP sob outro prefixo).
- E-mail: `sendOnce({dedupeKey, scenario, to, subject, html, text, orgId?, userId?})` (`src/lib/channels/email/send-once.ts`), best-effort, reserva em `EmailDispatchLog` ANTES de enviar; cenarios em `EmailScenario` (`scenario.ts`) com remetente noreply para fluxos de conta.
- Tick: `/api/cron/tick` (`maxDuration = 60`, orcamento efetivo ~25 s por rodada, `scheduler/config.ts`) chama `runTick` -> jobs isolados com `.catch` (`run-tick.ts:142-149`, ex.: `runAccountDeletionJob`). Cron por minuto no plano Pro da Vercel ainda e pendencia (RETOMAR); portanto o job precisa ser **fatiavel/retomavel** e tolerar rodadas esparsas.
- Rate limit: `SlidingLimiter` em `src/lib/integrations/rate-limit` (usado por `org/rate-limit.ts`) e backend Redis com fallback em memoria (`src/lib/rate-limit/redis.ts`, SPEC-059). Limiter por usuario existe como padrao.
- Dados do usuario: `User` (nome, e-mail, `role`, `avatarUrl`, `emailVerifiedAt`, `lastOrgId`, `createdAt`; **`passwordHash`/`sessionsInvalidatedAt` nunca saem**), `Membership`, `OrgInvite` (criados por ele / enderecados ao e-mail dele), `OrgAuditLog` (ator/alvo), `EmailAccount` (SMTP; contem segredo), `MobileDevice` (contem `refreshHash`), `MobileActionLog`, `StoredFile` (`uploadedByUserId`), `Campaign.userId`, `Creative.createdBy`, `Meeting.createdById`, `EmailDispatchLog` (so scenario/dedupeKey), `IntegrationAuditLog` (userId sem FK), `AccountDeletionRequest`.
- Dados da org (owner): `Organization`, `Subscription`, `Lead`, `Touch`, `LeadNote`, `Opportunity`, `StageHistory`, `Campaign`, `IcpProfile`, `Sequence`/`SequenceStep`, `MessageTemplate`, `Meeting`, `Creative`/`CreativeJob`, `StoredFile`, `Suppression`, `Draft`/`Agent*`/`KnowledgeDocument`, `WebhookEvent`, `IntegrationSecret` (segredo!), `WhatsAppInstance.apiKey` (segredo!), `LeadSourceBinding`, `SearchRun`.

## Natureza do direito e papeis (LGPD) — premissa de escopo
O LeadForge e **controlador** dos dados de conta/cadastro do usuario e **operador** dos dados de leads da org (os titulares dos leads sao do cliente-controlador; ja tratado assim na 054). Portanto: o direito do art. 18 do **usuario** cobre os dados dele; os dados de leads sao **portabilidade de dados da organizacao (cliente/B2B)**, oferecida como recurso do contrato ao owner, nao como atendimento de titular. Isso orienta D-061-1/D-061-2 (**INFERRED**; validar com juridico, Q-061-1).

## Escopo proposto
### Backend (061a)
1. **Modelo** `DataExportRequest` (aditivo, migration a mao; ver "Modelo de dados"). Sem FK em `userId` (sobrevive a anonimizacao, como 054) e sem armazenar e-mail em claro nem token em claro.
2. **Fluxo**: (a) `requestDataExport({password, scopes})` reautentica (senha), valida papel/escopo, aplica rate limit e cria pedido `awaiting_confirmation` + e-mail de CONFIRMACAO com link `APP_BASE_URL/conta/exportar/<token>` (uso unico, 24h, so hash no banco); (b) confirmar no link (preview no GET, consumo no clique) -> `queued` + e-mail "pedido recebido" com prazo; (c) job `runDataExportJob` no tick gera o pacote por **fases retomaveis**, grava o ZIP no storage e marca `ready` + `expiresAt`; (d) e-mail "pronto" com link para a pagina autenticada de download; (e) cada clique em "Baixar" gera URL assinada curta (<= 300 s) apos revalidar sessao + dono do pedido; (f) job expira (apaga blob, marca `expired`) e envia "expirado" (opcional, D-061-11).
3. **Montagem do pacote** (`src/lib/data-export/`): `collectors/*` (um coletor por entidade, cada um com lista EXPLICITA de campos — nunca `select *`/spread de linha), `redact.ts` (lista de campos proibidos + varredura final), `package.ts` (ZIP em streaming para o storage, sem materializar tudo em memoria), `manifest.ts`.
4. **Isolamento multi-tenant**: coletores de org recebem `orgId` ja validado (membro owner ativo no momento da geracao) e usam `scopedPrisma(orgId)`; coletores do usuario filtram por `userId` da sessao/pedido. Org e escopo sao **congelados no pedido** mas **revalidados na geracao** (owner pode ter sido removido).
5. **E-mails novos** (noreply; html+texto; links absolutos; PT-BR): `data_export_confirm`, `data_export_requested`, `data_export_ready`, `data_export_expired` (opcional), todos via `sendOnce` com `dedupeKey` `data_export_<fase>:<requestId>`; cenarios em `EmailScenario` e nas tabelas Resend/ACS.
6. **Auditoria**: registrar pedido/confirmacao/pronto/download/expirado/falha (D-061-12), sem conteudo do pacote.
7. **Interacao com exclusao (054)**: ver D-061-9.
8. **Testes**: ver "Plano de testes".

### Frontend (061b)
9. Tela **Configuracoes > Conta > "Exportar meus dados"** (junto da 054b): explicacao do que entra/nao entra, escolha de escopo (so meus dados / + dados da organizacao X, so para owner), senha, estados (nenhum pedido, aguardando confirmacao, na fila/gerando com progresso, pronto com "Baixar" e validade, expirado, falhou, limite atingido), historico curto dos ultimos pedidos.
10. Pagina publica/semi-publica `/conta/exportar/[token]` (confirmar; preview no GET, acao no clique; estados confirmado / invalido-expirado-usado generico / erro / rate limit), liberada no `proxy.ts`.
11. a11y e PT-BR (ver "Telas").

## Decisoes numeradas (propostas — aguardam aprovacao; nenhuma CONFIRMED pelo usuario)

### Escopo do que sai
- **D-061-1 (INFERRED) — Pacote "Meus dados" (todo usuario, qualquer papel):** perfil (`id`, nome, e-mail, `role`, `avatarUrl` como URL/arquivo, `emailVerifiedAt`, `createdAt`, `updatedAt`); `Membership` (org id/nome, papel, desde quando); convites enviados por ele e enderecados ao e-mail dele (sem `tokenHash`); `OrgAuditLog` em que ele e ator ou alvo; contas de e-mail conectadas (**so metadados**: provedor, endereco, remetente, status; sem senha/segredo); dispositivos moveis (**metadados**: nome/plataforma/criado/ultimo uso; sem token/`refreshHash`/push token); `MobileActionLog` e `IntegrationAuditLog` dele; arquivos que ele enviou (`StoredFile` com `uploadedByUserId`, metadados + o arquivo no ZIP); autoria de campanhas/criativos/reunioes (ids, nomes, datas — o conteudo completo e o da org, D-061-2); historico de e-mails de sistema (`EmailDispatchLog`: cenario e data — o corpo nao e guardado); historico de pedidos de exclusao/exportacao dele (`AccountDeletionRequest`/`DataExportRequest`: datas e status, sem hashes).
- **D-061-2 (INFERRED) — Pacote "Dados da organizacao" (opt-in, SO owner ativo da org, uma org por pedido):** `Organization` (nome, slug, status, datas), `Subscription` (plano, status, ciclo, datas; sem ids de provedor de pagamento sensiveis, ver D-061-4), `Lead` (+ `LeadNote`, `Touch`/mensagens, `StageHistory`, `Opportunity`), `Campaign`, `IcpProfile`, `Sequence`/`SequenceStep`, `MessageTemplate`, `Meeting`, `Creative` (metadados + arquivos de video/thumbnail ja em `StoredFile`), `StoredFile` (`creative|knowledge|attachment`: metadados + arquivos), `Suppression`, `Agent`/`KnowledgeDocument` (config e documentos, sem chaves), `LeadSourceBinding` (sem tokens), historico de membros e convites da org. Racional: o owner responde pela org e precisa levar leads/campanhas se for cancelar; membro comum (`member`) **nao** exporta dados da org (ele nao tem direito de portabilidade sobre os leads do cliente) — so o Pacote 1.
- **D-061-3 (INFERRED) — O que NAO sai, em hipotese alguma:** `passwordHash`; `sessionsInvalidatedAt`; `PasswordResetToken`/`EmailVerificationToken`/`OrgInvite` `tokenHash`; `MobileDevice.refreshHash`/push tokens; `EmailAccount` senha/segredo SMTP; `IntegrationSecret.encryptedValue` e qualquer chave de integracao; `WhatsAppInstance.apiKey` e tokens de webhook; `LeadSourceBinding` tokens/segredos; `AccountDeletionRequest.tokenHash/cancelTokenHash/emailHash`; `DataExportRequest.tokenHash`; qualquer valor com prefixo secret-box `v1:`; segredos de `.env`. Implementacao: **allowlist de campos por coletor** + `redact.ts` (denylist de nomes de campo e de padroes de valor, ex.: `v1:`, JWT, `Bearer`, `sk_`) + **varredura final do JSON/CSV gerado que ABORTA a geracao** se achar um padrao proibido (falha segura: `failed` com codigo `redaction_violation`, alerta em log sem o valor).
- **D-061-4 (INFERRED) — Dados de terceiros:** leads sao dados pessoais de **terceiros** (titulares dos leads) dentro da org do owner: sao exportaveis SOMENTE no Pacote 2 (org do proprio owner, direito contratual do cliente), nunca no Pacote 1 e nunca de outra org. Dados de outros membros da mesma org (nome/e-mail de colegas) aparecem so como o minimo necessario (id, nome, e-mail, papel) no historico de membros do Pacote 2, e **nao** aparecem no Pacote 1 alem do que e dele (ex.: no `OrgAuditLog` onde ele e ator, o alvo e referenciado por id + nome, sem e-mail). Pagamentos: so campos de assinatura que o cliente ja ve na tela de plano; ids brutos de provedor (Stripe/AbacatePay) e `WebhookEvent` (payload bruto com dados de terceiros) ficam **fora** (Q-061-5 pergunta se o owner quer recibos).
- **D-061-5 (INFERRED) — Mensagens de leads:** `Touch` (corpo outbound/inbound) entra no Pacote 2. Pode ser grande: ver limites (D-061-8).

### Formato
- **D-061-6 (INFERRED):** um unico `.zip` por pedido, nome `leadforge-export-<YYYYMMDD>-<requestId8>.zip`. Estrutura: `manifest.json` (versao do schema do export, data, escopos, contagens por entidade, `sha256` por arquivo, avisos), `README.txt` (PT-BR simples: o que e cada arquivo, como abrir, o que foi omitido e por que), `usuario/*.json` (**JSON estruturado**, UTF-8, datas ISO-8601 UTC, `snake_case` ou `camelCase` do schema — escolher o do Prisma/`camelCase`), `organizacoes/<orgSlug>/*.json`, e **CSV opcional** (`csv/leads.csv`, `touches.csv`, `campanhas.csv`, `reunioes.csv`) gerado quando o pedido marca "incluir planilhas" (CSV com BOM UTF-8, separador `,`, cabecalho em PT-BR, **neutralizacao de formula injection**: prefixar `'` em celulas iniciadas por `= + - @ \t \r`), e `arquivos/<categoria>/<id>-<nome>` com os binarios (`StoredFile`) quando marcado "incluir arquivos". JSON e a fonte de verdade ("formato estruturado, de uso comum e leitura automatica"); CSV e conveniencia.
- **D-061-7 (INFERRED):** versao do formato `schemaVersion: 1` no manifest; mudancas incompativeis sobem a versao.

### Assincrono vs sincrono
- **D-061-8 (INFERRED, recomendacao: ASSINCRONA):** geracao por **job no tick**, nao em Server Action/Route Handler. Motivos: tamanho imprevisivel (leads/touches/arquivos; videos de criativos), `maxDuration` 60 s e orcamento de ~25 s/rodada, necessidade de retomar apos queda, e evitar timeout/ocupar a request. Desenho do job (`runDataExportJob`): pega UM pedido `queued|generating` por rodada com claim atomico (`updateMany` por status, mesmo padrao do `executedAt:null` da 054) e `lockedUntil`; processa por **fases** (cada coletor = 1 fase; paginacao por cursor id em tabelas grandes; ZIP e escrito em streaming com checkpoint via parte/arquivo intermediario `exports/<requestId>/parts/*` — se o provider nao permitir multipart, gerar uma parte por fase e fundir no final); respeita o orcamento de tempo da rodada e devolve o pedido a `queued` com `phase`/`cursor` salvos; estado visivel (`progressPct` aproximado por fases concluidas). **Fallback sincrono rejeitado** para o pacote completo; um "mini-export" sincrono so de perfil poderia existir no futuro (fora de escopo).
- **Limites do pacote (INFERRED, numeros revisaveis, Q-061-6):** teto de **2 GB** por ZIP (arquivos binarios sao a maior parte); acima disso o pedido termina `ready` com o JSON/CSV completos e os binarios omitidos listados no `manifest.json` (`omitted_files`) + aviso na tela/e-mail, nunca falha silenciosa; no maximo **1 pedido ativo** (`awaiting_confirmation|queued|generating`) por usuario.
- **Dependencia operacional:** com o cron do Vercel Hobby (diario) o pedido pode levar horas para andar; aceitavel dentro do prazo legal mas a UI deve dizer "pode levar algumas horas" (Q-061-7 sobre depender do cron por minuto).

### Entrega
- **D-061-9 (INFERRED) — Interacao com a exclusao de conta (054):** (i) exportacao e permitida durante a janela de 30 dias da exclusao? **Nao pelo login normal**, pois o login fica bloqueado (054) — mas um pedido de exportacao ja `ready` ou `generating` quando a exclusao for confirmada **continua e fica baixavel** ate o `expiresAt` *desde que antes da purga*; (ii) **a purga (054) cancela/limpa**: ao executar a purga, `DataExportRequest` do usuario em `awaiting_confirmation|queued|generating` -> `cancelled`, `ready` -> blob apagado + `expired`; link e pagina deixam de funcionar; nenhum e-mail "pronto" sai depois da purga. (iii) A tela de exclusao (054b) **oferece "Exportar meus dados antes de excluir"** (CTA que leva a esta tela) — e o fechamento da Q-054-6. (iv) Pedido de exportacao enquanto `AccountDeletionRequest` esta `scheduled`: nao e possivel (sem sessao); **via link do e-mail de confirmacao** tambem e bloqueado (`blocked: deletion_scheduled`). (v) O pacote exportado lista `AccountDeletionRequest` do usuario (datas/status). Em `retention.ts` (`RETAINED_ITEMS`) acrescentar: "registro dos pedidos de exportacao (datas e status; sem o conteudo)" (mantido como `AccountDeletionRequest`), e em `purge.ts` apagar `DataExportRequest` e blobs (D-061-13).
- **D-061-10 (INFERRED) — Link assinado de curta duracao, NAO "link magico" no e-mail:** o e-mail "pronto" aponta para `APP_BASE_URL/conta/exportar` (tela autenticada), nao para o arquivo. Ao clicar "Baixar", uma **Server Action/Route Handler autenticado** revalida sessao + `request.userId === session.userId` + status `ready` + nao expirado, e devolve **URL assinada de leitura de 300 s** (`getReadUrl`, teto 900 s da 050; `Content-Disposition` com o nome do zip). Razoes: o TTL da assinatura da 050 e curto demais para um link por e-mail; e-mail vazado nao entrega os dados; revogacao imediata. O blob fica em prefixo proprio **`exports/<requestId>/<nome>.zip`** (nao sob `orgs/<orgId>/`, pois o pacote 1 e do usuario) com helper novo em `keys.ts` (`buildExportKey`/`assertExportKey`) e **sem** linha em `StoredFile` (nao entra em listagem de org nem em `purgeOrgFiles`); verificar/ajustar `reconcileOrgBlobs` para nao tratar `exports/` como orfao (teste). Provider `local` suportado pelo mesmo caminho.
- **D-061-11 (INFERRED) — Expiracao e uso:** o pacote fica disponivel por **7 dias** apos `ready` (`expiresAt`); **download repetivel dentro da validade** (nao uso unico — falha de rede e comum com arquivos grandes), limitado a **5 downloads** por pedido (contador `downloadCount`, ao exceder, "gere um novo pedido"); apos `expiresAt` o job apaga o blob e marca `expired`, e envia o e-mail "expirado" **uma vez** (sendOnce) — a tela de historico mostra "expirado, solicite novamente". Q-061-4: uso unico estrito vs 7 dias/5 downloads.
- **D-061-12 (INFERRED) — Autenticacao forte para pedir:** reautenticacao com senha **+ confirmacao por e-mail com token de uso unico**, mesmo padrao e mesmas constantes da 054 (24h, 32 bytes, sha256; token em tabela propria, nunca em log). Conta sem senha (`no_password` da 054) -> bloqueada com mensagem para definir senha (ou, alternativa Q-061-3, so confirmacao por e-mail). `platform_admin`: pode pedir o Pacote 1 (nao tem org). Conta com e-mail **nao verificado** (055): so confirmacao por e-mail verificado — pedido bloqueado ate verificar (evita exportar dados para e-mail nao confirmado). O link de confirmacao e enviado ao e-mail **atual** da conta; se o e-mail da conta mudou nas ultimas 24h (055), bloquear (conta tomada). Aviso de seguranca ao e-mail na confirmacao e na entrega ("se nao foi voce, troque a senha").
- **D-061-13 (INFERRED) — Quem pode pedir:** qualquer usuario autenticado para o Pacote 1 (sobre si mesmo; nunca `userId` vindo do cliente); Pacote 2 apenas `Membership.orgRole = owner` ativo na org, uma org por vez (campo `orgId` validado contra a membership na confirmacao **e** na geracao). Organizacao suspensa/cancelada em retencao: owner **pode** exportar (e o momento em que mais precisa, 053/033), exceto apos o expurgo (dados anonimizados). `platform_admin` exportando de terceiros: fora de escopo.
- **D-061-14 (INFERRED) — Prazo legal:** LGPD art. 19 II: resposta completa em ate **15 dias** da requisicao (o art. 19 I permite resposta simplificada imediata). Meta de produto: pronto em **ate 24 h** apos confirmar (SLO), **alerta/escalonamento se passar de 72 h** (`queued|generating` com `confirmedAt` > 72 h gera `console.error` estruturado e marcador `slaBreached`), e **pedido `failed` ou nao entregue em 10 dias** exige acao manual (registrado no RETOMAR/runbook); o relogio legal comeca na **confirmacao por e-mail** (D-061-12), que e identificacao do titular (INFERRED, validar com juridico). O e-mail "pedido recebido" cita o prazo maximo de 15 dias.
- **D-061-15 (INFERRED) — Limites e rate limit:** **1 pedido por 24 h por usuario** (conta `confirmed`/`queued`/`generating`/`ready`; pedido nao confirmado, `failed` ou `cancelled` nao consome a cota — ou confirmado > 24 h entre eles); 5 tentativas de senha/15 min e 3 e-mails de confirmacao/h por usuario (mesmo padrao 054); confirmar token e preview por IP (10/15 min); download: 10 URLs/h por usuario; todos via `SlidingLimiter`/Redis (SPEC-059) com fallback em memoria, chaves por `userId` (nunca e-mail em claro na chave: `hashKeyPart`). Resposta de limite: `code: ["rate_limited"]` + `retryAfterSeconds`.
- **D-061-16 (INFERRED) — Auditoria:** `DataExportRequest` ja carrega os marcos (timestamps); alem disso, evento em `OrgAuditLog` para a org (`meta.kind = "data_export"`, sem conteudo) apenas no Pacote 2, para os demais owners poderem ver que alguem exportou os dados da org (e `notifyOrgOwners` via `sendOnce`, padrao 056, e-mail curto "owner X exportou dados da organizacao" — opcional, Q-061-8). Log estruturado do job sem PII (ids, contagens, duracao). **Nunca** logar conteudo, nomes de arquivo com PII ou URLs assinadas.
- **D-061-17 (INFERRED) — E-mails (padrao `sendOnce`, noreply):** `data_export_confirm` (confirmacao, link 24h), `data_export_requested` (pedido recebido: o que sera incluido, prazo ate 15 dias, tipicamente algumas horas), `data_export_ready` (pronto: validade 7 dias, link para a tela, aviso de seguranca), `data_export_expired` (opcional; "expirou, peca novamente"). `dedupeKey`: `data_export_requested:<id>`, `data_export_ready:<id>`, `data_export_expired:<id>`; confirmacao reenviavel por pedido novo (novo `id`). Provider falhando **nao** impede a geracao (best-effort); a tela mostra o estado e o botao de baixar mesmo sem e-mail.
- **D-061-18 (INFERRED) — Retencao do proprio pedido:** `DataExportRequest` (so metadados: datas, status, escopos, tamanho, contagens; nunca o conteudo) mantido por **6 meses** como comprovante de atendimento do art. 18 (alinhado ao prazo de logs da 054); depois apagado pelo job de limpeza; na exclusao de conta (054) o que sobra e a linha ja listada em `RETAINED_ITEMS` (so `AccountDeletionRequest`) — `DataExportRequest` do usuario e apagada na purga (D-061-9). Q-061-9: manter comprovante apos exclusao?
- **D-061-19 (INFERRED) — Isolamento e seguranca de implementacao:** `requireUser()` em toda action; `userId`/`orgId` SEMPRE da sessao/pedido, nunca do payload; coletor de org recebe `orgId` ja autorizado e usa `scopedPrisma`; pedido so e visivel/baixavel pelo `userId` dono (IDOR: outro usuario -> `not_found`, nunca 403 que revela existencia); token publico generico no erro (invalido/expirado/usado); `robots: noindex`, `referrer: no-referrer` na pagina publica; ZIP sem path traversal (nomes sanitizados via `sanitizeFileName`, sem `..`, sem nome absoluto); `Content-Type: application/zip` + `Cache-Control: no-store`; sem `eval`/template de formula em CSV (D-061-6).
- **D-061-20 (INFERRED):** dividida em 061a (backend) e 061b (frontend), igual 054; uma unica migration aditiva.

## Modelo de dados proposto (migration aditiva, escrita a mao; NUNCA `migrate dev`/`reset`)
```prisma
enum DataExportStatus {
  awaiting_confirmation
  queued
  generating
  ready
  failed
  expired
  cancelled
}

/// SPEC-061: pedido de exportacao de dados (LGPD art. 18 V). userId SEM FK (sobrevive a anonimizacao, como 054); so HASH do token;
/// nunca guarda o conteudo do pacote (so metadados). orgId so quando o pedido inclui dados da org (owner).
model DataExportRequest {
  id              String           @id @default(uuid())
  userId          String
  status          DataExportStatus @default(awaiting_confirmation)
  orgId           String?          // pacote 2 (owner); sem FK
  includeCsv      Boolean          @default(false)
  includeFiles    Boolean          @default(true)
  tokenHash       String           @unique
  requestedAt     DateTime         @default(now())
  expiresAtConfirm DateTime        // validade do token de confirmacao (24h)
  confirmedAt     DateTime?
  startedAt       DateTime?
  lockedUntil     DateTime?        // claim do job (lease)
  phase           String?          // fase atual do job (retomada)
  cursor          Json?            // cursor/checkpoint por coletor (sem dados pessoais alem de ids)
  attempts        Int              @default(0)
  progressPct     Int              @default(0)
  readyAt         DateTime?
  expiresAt       DateTime?        // fim da validade do pacote (readyAt + 7d)
  blobKey         String?          @unique // exports/<id>/<nome>.zip
  sizeBytes       BigInt?
  counts          Json?            // contagens por entidade (sem dados)
  omittedFiles    Int              @default(0)
  downloadCount   Int              @default(0)
  lastDownloadAt  DateTime?
  failedAt        DateTime?
  failureCode     String?          // enum logico (redaction_violation, storage_error, org_access_lost, timeout...), sem mensagem com PII
  slaBreachedAt   DateTime?
  expiredMailAt   DateTime?
  cancelledAt     DateTime?

  @@index([userId, requestedAt])
  @@index([status, lockedUntil])
  @@index([expiresAt])
}
```
- Migration `YYYYMMDDHHMMSS_data_export_request`: so `CREATE TYPE`/`CREATE TABLE`/`CREATE INDEX`. Aplicar APENAS no banco de teste dedicado (como `leadforge_054_test`); `prisma migrate deploy` no banco de dev fica para o usuario. `BigInt` exige cuidado de serializacao (converter para `number`/string no contrato).
- Sem alteracao nas tabelas existentes; cenarios novos entram apenas em `EmailScenario`/mapas de remetente (codigo).

## Endpoints / Server Actions (contrato para o frontend; `"use server"`, `ActionResult<T>`, zod em `src/lib/schemas/data-export.ts`)
| Action / rota | Acesso | Entrada | Sucesso (`data`) | Erros (`errors`) |
|---|---|---|---|---|
| `getDataExportState()` | sessao | — | `{canRequest, nextAllowedAt, ownerOrgs:[{id,name}], active:{id,status,progressPct,requestedAt,confirmedAt,expiresAtConfirm}|null, latest:{id,status,readyAt,expiresAt,sizeBytes,downloadsLeft,omittedFiles,failureCode}|null, history:[...ultimos 5], limits:{packageTtlDays:7,maxDownloads:5,legalDeadlineDays:15}, blockers:[{code,message}]}` | `_form` |
| `requestDataExport({password, scope:"me"|"me_and_org", orgId?, includeCsv, includeFiles})` | sessao | senha + escopo | `{emailSent, expiresAt}` | `password`; `code:["blocked"]`+`blockers` (`deletion_scheduled`, `email_unverified`, `no_password`, `not_owner`, `org_not_found`, `active_request`); `code:["rate_limited"]`+`retryAfterSeconds`; `code:["daily_limit"]`+`nextAllowedAt` |
| `cancelDataExport({id})` | sessao | id | `{cancelled:true}` | `code:["not_cancellable"]` (so `awaiting_confirmation|queued`) |
| `previewDataExportToken({token})` | PUBLICA (rate limit IP) | token | `{valid:false}`\|`{valid:true, scope, expiresAt}` | `code:["rate_limited"]` |
| `confirmDataExport({token})` | PUBLICA | token do e-mail | `{status:"queued", etaHint, legalDeadlineAt}` | `code:["token_invalid"]` (generico); `code:["blocked"]`+`blockers` |
| `GET /api/data-export/[id]/download` (Route Handler, `requireUser`) | sessao + dono | — | `302`/JSON `{url, expiresInSeconds:300, fileName}` (incrementa `downloadCount` de forma atomica ate 5) | `404` (nao dono/inexistente/nao pronto), `410` expirado, `429` (+`Retry-After`), `409` limite de downloads |
- Rotas publicas a liberar no `proxy.ts`: `/conta/exportar/[token]`. Rota autenticada: `/configuracoes/conta` (secao nova) — **nao** liberar `/api/data-export/*` no proxy publico.
- Job: `runDataExportJob(now)` em `src/lib/data-export/job.ts`, registrado em `run-tick.ts` ao lado de `runAccountDeletionJob` (isolado com `.catch` + `safeErrorForLog`); 3 sub-etapas por rodada: (1) gerar/continuar 1 pedido, (2) expirar `ready` vencidos + enviar `expired`, (3) limpar comprovantes > 6 meses e confirmacoes vencidas.
- Cenarios de e-mail novos em `scenario.ts` + `templates/data-export-*.ts` + testes de `scenario.test.ts`.

## Telas (061b) — pt-BR, a11y
- **Configuracoes > Conta > card "Exportar meus dados"** (abaixo/ao lado de "Excluir minha conta"; a 054b ganha o CTA "Exportar antes de excluir"): texto curto "o que vem no arquivo / o que fica de fora (senhas, chaves e tokens nunca saem)"; **escopo** em `RadioGroup` ("So os meus dados" / "Meus dados + dados da organizacao <nome>", so se `ownerOrgs.length>0`; org via `Select` se mais de uma); `Checkbox` "Incluir planilhas CSV" e "Incluir arquivos enviados"; campo senha (`PasswordInput`); botao "Pedir exportacao". RHF + `zodResolver` com o mesmo schema da action (padrao 042/045).
- **Estados**: (1) *vazio* — nenhum pedido: formulario; (2) *aguardando confirmacao* — "Confira seu e-mail" com validade, "Reenviar" (com senha) e "Cancelar pedido"; (3) *na fila/gerando* — barra de progresso (`role="progressbar"` com `aria-valuenow`), texto "Pode levar algumas horas; avisaremos por e-mail. Prazo maximo legal: 15 dias.", "Cancelar" so enquanto `queued`; (4) *pronto* — "Seu arquivo esta pronto", tamanho, validade ("disponivel ate DD/MM/AAAA"), downloads restantes, botao "Baixar", aviso de arquivos omitidos se houver; (5) *erro/falhou* — mensagem generica PT-BR + "Tentar novamente" respeitando limite; (6) *expirado* — "O arquivo expirou" + "Pedir novamente"; (7) *limite diario* — "Voce ja pediu uma exportacao nas ultimas 24 h; novo pedido a partir de DD/MM HH:mm"; (8) *bloqueios* — por codigo, titulo + mensagem do servidor (e-mail nao verificado, exclusao agendada, sem senha, nao e owner). Historico dos ultimos 5 pedidos em tabela (data, escopo, status, expira).
- **Pagina publica** `/conta/exportar/[token]`: abrir o link so faz preview (GET nunca consome); botao "Confirmar pedido de exportacao"; sucesso/invalido-expirado-usado (generico)/erro/rate limit; `noindex`, `no-referrer`; foco movido para o resultado, `role="alert"/"status"` + `aria-live`.
- **a11y**: labels por `htmlFor`, `aria-invalid/describedby`, `aria-busy` no submit, foco visivel, ordem de tab logica, contraste WCAG AA nos dois temas (tokens do design system, dark mode), atualizacao do progresso anunciada por `aria-live="polite"` sem spam (so em mudanca de fase), polling de estado a cada 10-15 s **somente** com status `queued|generating` (e pausa com a aba oculta), botoes >= 44 px no mobile, listas empilhadas no mobile. Datas DD/MM/AAAA (UTC, mesmo padrao 054). Nenhum codigo tecnico exposto ao usuario.

## Fora do escopo / para depois
- Exportacao por `platform_admin` em nome de terceiros; atendimento de **titulares de leads** (art. 18 de quem nao e usuario): processo manual/DPO fora da app (Q-061-1).
- Portabilidade para formatos de outros CRMs; API publica de export; export recorrente/agendado; exportacao incremental.
- Criptografia do ZIP com senha do usuario (AES-ZIP) — avaliar depois (Q-061-10); por ora a protecao e: sessao + URL curta + expiracao + armazenamento privado.
- Mini-export sincrono (so perfil) e resposta simplificada imediata (art. 19 I).
- Anonimizacao/remocao dos dados dos leads sob pedido do titular do lead.
- `RETAINED_ITEMS`/prazo de descarte de 5 anos de cobranca (pendencia da 054).
- App mobile (nenhuma alteracao em `../mobile/` nem no contrato `/api/mobile/v1`; regra transversal do bloco SaaS).

## Plano de testes (vitest, banco de teste dedicado)
**Backend (061a)**
1. Token: uso unico, expirado, reuso, tipo trocado, so hash no banco, sem vazamento em log; confirmacao respeita bloqueios (nao consome o token se bloqueado).
2. Reautenticacao: senha errada, rate limit, conta sem senha, e-mail nao verificado, e-mail alterado < 24 h.
3. Autorizacao de escopo: `member` pedindo `me_and_org` -> `not_owner`; owner de org A pedindo org B -> `org_not_found`; owner removido entre pedido e geracao -> `failed: org_access_lost` e o pacote nao e gerado; org suspensa/em retencao exporta; org expurgada nao.
4. Limites: 1 pedido/24 h (dentro/fora da janela; `failed` e `awaiting_confirmation` nao consomem), 1 pedido ativo, downloads <= 5, URL de 300 s, rate limit com Redis fake e fallback em memoria.
5. Job: claim atomico (duas execucoes concorrentes nao geram duas vezes), retomada por fase/cursor apos corte de orcamento, idempotencia (rerodar nao duplica e-mails nem blobs), expiracao (blob apagado, `expired`, e-mail uma vez), falha de provider de e-mail nao impede a geracao, falha de storage -> `failed` + `failureCode` sem PII, SLA (marcacao de 72 h).
6. Conteudo do pacote: manifest correto (contagens, sha256, `omitted_files`), JSON valido contra schema (zod), CSV com neutralizacao de formula e BOM, nomes de arquivo sanitizados (sem traversal), pacote > teto omite binarios e avisa.
7. **Regressao de isolamento multi-tenant (obrigatoria):** fixture com 2 orgs (A e B) + usuarios em ambas; exportar user X (owner de A, membro de B): o pacote contem A, **nao contem nenhum registro de B alem da membership** (varredura por ids/nomes unicos de B em todo o ZIP); exportar user Y (so B) nao contem dados de A; leads/touches/arquivos de B nunca aparecem no export de A; `StoredFile` de outra org e `exports/` de outro usuario inacessiveis; IDOR no download (usuario Z recebe 404 para o pedido de X); pedido de X nao e listado para Y.
8. **Regressao de vazamento de segredo (obrigatoria):** semear valores sentinela em `passwordHash`, `IntegrationSecret.encryptedValue`, `WhatsAppInstance.apiKey`, `EmailAccount` senha, `MobileDevice.refreshHash`, tokenHashes, `EmailDispatchLog`, `LeadSourceBinding` tokens e `v1:`-prefixados; gerar o export completo (todos os escopos/CSV/arquivos) e afirmar que **nenhum sentinela aparece em nenhum arquivo do ZIP** (varredura binaria/texto, inclusive dentro de JSON aninhado e `manifest.json`); teste de contrato que **falha** se um coletor novo retornar campo fora da allowlist; teste que a varredura final aborta com `redaction_violation` quando um coletor "vaza" de proposito (mutante).
9. Interacao 054: pedido durante exclusao agendada bloqueado; exclusao confirmada com export `ready` -> baixavel ate a purga; purga cancela/limpa pedidos e blobs e nao envia "pronto" depois; `retention.ts` x texto dos e-mails de exportacao coerentes (teste cruzado, padrao 054).
10. E-mails: 4 cenarios no remetente noreply (Resend/ACS), `sendOnce` uma vez por marco, links absolutos, PT-BR, sem token/URL assinada nos logs.
11. Migration aditiva: `prisma migrate diff` sem diferenca no banco de teste; nenhum banco dropado/resetado.

**Frontend (061b)**: SSR/RTL dos 8 estados da tela, schema compartilhado, bloqueios por codigo, pagina publica (preview nao consome; confirmar; estados), `proxy.test.ts` (rota publica liberada; `/api/data-export/*` nao publica), progressbar com ARIA, polling so em `queued|generating`, CTA da 054b. Validacao em navegador/leitor de tela fica como PENDENTE do usuario (como nas SPECs anteriores).
**Gates**: `npx tsc --noEmit`, `npm run lint` (0 erros), `npx vitest run` verdes.

## Criterios de aceitacao
- [ ] Pedido (senha) -> e-mail de confirmacao -> confirmacao por link -> e-mail "pedido recebido" -> job gera o ZIP -> e-mail "pronto" -> download pela tela autenticada, cada e-mail exatamente uma vez.
- [ ] Pacote 1 contem os itens de D-061-1; Pacote 2 so para owner ativo, uma org, com os itens de D-061-2; `manifest.json` e `README.txt` presentes e corretos.
- [ ] Nenhum segredo/hash/token/chave de D-061-3 aparece em nenhum arquivo do ZIP (teste com sentinelas passa; varredura aborta geracao em caso de violacao).
- [ ] Teste de isolamento: nenhum dado de outra org nem de outro usuario no pacote; IDOR no download retorna 404.
- [ ] Geracao assincrona pelo tick: retomavel, idempotente, claim atomico; nao excede o orcamento da rodada; SLO 24 h e alerta aos 72 h implementados.
- [ ] Download via URL assinada de 300 s, so apos revalidar sessao/dono; max 5 downloads; expiracao em 7 dias apaga o blob e envia "expirado" uma vez.
- [ ] 1 pedido por 24 h e 1 pedido ativo por usuario; rate limits (SPEC-059) com `retryAfterSeconds`; tela mostra "proximo pedido a partir de".
- [ ] Interacao com 054: pedido bloqueado com exclusao agendada; purga limpa pedidos/blobs; tela de exclusao oferece "Exportar antes de excluir"; `retention.ts`/e-mail #14 atualizados e coerentes.
- [ ] Tela: 8 estados (vazio, aguardando, gerando/progresso, pronto, erro, expirado, limite, bloqueios), a11y e dark mode, PT-BR, sem codigos tecnicos.
- [ ] Prazo legal: "pedido recebido" informa ate 15 dias; falha/atraso > 72 h e visivel para operacao.
- [ ] Migration aditiva escrita a mao e aplicada so no banco de teste; `tsc`, lint e vitest verdes; nenhum banco dropado/resetado; nada em `../mobile/`.
- [ ] `docs/RETOMAR.md`, `ROTEIRO_DE_TESTES.md` e `PRIMEIROS_PASSOS.md` (linguagem simples) atualizados ao fechar cada parte.

## Riscos
- **Vazamento de segredo/PII de terceiro no pacote** (maior risco): mitigado por allowlist por coletor, denylist, varredura final que aborta e testes com sentinelas; revisao de QA obrigatoria antes de producao.
- **Vazamento entre orgs/IDOR**: `scopedPrisma`, `orgId` congelado + revalidado, testes de regressao (item 7).
- **Conta tomada pedindo export**: senha + e-mail confirmado + aviso de seguranca + bloqueio por e-mail alterado recentemente; link por e-mail nunca da acesso direto ao arquivo.
- **Pacote grande / timeout / custo de storage**: fases retomaveis, teto de 2 GB, expiracao em 7 dias, limpeza de partes intermediarias; custo de egress do Azure (Q-061-6).
- **Depender de cron esparso (Hobby)**: atraso de horas; mitigado por mensagem na UI e SLA de 15 dias; ideal cron por minuto (pendencia RETOMAR).
- **Juridico**: papeis controlador/operador, inclusao de dados de leads no Pacote 2, relogio do prazo e retencao do comprovante precisam de validacao do usuario/advogado (nao decidimos por ele).
- **Retencao de blobs**: `reconcileOrgBlobs`/purga podem tratar `exports/` como orfao ou esquece-lo; coberto por teste e pelo job de expiracao.
- **CSV/ZIP**: formula injection e zip-slip tratados (D-061-6/19).
- **BigInt/JSON** (`sizeBytes`) e serializacao em Server Actions: converter explicitamente.

## Ordem de execucao
1. Usuario responde as perguntas abertas e diz `APROVAR SPEC-061` (status -> APPROVED; ajustar D-061-n confirmadas).
2. **dev-backend (061a)**: migration a mao + schema; `keys.ts` (`exports/`); `data-export/{constants,collectors,redact,package,manifest,service,job}.ts`; actions/route; schemas zod; templates e cenarios de e-mail; job no `run-tick.ts`; integracao com `purge.ts`/`retention.ts` da 054; testes (incl. itens 7 e 8). Aplicar migration so no banco de teste.
3. **dev-frontend (061b)** (depois do backend): card em Configuracoes > Conta, pagina publica, `proxy.ts`, CTA na tela da 054b, testes de UI.
4. **qa-reviewer** independente (foco: isolamento, segredos, IDOR, token, SLA, a11y), correcoes pos-QA.
5. Atualizar `docs/RETOMAR.md`, `ROTEIRO_DE_TESTES.md`, `PRIMEIROS_PASSOS.md`; commit + push ao fechar cada parte (memoria do projeto). `prisma migrate deploy` no banco de dev e do usuario.

## Decisoes pendentes (perguntas abertas — dependem do usuario)
- **Q-061-1 (juridico, INFERRED D-061-2/4/14):** Pacote 2 (dados de leads/titulares terceiros) pode ser entregue ao owner como portabilidade contratual? Quando comeca o relogio de 15 dias (pedido vs. confirmacao por e-mail)? Como atender titulares de leads (processo manual/DPO)? Validar com advogado.
- **Q-061-2:** o escopo da org e opt-in por pedido (recomendado) ou sempre incluido para owners? Membro comum sem nenhum dado da org (recomendado)?
- **Q-061-3:** conta sem senha (`no_password`): bloquear (recomendado, igual 054) ou aceitar so confirmacao por e-mail?
- **Q-061-4:** link: 7 dias com ate 5 downloads (recomendado) vs. uso unico estrito vs. 24 h.
- **Q-061-5:** incluir registros de cobranca/recibos no Pacote 2 (hoje fora, por conterem payload de provedor)?
- **Q-061-6:** teto de 2 GB e inclusao de arquivos/videos por padrao; aceita custo de storage/egress do Azure?
- **Q-061-7:** depender do cron do tick (Hobby diario: pode levar horas) ou contratar plano Pro (cron por minuto) antes de liberar?
- **Q-061-8:** avisar os demais owners por e-mail quando um owner exporta dados da org (recomendado: so evento em `OrgAuditLog`; e-mail opcional)?
- **Q-061-9:** manter o comprovante do pedido (`DataExportRequest`) apos a exclusao da conta, ou apagar tudo na purga (recomendado: apagar, ficando so `AccountDeletionRequest`)?
- **Q-061-10:** ZIP criptografado com senha (fica para depois, recomendado) ou ja nesta SPEC?
- **Q-061-11:** dividir em 061a/061b (recomendado, D-061-20)?
- **Q-061-12:** cota de 1 pedido por 24 h basta, ou preferir 1 por 30 dias (menos custo, mas pode contrariar o direito de acesso "gratuito e facilitado")?
