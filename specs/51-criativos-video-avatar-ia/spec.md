# SPEC-051 — Area de Criativos: videos de avatar com IA
- status: IMPLEMENTED (APROVADA pelo usuario em 2026-10-10; 051a backend e 051b frontend implementados em 2026-10-10) | domain: fullstack, dividida em 051a (backend) e 051b (frontend) — D-051-10 | depende de: 050 (Blob Storage), 030 (org), 033 (planos/limites), 049 (papeis/permissoes, se aplicavel)

## Objetivo
Nova area "Criativos" para criar videos de avatar com IA (um avatar fala um roteiro) para uso em campanhas/sequences: fluxo de criacao, provedor de geracao abstraido (`AvatarVideoProvider`), jobs assincronos com status/progresso, biblioteca de criativos por org, armazenamento dos videos finais no Azure Blob (SPEC-050).

## Contexto (verdade-base)
- Nao ha nada de geracao de midia no projeto. Existe scheduler (`src/lib/scheduler/`, `SchedulerRun`), agentes LLM (`src/lib/agents/`, SPEC-018/019/036) e padrao de adapters por env (`PaymentProvider`, `EmailProvider`).
- Geracao de video por provedores externos (HeyGen, D-ID, Synthesia, Tavus etc.) e assincrona (segundos a minutos), cobrada por minuto/credito e normalmente notifica por webhook ou exige polling. Nenhum provedor foi escolhido (Q-051-1) — NAO assumido.
- Regras transversais de HTTP de saida (axios, retry/429, erro normalizado, sem vazamento de segredo) e webhook com autenticacao (padrao SPEC-012/047) se aplicam.

## Escopo proposto
### Backend
1. Modelo Prisma (aditivo, todos com `orgId`): `Creative` (id, orgId, title, status `draft|queued|processing|ready|failed|canceled`, script, language, avatarRef, voiceRef, aspectRatio, durationSec?, thumbnailFileId?, videoFileId? -> `StoredFile` da SPEC-050, createdBy, createdAt, error) e `CreativeJob` (id, orgId, creativeId, provider, providerJobId, status, attempts, lastPolledAt, costEstimate/actual, rawStatus sanitizado, timestamps). Possivel `Avatar`/catalogo cacheado do provedor (Q-051-3).
2. Abstracao `src/lib/creatives/`: `provider.ts` (interface `AvatarVideoProvider`: `listAvatars`, `listVoices`, `createVideo({script, avatar, voice, ratio...})`, `getStatus(jobId)`, `cancel?`, `verifyWebhook?`), `providers/mock.ts` (padrao do projeto: default sem chave; gera video/placeholder deterministico para dev e testes), `providers/<escolhido>.ts` (apos Q-051-1), factory `CREATIVE_PROVIDER=mock|<x>`; chaves por env (`<PROVIDER>_API_KEY`) ou por org via `IntegrationSecret` (Q-051-2).
3. Jobs assincronos: criacao enfileira `CreativeJob` (`queued`); executor/worker (reaproveitar scheduler/cron route ou webhook do provedor, Q-051-4) com polling backoff/jitter, limite de tentativas, timeout total, idempotencia (chave por creative) e recuperacao de jobs presos. Ao concluir: baixa o video do provedor por stream e grava no Blob via `StorageProvider` (`category=creative`) -> `StoredFile`; atualiza status; opcional notificacao in-app/mobile (SPEC-028/029 padrao) e e-mail.
4. Roteiro assistido por IA (opcional, Q-051-5): gerar/melhorar roteiro com o LLM ja existente (SPEC-018/036) a partir do ICP/campanha; sem isso, roteiro manual.
5. Guards/limites: `requireActiveProviderOrg`; quota mensal de minutos/criativos por plano (Q-051-6) e protecao de custo (limite de jobs simultaneos por org, confirmacao de custo estimado). Moderacao do roteiro (Q-051-7).
6. Actions: `createCreativeDraft`, `submitCreative`, `listCreatives` (paginado/filtros), `getCreative`, `cancelCreative`, `deleteCreative` (remove blob), `retryCreative`, `listAvatarsAndVoices`.
7. Webhook (se o provedor suportar): Route Handler autenticado (segredo por query + assinatura quando houver), dedup via `WebhookEvent`, 429 + Retry-After.
8. Testes: provider mock; maquina de estados do job (sucesso, falha, timeout, retry, cancelamento, job preso); isolamento por org (criativo/arquivo da org B inacessivel); quota; webhook invalido; sem vazamento de chave; nenhuma chamada a provedor real.
### Frontend
1. Item "Criativos" na sidebar; biblioteca (grid com thumbnail, status, filtros, busca, paginacao), estados vazio/erro/loading.
2. Fluxo de criacao em passos: roteiro (+ assistente IA) -> avatar -> voz/idioma -> formato (9:16/16:9/1:1) -> revisao com custo estimado -> enviar. Formularios em react-hook-form (SPEC-042).
3. Pagina do criativo: status/progresso com polling leve (ou revalidate), player (URL assinada curta), download, duplicar, excluir, tentar novamente.
4. Design conforme SPEC-002/037 (dark/light), responsivo.
5. Uso do criativo em campanha/sequence (anexar a mensagem/touch): Q-051-8 (fora do escopo se nao confirmado).

