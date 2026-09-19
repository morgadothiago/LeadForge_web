# SPEC-016 — Camada de erros HTTP e mensagens em PT-BR
- status: IMPLEMENTED (aprovada pelo usuario, 2026-09-19) | domain: backend (+ ajuste minimo de UI) | sessao: 2 | prerequisito de: SPEC-011..015 | depende de: SPEC-000
## Objetivo
Toda falha de integracao (HTTP/axios, SMTP, banco, sessao) chega ao front como mensagem clara em PORTUGUES, sem vazar detalhe interno, com 429 tratado (regra transversal em specs/README.md).
## Escopo
- `src/lib/errors.ts` (ja criado): `AppError` (code, userMessage PT-BR, status, retryable, retryAfterSeconds, cause). `handleActionError` (src/lib/actions/result.ts) ja exibe `userMessage` de `AppError`.
- `src/lib/http/`: `createHttpClient({name, baseURL, timeout, headers, retry})` (axios, dependencia nova via --legacy-peer-deps) com interceptor de RESPOSTA que converte qualquer falha em `AppError`: 400/422 validation, 401 unauthorized, 403 forbidden, 404 not_found, 408/timeout, 409 conflict, 429 rate_limited (le `Retry-After` em segundos ou data HTTP), 5xx upstream, ECONNREFUSED/ENOTFOUND/ECONNABORTED network/timeout, cancelamento. Mensagens PT-BR por codigo e por NOME da integracao (ex.: "O WhatsApp (Evolution) demorou para responder...").
- Retry (interceptor): 429 respeita `Retry-After` (teto configuravel, ex. 30s); sem header, backoff exponencial com jitter; maximo de tentativas configuravel (default 3); so metodos idempotentes (GET/HEAD/PUT/DELETE) ou requisicao com `idempotent: true` explicito; 5xx/timeout/rede com retry limitado; 4xx (exceto 408/429) nunca repete; nunca laco infinito. Interceptor de REQUISICAO opcional: redacao de segredos em logs (Authorization, apikey, senha).
- Nunca vazar em `userMessage`/logs: corpo cru da resposta, headers, apikey, tokens, URL com credencial.
- Helper para Route Handlers proprios: `tooManyRequests(retryAfterSeconds)` -> Response 429 JSON PT-BR + header `Retry-After`.
- Front: helper `getErrorMessage(result)`/componente padrao para exibir `_form` (toast sonner e alerta inline) sem duplicar; toda action ja devolve `_form` em PT-BR; verificar que os formularios existentes exibem `_form` (campanhas, ICP, sequences, leads, pipeline, login) e corrigir onde faltar.
## Criterios de aceite
- [x] Testes (axios-mock-adapter ou adapter fake): 429 com `Retry-After` em segundos e em data HTTP, 429 sem header (backoff), tentativas esgotadas -> AppError rate_limited PT-BR com retryAfterSeconds; 5xx com retry e sucesso na 2a; 4xx sem retry; timeout; ECONNREFUSED; POST nao idempotente NAO repete; AppError chega via handleActionError como `_form` PT-BR.
- [x] Teste de vazamento: userMessage e log nao contem apikey/Authorization/corpo.
- [x] `tooManyRequests` devolve 429 + Retry-After.
- [x] Nenhum formulario existente engole `_form` (checagem).
- [x] build/lint/typecheck OK.

## Implementation Notes
- Arquivos: src/lib/http/{client,messages,redact,too-many-requests,index}.ts, src/lib/http/http.test.ts; src/components/campaigns/form-utils.ts (helper `getFormError`), src/components/auth/LogoutButton.tsx (engolia `_form`); dependencia `axios` (--legacy-peer-deps). errors.ts/result.ts inalterados.
- Testes: vitest, adapter fake proprio (sem axios-mock-adapter), sleep/random injetaveis. typecheck, lint, test (185/185) e build: VERIFIED.
- Criterios: todos PASS (http.test.ts cobre 429 s/ data HTTP/sem header, esgotadas, 5xx, 4xx, timeout, ECONNREFUSED/ENOTFOUND, POST, handleActionError, vazamento, tooManyRequests). Checagem de formularios: todos exibiam `_form` (inline role=alert ou toast) exceto LogoutButton, corrigido.
- Decisoes: `maxAttempts` = tentativas totais (default 3); retry so em erros retryable + metodo idempotente (GET/HEAD/PUT/DELETE/OPTIONS) ou `idempotent: true`; teto default 30s tambem para Retry-After (retryAfterSeconds no erro reporta o valor original).
- Limitacoes: acoes de campanha/sequencia/ICP/template exibem a 1a mensagem de qualquer campo (equivale a `_form` hoje); nao migradas para `getFormError`. Logs so em retry (console.warn com headers redigidos).

## Implementation Notes (QA fixes 2026-09-19)
- Log sem vazamento: `safeErrorForLog` (src/lib/errors.ts) e `handleActionError` logam so resumo seguro (sem AxiosError cru/config/headers). Teste de regressao `src/lib/actions/log-leak.test.ts`: AxiosError com `apikey: SEGREDO-XYZ`/`Authorization: Bearer SEGREDO-ABC` via AppError(cause) e direto; segredos ausentes de console.error e `userMessage` PT-BR em `_form`.

