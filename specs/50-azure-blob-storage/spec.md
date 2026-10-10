# SPEC-050 — Azure Blob Storage: abstracao de storage, upload/listagem/remocao, escopo por organizacao
- status: IMPLEMENTED | domain: backend (UI de arquivos, se desejada, vira SPEC de frontend separada — Q-050-6) | depende de: 030 (escopo por org), 033 (planos/limites, opcional)

## Objetivo
Preparar o projeto para usar Azure Blob Storage no envio e gerenciamento de arquivos: configuracao (env), client/abstracao de storage (`StorageProvider`, mesmo padrao de `PaymentProvider`/`EmailProvider`), upload, listagem, download (URL assinada) e remocao, sempre escopados por organizacao. Base para a SPEC-051 (criativos).

## Contexto (verdade-base)
- Nao ha nenhum storage hoje (grep sem `AZURE|BLOB|STORAGE` em `env.ts`/`.env.example`). `KnowledgeDocument` (SPEC-018/019) guarda texto, nao arquivo. `User.avatarUrl` existe como string.
- Isolamento por org via `src/lib/tenant/scoped-prisma.ts`; metadados de arquivo devem seguir o mesmo padrao (`orgId` obrigatorio + teste de vazamento).

## Escopo proposto
1. Env (`env.ts` + `.env.example` + docs): `AZURE_STORAGE_CONNECTION_STRING` (ou `AZURE_STORAGE_ACCOUNT_NAME` + credencial, Q-050-2), `AZURE_STORAGE_CONTAINER` (default sugerido `leadforge-files`), `STORAGE_PROVIDER=azure|local` (provider `local`/em memoria para dev e testes, Q-050-3), `STORAGE_MAX_FILE_BYTES`, `STORAGE_ALLOWED_MIME`. Opcionais; ausente = feature desabilitada com erro claro (nao quebra o app).
2. Abstracao `src/lib/storage/`: `provider.ts` (interface `StorageProvider`: `put`, `delete`, `exists`, `getReadUrl` (SAS curta), `getUploadUrl` (SAS escrita), `list(prefix)`), `providers/azure-blob.ts` (`@azure/storage-blob`), `providers/local.ts`, factory por env.
3. Convencao de chave: `orgs/{orgId}/{category}/{uuid}-{sanitizedFileName}`; `orgId` SEMPRE derivado da sessao, nunca do cliente; container privado (sem acesso publico anonimo); leitura somente via SAS de curta duracao gerada apos checagem de org.
4. Modelo `StoredFile` (Prisma): id, orgId, category (enum, ex.: `creative`, `knowledge`, `attachment`), blobKey, originalName, mimeType, sizeBytes, sha256?, uploadedByUserId, createdAt, deletedAt. Migration aditiva. Metadado e fonte de verdade da listagem por org (list por prefixo no Blob so para reconciliacao).
5. Upload: ver Q-050-4 (via servidor/Route Handler com stream vs. SAS direto do browser + confirmacao). Validacoes: tamanho, MIME allowlist + checagem de magic bytes, nome sanitizado, limite de cota por org (Q-050-5).
6. Server Actions/Route Handlers: `uploadFile`, `listFiles({category, cursor})`, `getFileUrl(id)`, `deleteFile(id)` (soft delete + remocao do blob; job de limpeza de orfaos). Guards `requireActiveProviderOrg`; erros tipados `ActionResult`.
7. Purga: o job de expurgo de org (SPEC-033, D-33-4, 90 dias pos-cancelamento) tambem remove os blobs da org (`orgs/{orgId}/`).
8. Testes: provider mockado (nunca Azure real); org A nao lista/le/remove arquivo da org B (IDs e chaves adivinhados); path traversal no nome; MIME/tamanho; SAS expira e e somente-leitura; sem segredo em log; purga.
9. Docs: criar storage account/container, CORS (se SAS direto), lifecycle management opcional.

## Fora do escopo
- UI de gerenciador de arquivos (Q-050-6), CDN/Front Door, antivirus/scan de malware, processamento de imagem/video, versionamento de blobs, migracao de arquivos existentes (nao ha), uso de `KnowledgeDocument` com arquivo (futuro).

## Criterios de aceitacao
- Upload, listagem paginada, URL de leitura assinada e remocao funcionam por org com o provider mockado e `local`; teste de vazamento cross-org passa.
- Sem env Azure o app sobe e a feature falha com erro tipado claro. `tsc`, lint, vitest verdes.

## Seguranca / riscos
- Connection string so server-side; container privado; SAS minimo (permissao e TTL curtos); validacao de MIME real; protecao contra path traversal e sobrescrita; custo/egress (cota por org). Risco de metadado e blob divergirem (reconciliacao).