## Fora do escopo
- Clonagem de voz/avatar proprio do cliente (consentimento/legal) — Q-051-3; edicao de video/timeline; legendas avancadas; criativos de imagem/estaticos; envio do video por WhatsApp/e-mail como anexo (integracao com canais, SPEC futura); app mobile; treinar modelos.

## Criterios de aceitacao
- Com provider `mock`: criar criativo -> job assincrono -> `ready` com video salvo no storage (local/mock) e visivel na biblioteca, tudo escopado por org.
- Falha/timeout do provedor leva a `failed` com mensagem PT-BR e permite retry sem duplicar cobranca (idempotencia).
- Quota/limite respeitados; teste de vazamento cross-org passa; `tsc`, lint, vitest verdes; criterios visuais validados no navegador.

## Seguranca / riscos
- Custo descontrolado (limites por org/plano obrigatorios); conteudo gerado/uso indevido de imagem e voz (moderacao, termos do provedor, consentimento, LGPD); chaves do provedor so server-side; videos grandes (stream, nunca em memoria inteira); dependencia de terceiro (lock-in -> abstracao); jobs presos; URL assinada com TTL curto.

## Perguntas em aberto
- Q-051-1: Qual provedor de avatar (HeyGen, D-ID, Synthesia, Tavus, outro)? Orcamento/plano? Ha preferencia por provedor Azure (ex.: Azure AI Speech Text-to-Speech Avatar)? Sem decisao, a SPEC entrega so `mock` + interface.
- Q-051-2: Chave do provedor global da plataforma (custo absorvido/repassado) ou por org (BYOK via `IntegrationSecret`)?
- Q-051-3: Apenas avatares/vozes de catalogo do provedor, ou tambem avatar personalizado/clonagem de voz do cliente?
- Q-051-4: Execucao: polling por cron/scheduler existente, webhook do provedor ou ambos? Onde roda o worker (Vercel limita duracao)?
- Q-051-5: Incluir assistente de roteiro com LLM nesta SPEC?
- Q-051-6: Limites de uso por plano (minutos/criativos por mes) e como cobrar creditos extras (acopla a SPEC-033)?
- Q-051-7: Politica de moderacao/termos de uso para roteiros e avatares?
- Q-051-8: Integracao dos criativos com campanhas/sequences/canais entra agora ou em SPEC posterior?
- Q-051-9: Idiomas/formatos/duracao maxima suportados no MVP?
- Q-051-10: Dividir em 051a/051b na aprovacao?
- Q-051-11 (FECHADA em 2026-10-11 por D-051-19; achado B1 do QA): teto de retries manuais por criativo? Hoje `retryCreative` de falha do PROVEDOR cria nova geracao (cobrada) sem limite de tentativas por criativo; a cota mensal so conta o primeiro envio do mes (D-051-7). Decidir se ha teto (ex.: N retries por criativo) e se retries pos-falha do provedor consomem cota. NAO implementado.

