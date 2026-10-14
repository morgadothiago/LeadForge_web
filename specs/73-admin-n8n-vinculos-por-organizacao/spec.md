# SPEC-073 (069g) — Admin: chave n8n e vínculos Google Ads/Meta por organização — fullstack

- id: SPEC-073 (continuação da SPEC-069; apelido **069g**)
- status: **DRAFT** (aguardando `APROVAR SPEC-073`) | domain: fullstack | criada em 2026-10-14 | depende de: 069 (c/d/e/f), 041 (fontes de lead), 018 (integrações), 031/032 (admin), 014 (n8n)
- Classificação: D-073-n = INFERRED. Nenhum código escrito.

## 1. Objetivo
Fechar a lacuna aberta pela 069f: com a aba "Integrações" removida do tenant (D-069-12), a **chave de ingestão n8n** e os **vínculos conta-de-anúncios/Página -> campanha** (Google Ads Lead Form e Meta Lead Ads) ficaram sem tela, nem do tenant nem do admin. Os registros existentes continuam funcionando; falta poder **criar, trocar e remover** pelo `platform_admin`, por organização.

## 2. Contexto (lido do código, 2026-10-14)
- `src/lib/actions/integration.ts`: `saveIntegration`/`removeIntegration`/`testIntegration` são do tenant (`requireActiveProviderOrg`); `PLATFORM_ONLY = ["evolution","places"]` recusa o tenant com `PolicyManagedByAdminError`; `llm` exige `llm.byok`; `n8n` exige `ingest.api` (Pro).
- `src/lib/actions/lead-source.ts`: `saveLeadSourceBinding`/`removeLeadSourceBinding` (tenant, `assertFeature(sources.ads)`), upsert serializável + Page Access Token cifrado (Meta) + auditoria. O identificador do vínculo é a credencial do Google Ads (sem HMAC).
- Admin (069c): `src/lib/actions/admin/entitlements.ts` + `src/lib/admin/org-policy.ts` gravam Places/Evolution/LLM por organização com motivo e auditoria na mesma transação; painel em `src/components/admin/policy/`.
- 069f removeu a rota `/configuracoes/integracoes` (404) e deixou `IntegrationCard`, `LeadSourceCards`, `IntegrationAuditList` sem uso.

## 3. Escopo
### Backend
1. Novas Server Actions só `platform_admin` (padrão da 069c, núcleo em `src/lib/admin/`, sem ser Server Action): `saveOrgN8nIntegrationByAdmin`/`removeOrgN8nIntegrationByAdmin`; `saveOrgLeadSourceBindingByAdmin`/`removeOrgLeadSourceBindingByAdmin`. Motivo obrigatório (5-500), auditoria em `PlatformAuditLog` (novos valores em `PlatformAuditAction`; migration aditiva à mão) na mesma transação, sem valor de segredo.
2. Reaproveitar a lógica das actions do tenant (extrair o núcleo comum; o tenant deixa de chamá-las pela UI). Respeitar o plano: n8n só com `ingest.api`, vínculos só com `sources.ads`, **a menos que o admin tenha override** (decisão Q-073-2).
3. Query de leitura `getOrganizationPolicy` ganha n8n (hint, host mascarado, último teste) e a lista de vínculos (provedor, id mascarado, rótulo, campanha), **sem token/chave**.
4. `testIntegration` recusa chave `managedByPlatform` quando chamada pelo tenant (achado baixo do QA 069f) e passa a existir versão admin do teste.
5. Tenant **continua usando** o serviço: ingestão n8n, webhooks Ads/Meta, sequências e busca não mudam.

### Frontend (admin)
1. Em `/admin/organizacoes/[id]`, aba **Integrações**: cartão **n8n** (chave write-only `type=password`, hint, rotacionar, remover) e seção **Fontes de lead** (lista de vínculos; criar/editar/remover; Page Access Token do Meta write-only; campanha escolhida entre as da org). Diálogos com motivo obrigatório, erros por campo, toasts, 390/1280 px, claro/escuro, alvos >= 44 px, foco visível.
2. Remover o código morto (`IntegrationCard`, `LeadSourceCards`, `IntegrationAuditList` e seus testes) e `revalidatePath("/configuracoes/integracoes")`; corrigir `docs/GUIA.md` e `docs/PROMPT_ADMIN_AGENTES_INTEGRACOES_PLANOS.md`.
3. Tenant: texto/estado somente leitura onde fizer sentido (ex.: Campanhas mostra "fonte conectada" sem editar), sem expor credencial.

## 4. Fora do escopo
Voltar a aba Integrações ao tenant; BYOK de LLM; novos provedores de fonte; fluxo de autorização OAuth do Meta/Google; mudanças na ingestão (`/api/webhooks/...`).

## 5. Critérios de aceitação
- AC-1: admin cria/rotaciona/remove a chave n8n de uma org; a ingestão via n8n dessa org funciona com a chave nova e falha com a antiga.
- AC-2: admin cria/remove vínculo Google Ads/Meta -> campanha; lead de teste chega na campanha certa; token do Meta nunca volta ao navegador.
- AC-3: tenant (qualquer papel) **não** consegue chamar as actions admin nem `testIntegration` de chave da plataforma (teste de autorização/cobertura, padrão `*-auth-coverage.test.ts`).
- AC-4: toda escrita gera auditoria com quem/quando/motivo/campos, sem segredo; isolamento A/B/C entre organizações.
- AC-5: org sem `ingest.api`/`sources.ads` e sem override: ação do admin é recusada com mensagem clara (ou permitida com override, conforme Q-073-2).
- AC-6: tsc, eslint (0 erros) e vitest verdes em banco `*_test` novo; E2E em navegador do painel (390/1280, claro/escuro, teclado).

## 6. Testes
Backend: autorização (só `platform_admin`), motivo obrigatório, auditoria atômica, isolamento entre orgs, cifra do token, recusa de `managedByPlatform` no tenant, plano x override. Frontend: renderização das abas/diálogos, nenhum valor de segredo em props/HTML, erros por campo. Cobertura estática: nenhum `plan.key ===` literal.

## 7. Riscos
Admin gravar vínculo na org errada (mitigar: mostrar nome da org no diálogo e exigir motivo); vazamento do Page Access Token por props/resposta da action (retornar só view mascarada, como no M1 da 069c); duplicidade do identificador Google Ads entre orgs (já há unicidade por (provider, externalAccountId); definir mensagem de conflito).

## 8. Decisões e perguntas
- D-073-1 (INFERRED): seguir o padrão da 069c (núcleo em `src/lib/admin/`, actions finas, auditoria na mesma transação).
- Q-073-1 [BLOQUEANTE] O tenant deve **ver** (somente leitura) o status da conexão n8n/Ads/Meta? Recomendação: **sim, só status** ("conectado/não conectado"), sem credencial.
- Q-073-2 [BLOQUEANTE] O admin pode gravar n8n/vínculos numa org cujo plano não libera `ingest.api`/`sources.ads`? Recomendação: **não**, salvo override ativo (mantém "plano manda").
- Q-073-3 Existe fluxo de autoatendimento futuro (OAuth) que volte essa configuração ao tenant? Recomendação: **fora de escopo agora**.
- Q-073-4 Remover agora o código morto ou numa limpeza separada? Recomendação: **agora**, junto desta SPEC.