## Decisoes (resolvem as perguntas em aberto; aprovadas pelo usuario em 2026-10-09)
- D-050-1 (Q-050-1): container unico (`leadforge-files`, privado) com prefixo `orgs/{orgId}/` por org.
- D-050-2 (Q-050-2): autenticacao por connection string (`AZURE_STORAGE_CONNECTION_STRING`, so server-side).
- D-050-3 (Q-050-3): provider `local` (filesystem em `.storage/`, ignorado pelo git) para dev/teste; e o default quando nao ha env Azure. Em producao sem Azure e sem `STORAGE_PROVIDER=local` explicito a feature responde erro `config` (503), sem derrubar o app. Sem Azurite.
- D-050-4 (Q-050-4): upload via servidor com stream e limite `STORAGE_MAX_FILE_BYTES` (default 50 MB). SAS direto do browser = apenas `getUploadUrl` na interface (sem UI/rota).
- D-050-5 (Q-050-5): sem cota por plano agora; so limite por arquivo.
- D-050-6 (Q-050-6): somente infra, sem UI.
- D-050-7 (Q-050-7): categorias `creative|knowledge|attachment`; allowlist de MIME configuravel por `STORAGE_ALLOWED_MIME` (default: png/jpeg/webp/gif, mp4/webm, pdf, text/plain|markdown|csv).
- D-050-8 (Q-050-8): soft delete (`deletedAt`) + remocao fisica imediata do blob.

## Criterios de aceitacao: evidencia
| Criterio | Status | Evidencia |
|---|---|---|
| Upload/lista paginada/URL assinada/remocao por org (mock e `local`) | PASS | `service.test.ts` (upload ok, cursor, deleteFile, TTL), `storage-routes.test.ts` (fluxo) |
| Vazamento cross-org | PASS | `service.test.ts` "isolamento cross-org" (2 casos), `storage-routes.test.ts` (404 para org B) |
| Path traversal | PASS | `keys.test.ts`, `providers.test.ts`, `service.test.ts` (nome malicioso), rota local |
| MIME/tamanho/magic bytes | PASS | `service.test.ts`, `storage-routes.test.ts` (415/413) |
| SAS expira e somente-leitura | PASS | `providers.test.ts` (Azure `sp=r`/`cw`, TTL; local assinatura/expiracao) |
| Sem segredo em log | PASS | `service.test.ts` (falha do provider) |
| Purga SPEC-033 | PASS | `service.test.ts` "purga SPEC-033" |
| Sem env Azure o app sobe e a feature falha com erro tipado | PASS | `keys.test.ts` (getStorageConfig) |
| tsc, lint, vitest | PASS (ressalva) | `tsc --noEmit` limpo; `npm run lint` 0 erros; `vitest`: 1558/1565 passam; 7 falhas fora do escopo (ver Limitacoes) |

## Implementation Notes
- Arquivos novos: `src/lib/storage/{provider,keys,config,magic,factory,service,http}.ts`, `src/lib/storage/providers/{local,azure-blob}.ts`, rotas `src/app/api/storage/files/route.ts` (GET lista, POST upload por stream), `files/[id]/route.ts` (DELETE), `files/[id]/url/route.ts` (GET URL assinada), `local/route.ts` (serve provider local por URL HMAC); testes `keys.test.ts`, `providers/providers.test.ts`, `service.test.ts`, `src/app/api/storage/storage-routes.test.ts`; migration `prisma/migrations/20261009120000_stored_file/` (escrita a mao: o banco de dev tem drift de outras migrations; aditiva, enum + tabela + FKs).
- Arquivos alterados: `prisma/schema.prisma` (enum `StoredFileCategory`, model `StoredFile`, relacoes em Organization/User), `src/lib/tenant/scoped-prisma.ts` (`storedFile` em DIRECT_ORG_MODELS), `src/lib/billing/purge.ts` (purga de blobs), `src/lib/env.ts`, `src/lib/test-utils/org-fixture.ts`, `.env.example`, `.gitignore`, `docs/CONFIGURACAO_POS_PROJETO.md` (2c), `specs/README.md`, `package.json`/`package-lock.json` (`@azure/storage-blob`).
- Decisoes: upload = corpo cru + `Content-Type` + `?category=&name=` (sem multipart, para streaming real); `orgId`/`userId` so da sessao; guards `requireActiveProviderOrg` (escrita) e `requireProviderOrg` (leitura); erros tipados `AppError` mapeados para JSON (401/403/404/413/415/503); `uploadedByUserId` opcional (`SetNull`) e `sizeBytes` Int; resposta da API nao expoe `blobKey`; purga: org com arquivos e storage indisponivel nao recebe `purgedAt` (retenta no proximo tick), org sem arquivos e sem storage segue normalmente.
- Limitacoes: sem cota por plano, sem UI, sem antivirus; Azure real nao testado (SAS validado offline; `put/list/delete` do Azure nao exercitados sem rede); reconciliacao de orfaos e funcao manual (sem job agendado); a purga so e acionada para orgs com metadado ou com provider disponivel; limite de body do host (ex. Vercel) pode ser menor que `STORAGE_MAX_FILE_BYTES`; a rota `local` serve com `Content-Disposition: attachment`.
- Resultado da suite completa: 7 falhas em `prisma/seed.test.ts`, `integration.test.ts`, `pipeline.test.ts`, `send-policy.test.ts`, `cross-tenant-leak.test.ts` (contagens de seed/instancias WhatsApp 21 vs 20, 24 vs 25 no banco de teste compartilhado), sem relacao com storage; todos os 56 testes novos da SPEC-050 passam.