## Decisoes (resolvem as perguntas em aberto; aprovadas pelo usuario em 2026-10-10)
- D-051-1 (Q-051-1): provedor real NAO escolhido. Entrega-se a interface `AvatarVideoProvider` + adapter `mock` (padrao; custo zero, catalogo fixo, MP4 placeholder deterministico, nunca rede) e a estrutura pronta para um adapter real futuro (registrar em `factory.ts`). Em producao a feature so liga com `CREATIVE_PROVIDER=mock` explicito (senao erro tipado `config`, app segue de pe).
- D-051-2 (Q-051-2): quando houver provider real, chave GLOBAL por env (`<PROVIDER>_API_KEY`), sem BYOK; so server-side.
- D-051-3 (Q-051-3): so avatares/vozes de catalogo (o mock expoe catalogo fixo pt-BR/en); sem avatar proprio/clonagem de voz. Avatar/voz/idioma sao validados contra o catalogo. Papeis (SPEC-049): `owner` e `member` criam/enviam/cancelam/reenviam; excluir exige `owner` OU o criador; `platform_admin` (sem org) nao opera. Escrita exige org ativa (`requireActiveProviderOrg`); leitura `requireProviderOrg`. `orgId` SEMPRE da sessao.
- D-051-4: status do criativo `draft|queued|processing|ready|failed|canceled`; status do job `queued|processing|succeeded|failed|canceled` (timeout/falhas = `failed` com `failureKind`). Soft delete (`deletedAt`) no criativo para a cota mensal continuar honesta.
- D-051-5 (Q-051-4): execucao SO por polling no tick do scheduler existente (`/api/cron/tick` chama `processCreativeJobs`, falha isolada). Backoff exponencial 5 s..60 s com jitter +-20%, `CREATIVE_JOB_MAX_ATTEMPTS` (120), timeout total `CREATIVE_JOB_TIMEOUT_MS` (30 min), lease de 5 min para retomar jobs presos, compare-and-set em toda transicao (cancelamento concorrente vence e o trabalho do worker e descartado). Webhook: so o esqueleto opcional `verifyWebhook?` na interface; sem rota nova. Orgs suspensas/canceladas nao sao processadas.
- D-051-6 (Q-051-5): SEM assistente de roteiro com LLM nesta fase (roteiro manual).
- D-051-7 (Q-051-6): limites simples por env, sem acoplar ao `Plan`: `CREATIVE_MAX_CONCURRENT_JOBS_PER_ORG` (2) e `CREATIVE_MAX_PER_MONTH_PER_ORG` (20, mes UTC). A cota conta criativos enviados (`Creative.submittedAt`); cancelar ANTES de chamar o provedor devolve; excluir NAO devolve; retry de falha do mesmo mes nao consome de novo. Checagem serializada por advisory lock da org. Custo estimado: `provider.estimateCostCents(duracao)` gravado em `CreativeJob.costEstimateCents` (mock = 0); sem tela de confirmacao no 051a.
- D-051-8 (Q-051-7): moderacao MINIMA: `CREATIVE_MAX_SCRIPT_CHARS` (3000) e `CREATIVE_SCRIPT_BLOCKLIST` (termos por virgula, sem acento/caixa; default vazio). NAO e moderacao real: depende do provedor escolhido.
- D-051-9 (Q-051-8/9): integracao com campanhas/sequences/canais FORA do escopo. Idiomas `pt-BR|en`; formatos `9:16|16:9|1:1`; duracao maxima `CREATIVE_MAX_DURATION_SEC` (120 s), validada pela duracao pedida e pela estimada do roteiro (~2,5 palavras/s).
- D-051-10 (Q-051-10): dividida em 051a (backend, IMPLEMENTED) e 051b (frontend, pendente). A SPEC so vira IMPLEMENTED apos o 051b.
- D-051-11 (idempotencia/retry): cada envio/retry cria um `CreativeJob` com `runNo` e `idempotencyKey = creative:{id}:run:{runNo}` (UNIQUE) passada ao provedor; envio/retry duplicados ou concorrentes nao criam 2 jobs. Retry de falha NOSSA (`timeout`, `download`, `storage`) reaproveita o `providerJobId` anterior (sem nova criacao/cobranca no provedor); falha do provedor (`provider_failed|rejected|unavailable`) ou cancelamento cria nova geracao. Job que morre entre criar no provedor e gravar o id e retomado e o `createVideo` repetido devolve o mesmo job (mesma chave).
- D-051-12 (armazenamento): o video final e baixado do provedor por stream e gravado por `uploadFile` da SPEC-050 (`category=creative`, MIME/magic bytes/limite por arquivo valem; `uploadedByUserId` = criador). Leitura por `getCreativeVideoUrl` (SAS curta, 5 min, via `getFileUrl`). `deleteCreative` remove o blob (`deleteFile`) e faz soft delete. Thumbnail: coluna `thumbnailFileId` existe, mas o mock nao gera thumbnail (campo fica null no 051a).
- D-051-13 (`scopedPrisma`): `creative` e `creativeJob` entraram em DIRECT_ORG_MODELS. O runner seleciona jobs devidos cross-tenant de proposito (como o scheduler, so ids/estado) e toda escrita passa por `scopedPrisma(job.orgId)` ou `$transaction` com `orgId` explicito no where.
- D-051-14 (acao extra): alem das 8 actions da SPEC, existe `getCreativeVideoUrl(id)` (necessaria para a "URL de leitura por SAS curta"). Nao ha action de editar rascunho (fora da lista): para alterar, o 051b cria outro rascunho e exclui o anterior (ou a SPEC e ampliada).

- D-051-15 (seguranca de `fetchVideo`, achado M1 do QA): a URL de download devolvida por um provedor real e NAO CONFIAVEL. PRE-REQUISITO para ligar qualquer adapter real: so https; allowlist do host do provedor/CDN; bloqueio de IP privado/loopback/169.254.x (e IPv6 equivalentes) apos resolucao DNS com conexao pinada no IP validado; revalidacao a cada redirect com limite; timeout de conexao e de inatividade; validacao de content-type. Documentado no contrato em `provider.ts`; ja existe helper reutilizavel (`src/lib/integrations/url-guard.ts`: `assertAllowedHost`/`classifyIp`/`pinnedAgents`, e `src/lib/http`). O runner aplica timeout de INATIVIDADE no stream (`downloadIdleMs`, 30 s => erro retentavel e fecha o stream). O mock nao faz rede, entao nada disso e exercitado hoje.
- D-051-16 (corrida cancel x runner, achado M2): `cancelCreative` le o job ativo com `SELECT ... FOR UPDATE`, serializando com a confirmacao do runner (`createRemote`). Ou o cancel ve o `providerJobId` gravado (chama `provider.cancel`, mantem a cota) ou o runner perde o CAS e cancela o job remoto (`provider.cancel`).
- D-051-17 (uploader, achado B2): se `Creative.createdBy` nao e mais membro da org/nao existe, o runner usa como `uploadedByUserId` o owner mais antigo da org (sem mudar schema).
- D-051-18 (lease, achados B3/B4): durante o upload o runner renova o lease (`lockedAt`) a cada leaseMs/3 (heartbeat), evitando que outro tick refaca o job.

## Contrato para o 051b
Arquivos: actions em `src/lib/actions/creative.ts` ("use server"); tipos/constantes client-safe em `src/lib/creatives/types.ts`; schemas zod (RHF, SPEC-042) em `src/lib/schemas/creative.ts` (`createCreativeDraftSchema`, `CreateCreativeDraftInput`). Todas retornam `ActionResult<T>` (`{ok:true,data}` | `{ok:false,errors:{campo:[msg]|_form:[msg]}}`, mensagens PT-BR). Nenhuma aceita `orgId`.

| Action | Entrada | Saida (`data`) | Observacoes |
|---|---|---|---|
| `listAvatarsAndVoices()` | - | `AvatarsAndVoices` `{provider, avatars[{id,name,previewUrl?}], voices[{id,name,language,gender?}], limits{maxDurationSec,maxScriptChars,maxConcurrentJobsPerOrg,maxPerMonthPerOrg}, usage{usedThisMonth,activeNow}}` | filtrar voz por idioma; mostrar uso/limites e custo (mock = 0) |
| `createCreativeDraft(input)` | `{title(<=120), script, language 'pt-BR'\|'en', avatarRef, voiceRef, aspectRatio '9:16'\|'16:9'\|'1:1', durationSec?}` | `CreativeView` (status `draft`) | valida catalogo, idioma da voz, tamanho, blocklist e duracao; erros por campo (zod) ou `_form` |
| `submitCreative(id)` | `string` ou `{id}` | `CreativeView` (status `queued`) | so de `draft`; idempotente se ja em andamento; `_form` para limite simultaneo/mensal |
| `listCreatives(input?)` | `{status?, q?, cursor?, limit?(1..50, default 20)}` | `{items: CreativeView[], nextCursor: string\|null}` | ordem `createdAt desc`; cursor = id do ultimo item; exclui removidos |
| `getCreative(id)` | `string` ou `{id}` | `CreativeDetailView` (= `CreativeView` + `jobs[]` ate 10) | usar para polling leve (a cada ~5-10 s enquanto `queued|processing`; o worker anda no ritmo do cron) |
| `getCreativeVideoUrl(id)` | `string` ou `{id}` | `{url, expiresInSeconds}` (SAS 5 min) | so com `status==='ready'`; buscar sob demanda, nao cachear alem do TTL |
| `cancelCreative(id)` | `string` ou `{id}` | `CreativeView` (`canceled`) | de `queued|processing`; cancelar na fila devolve a cota |
| `retryCreative(id)` | `string` ou `{id}` | `CreativeView` (`queued`) | de `failed|canceled`; nao cobra de novo se a falha foi nossa (timeout/download/storage) |
| `deleteCreative(id)` | `string` ou `{id}` | `{id}` | owner OU criador; cancela se ativo; remove o blob; nao devolve cota |

Tipos principais (`types.ts`): `CreativeView {id,title,status,script,language,avatarRef,voiceRef,aspectRatio,durationSec,hasVideo,videoFileId,thumbnailFileId,error,submittedAt,createdAt,updatedAt,job:CreativeJobView|null}`; `CreativeJobView {id,runNo,status,attempts,progressPct,costEstimateCents,failureKind,errorMessage,startedAt,finishedAt,createdAt}`; constantes `CREATIVE_STATUSES`, `CREATIVE_LANGUAGES`, `CREATIVE_ASPECT_RATIOS`, `ACTIVE_CREATIVE_STATUSES`. A view nunca expoe `orgId`, `providerJobId`, `idempotencyKey`, `blobKey` nem `rawStatus`.

Estados do criativo e acoes habilitadas: `draft` (enviar, excluir) -> `queued` (cancelar, excluir) -> `processing` (cancelar, excluir; `job.progressPct` pode vir null) -> `ready` (player/download via `getCreativeVideoUrl`, excluir) | `failed` (`error` PT-BR; tentar novamente, excluir) | `canceled` (tentar novamente, excluir). `failureKind`: `provider_failed|provider_unavailable|provider_rejected|timeout|download|storage|canceled`. Rota de UI sugerida `/criativos` (as actions ja chamam `revalidatePath("/criativos")`). Com o mock e o cron rodando, um criativo fica `ready` em ~1-3 ticks (`CREATIVE_MOCK_DELAY_MS`, default 3 s); em dev sem cron, dispare `GET /api/cron/tick` com `Authorization: Bearer $CRON_SECRET`.

## Criterios de aceitacao: evidencia (051a)
| Criterio | Status | Evidencia |
|---|---|---|
| Mock: criar -> job assincrono -> `ready` com video no storage, por org | PASS | `creative.test.ts` "rascunho -> enviar -> tick -> ready"; `runner.test.ts` "sucesso" |
| Falha/timeout => `failed` PT-BR; retry sem duplicar cobranca | PASS | `runner.test.ts` "falha", "timeout e retry sem duplicar cobranca", "download/storage" (create do provedor chamado 1x) |
| Maquina de estados: sucesso, falha, timeout, retry, cancelamento, job preso | PASS | `runner.test.ts` (19 testes) |
| Idempotencia (envio/retry duplo nao duplica job) | PASS | `runner.test.ts` "retry duplo...", "queued SEM providerJobId..." |
| Quotas (simultaneos, mensal, devolucao, concorrencia) | PASS | `creative.test.ts` "quotas e protecao de custo" |
| Isolamento cross-org (inclui usuario em 2 orgs com org ativa trocada; arquivo da org B) | PASS | `creative.test.ts` "isolamento cross-org" (3), `runner.test.ts` "isolamento e gate de org" |
| Sem vazamento de chave/ids internos | PASS | `creative.test.ts` "sem vazamento" |
| Nunca chama provedor real | PASS | `mock-provider.test.ts` (fetch nao chamado), `creative.test.ts` (afterEach exige fetch nao chamado) |
| `tsc`, eslint, vitest | PASS | ver Implementation Notes |
| Criterios visuais no navegador | PARCIAL | 051b: validado por testes SSR/logica; validacao no navegador autenticado NAO feita (migration dos criativos nao aplicada no banco de dev) |

## Correcoes pos-QA (051a, 2026-10-10)
- M2: `cancelCreative` com `FOR UPDATE` no job (D-051-16). Teste de corrida real em `runner.test.ts` ("M2: corrida cancel x createRemote"): intercepta a transacao do cancel e libera o runner entre a leitura e a escrita; VERIFICADO que FALHA sem o lock (`provider.cancel` = 0) e passa com ele.
- B2: fallback de uploader para owner da org (D-051-17); teste "B2".
- M1: requisitos de seguranca de `fetchVideo` documentados em `provider.ts` e D-051-15 (pre-requisito para provider real); timeout de inatividade do stream implementado no runner + teste.
- B3/B4: testes de dois `processCreativeJobs` simultaneos (so um claim) e de stream acima de `STORAGE_MAX_FILE_BYTES` (failed/storage, sem arquivo); heartbeat de lease durante upload implementado (D-051-18; sem teste dedicado — depende de relogio real, limitacao).
- B1: NAO implementado; registrado como Q-051-11.
- Limitacao (6) das notas abaixo agora esta mitigada (D-051-17); limitacao (5) parcialmente (heartbeat), mas o limite `maxDuration` da rota do cron em serverless continua.

## Implementation Notes (051a — backend, 2026-10-10)
- Arquivos novos: `src/lib/creatives/{types,config,provider,factory,moderation,messages,views,service,runner}.ts`, `src/lib/creatives/providers/mock.ts`, `src/lib/schemas/creative.ts`, `src/lib/actions/creative.ts`; testes `src/lib/creatives/{mock-provider,runner}.test.ts`, `src/lib/actions/creative.test.ts`; migration `prisma/migrations/20261011120000_creatives/{migration,down}.sql` (escrita a mao, aditiva; `prisma migrate diff` do banco de teste limpo contra o schema = "No difference").
- Arquivos alterados: `prisma/schema.prisma` (enums `CreativeStatus`/`CreativeJobStatus`, models `Creative`/`CreativeJob`, relacoes em `Organization`/`StoredFile`), `src/lib/tenant/scoped-prisma.ts` (`creative`, `creativeJob`), `src/lib/scheduler/cron-endpoint.ts` (chama `processCreativeJobs`, isolado), `src/lib/env.ts` (envs `CREATIVE_*`), `src/lib/test-utils/org-fixture.ts` (limpeza de creative/job), `.env.example`, `docs/CONFIGURACAO_POS_PROJETO.md` (secao 2d), `specs/README.md`.
- Testes (banco LIMPO `leadforge_clean_test`; nenhum banco foi dropado/resetado; `prisma migrate dev`/`db push`/reset NAO usados): `vitest run src/lib/creatives src/lib/actions/creative.test.ts src/lib/tenant src/lib/storage src/app/api/storage src/lib/scheduler src/lib/env.test.ts src/lib/billing src/test` = 26 arquivos, 337 testes PASS (VERIFIED); `tsc --noEmit` limpo (VERIFIED); `eslint src prisma` 0 erros, 14 warnings (1 ja corrigido; os demais pre-existentes) (VERIFIED); `prisma generate` ok.
- Decisoes: ver D-051-1..14. Destaques: polling no cron existente (sem rota nova); CAS em toda transicao; lease de 5 min; advisory lock por org nos limites; idempotencyKey por `creative:{id}:run:{n}`.
- Limitacoes conhecidas: (1) sem provedor real (Azure/HeyGen etc.) — so o mock; o contrato `AvatarVideoProvider` nao foi exercitado contra nenhum servico real; (2) o mock guarda o instante de criacao em memoria do processo (id desconhecido => "pronto"), so para dev/teste; (3) sem thumbnail (mock nao gera); (4) sem edicao de rascunho (D-051-14) e sem teto de rascunhos por org; (5) cada tick processa ate 20 jobs / 20 s; download+upload de video grande pode ultrapassar `maxDuration` (60 s) da rota do cron em serverless: o lease expira e o job e refeito (pode deixar blob orfao ate `reconcileOrgBlobs`) — tratar ao adotar provedor real; `STORAGE_MAX_FILE_BYTES` (50 MB) pode ser pequeno para videos reais; (6) `Creative.createdBy` sem FK: se o usuario for removido, o upload (FK de `uploadedByUserId`) falha e o job termina `failed/storage`; (7) polling nao e tempo real: o avanço depende da cadencia do cron (1-2 min); (8) a moderacao e apenas tamanho + blocklist; (9) o banco compartilhado `leadforge_test` tambem recebeu a migration aditiva ao rodar a suite uma vez sem `TEST_DATABASE_URL` (o banco de dev `leadforge` NAO foi tocado).

## Implementation Notes (051b — frontend, 2026-10-10)
- Arquivos novos: `src/app/(app)/criativos/{page,loading}.tsx`, `criativos/novo/{page,loading}.tsx`, `criativos/[id]/{page,loading}.tsx`; `src/components/creatives/{creative-format.ts,creative-form-schema.ts,CreativeStatusBadge,CreativeThumb,MockProviderNotice,CreativeCard,CreativeLibrary,CreativeWizard,CreativeDetail}.tsx` e testes `creative-format.test.ts`, `creatives-ui.test.tsx`. Alterados: `src/components/layout/nav-items.ts` (item "Criativos", icone Video) e os testes `nav-items.test.ts`/`AppSidebar.test.tsx` (9 -> 10 itens). Nada em `src/lib/creatives/*`, `src/lib/actions/creative.ts`, `src/lib/schemas/creative.ts` ou `prisma/` foi alterado.
- Biblioteca `/criativos`: 1a pagina SSR; filtros (status, busca) na URL; "Carregar mais" por cursor; estados vazio (com/sem filtro), erro (retry) e loading (skeleton). Fluxo `/criativos/novo`: 5 passos com um unico `useForm` (RHF + `zodResolver`, `createCreativeDraftSchema` estendido com o teto `maxScriptChars` da config); cada passo valida so os seus campos; erros do servidor mapeiam ao campo/passo (`applyServerErrors`); "Criar e enviar" = `createCreativeDraft` + `submitCreative`; se o envio falhar (cota/simultaneos) o rascunho ja existe e o usuario cai na pagina do criativo com o erro do backend e "Enviar para geracao" disponivel. Pagina `/criativos/[id]`: polling de `getCreative` a cada ~6 s (backoff ate 20 s em erro, pausa com aba oculta, para em estado terminal), player com URL SAS de `getCreativeVideoUrl` renovada 30 s antes de expirar e no `onError`, download com URL fresca, cancelar/excluir com `ConfirmDialog`, tentar novamente, enviar rascunho; historico de execucoes.
- Provedor mock rotulado ("Provedor de demonstração (mock)") na biblioteca, no wizard e no detalhe, quando `listAvatarsAndVoices().provider === "mock"`. Mensagens de limite/moderacao/erro vem do backend (`_form`/campo), sem texto novo que revele internals.
- Testes (VERIFIED): `vitest run src/components src/lib/schemas` = 25 arquivos, 196 testes PASS (inclui logica pura de estados/acoes/polling/cota/filtros/schema e SSR de biblioteca, wizard, detalhe e sidebar); `tsc --noEmit` limpo; `eslint src/components "src/app/(app)/criativos"` 0 erros (warnings pre-existentes de RHF `watch`).
- Limitacoes conhecidas: (1) sem validacao visual em navegador autenticado (migration nao aplicada no dev); (2) thumbnail e sempre placeholder (backend nao expoe URL de miniatura); (3) custo estimado: `AvatarsAndVoices` nao traz custo, entao so o mock mostra "R$ 0,00 (demonstracao)" e provedores reais mostram "Informado pelo provedor apos o envio"; (4) sem "duplicar" nem editar rascunho (D-051-14); (5) botao Excluir aparece sempre; a regra owner/criador e imposta pelo servidor (mensagem exibida); (6) player nao testado em navegador (so SSR da area do player); (7) `durationSec` nao e enviado: o servidor estima do roteiro.

### Correções pós-QA (051b)
- M1 (polling): `createPollController` (`src/components/creatives/creative-lifecycle.ts`) — try/catch em torno do fetch (exceção conta como erro, com backoff `nextPollDelay`), sem timer com a aba oculta e refresh imediato ao voltar a ficar visível, para ao chegar em estado terminal, em "não encontrado" persistente (2 seguidos; mensagem "criativo não existe mais") e após 5 erros consecutivos (mensagem + botão "Atualizar agora"); stop limpa timers/listener e ignora resposta em voo.
- M2 (player): `planResume` + `onLoadedMetadata` preservam `currentTime` e o estado de pausa ao trocar o `src` na renovação da URL assinada (removido o `key` que remontava o `<video>`).
- M3: `createUrlRenewer` — retry com backoff (2/4/8/16 s, máx. 4) na renovação, `.catch`/try-catch em todas as chamadas, `onError` do `<video>` com teto (3 erros sem `loadeddata`) e mensagem clara + "Tentar de novo" ao esgotar; "não encontrado" não é retentado.
- M4: `createWizardSubmitter` — guarda o id do rascunho (reenvio pula `createCreativeDraft`), trava contra duplo envio (além de `pending`), `submitCreative` que lança leva a `/criativos/{id}` com mensagem recuperável.
- B1/B2: foco no `h2` do passo ao trocar de passo, `role=status aria-live` com "Etapa X de 5: ..." (e `aria-current` no `nav`); no detalhe, região `role=status aria-live=polite` estável (sempre montada) anunciando o status; removido o `aria-live` do bloco condicional que era remontado.
- Testes (VERIFIED): novo `creative-lifecycle.test.ts` (20 testes, fake timers: polling para em ready, sobrevive a rejeição com backoff, desiste após limite, not_found para, aba oculta não chama/volta faz refresh, stop limpa timers e ignora resposta em voo, restart; `planResume`; renovação com retry/limite/not_found/teto de onError; wizard sem rascunho duplicado em submit que lança, reenvio e duplo envio). `vitest run src/components src/app src/lib/schemas` = 31 arquivos, 249 PASS; `tsc --noEmit` limpo; eslint 0 erros (6 warnings RHF pré-existentes).
- Não testável sem jsdom: a restauração real de `currentTime`/`play()` no elemento `<video>`, o foco efetivo no `h2` e o anúncio do aria-live (só a decisão pura `planResume` e a lógica de ciclo de vida são testadas); validação em navegador segue pendente.

### Correções pós-QA (051b, rodada 2)
- M3 completo: nova função pura `videoPanelState({url,error,loading})` em `creative-lifecycle.ts` ('error' vence 'player'; sem url nem erro = 'loading'). `CreativeDetail` a usa: com `error` o `<video>` quebrado é desmontado e aparecem a mensagem e "Tentar de novo" (limpa snapshot de retomada, `renewer.restart()`, busca URL nova), mesmo com url presente.
- Baixos: (1) foco do `h2` do wizard compara com o passo anterior (ref `prevStep`), imune ao double-effect do StrictMode; (2) `pollState` volta a "ok" no cleanup do efeito de polling (cancelar e tentar de novo não reexibe o banner "gave_up"); (3) em `onUrl`, URL igual à do `src` atual limpa o snapshot `resume` (não há `loadedmetadata`).
- Testes: renomeado o teste de reenvio para refletir o que prova (draft_error libera a trava e createDraft é chamado de novo); novos: `videoPanelState` (todos os casos), guarda de geração (erro de reprodução durante fetch em voo descarta a resposta obsoleta), resposta ok zera o contador de notFound consecutivo.
- Verificação: `vitest run src/components src/app src/lib/schemas` PASS; `tsc --noEmit` e eslint ver relatório. Não feitos por instrução: idempotência do rascunho e trava após falha de `router.push`.

## Decisao D-051-19 (2026-10-11)
D-051-19 (Q-051-11, CONFIRMED por delegacao do usuario: "aceite o default"): mantem-se o comportamento atual como default aceito: SEM teto de retries manuais por criativo; retry de falha do provedor cria nova geracao e a cota mensal continua contando so o primeiro envio do mes (D-051-7). Risco aceito: custo de retries repetidos com provedor real; revisitar (teto N por criativo e/ou consumo de cota) na SPEC do provedor real de avatar, junto de D-051-15. Nenhum codigo alterado.

## 051c — mock com MP4 real (2026-10-13)
- Pedido do usuário ("resolver isso"): o placeholder do mock era um MP4 falso (só `ftyp` + bytes aleatórios) e o player mostrava "Não foi possível carregar o vídeo".
- `src/lib/creatives/providers/mock-video.ts`: MP4 real de 4,5 KB (H.264 + AAC mudo, 216x384 vertical, 4 s). `mock.ts` serve esse arquivo em stream (determinístico). Passa na checagem de magic bytes de SPEC-050. Sem mudança de schema nem de contrato.
- Criativos já gerados antes continuam com o arquivo falso: gerar um novo. tsc, eslint (0 erros) e vitest de `src/lib/creatives` verdes (39 testes).
