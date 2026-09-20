# SPEC-024 — Mobile: app Expo base + autenticacao
- status: DRAFT | domain: mobile | agente: rn-expo-senior-dev | depende de: SPEC-021 | bloqueia: 025, 026
## Objetivo
Esqueleto do app (React Native + Expo, TypeScript), navegacao, camada de API, auth com biometria, temas, estados base. Sem telas de dados.
## Escopo
- Local do codigo (D-M1 RESOLVIDA pelo usuario): repo git SEPARADO em `~/Desktop/LeadForge/mobile`, irmao de `~/Desktop/LeadForge/web` (o leadforge atual, cuja mudanca de pasta e feita pelo usuario fora desta SPEC; NAO mover nada aqui). Sem imports cruzados: o app consome so a API HTTP `/api/mobile/v1`.
- Criacao do repo: `git init`, `README.md` (o que e, requisitos, como rodar Expo Go/dev build, variaveis, como regenerar tipos, limites de distribuicao gratis), `.gitignore`, `.env.example` com `EXPO_PUBLIC_API_URL=https://...` (somente URL base; nenhum segredo) e `EXPO_PUBLIC_OPENAPI_URL`/caminho do arquivo OpenAPI, AGENTS/CLAUDE.md minimo apontando para as SPECs do web.
- Pipeline de tipos: script `npm run gen:api` gera tipos TS (ex.: `openapi-typescript`, versao verificada na doc) a partir do OpenAPI da SPEC-021 (arquivo `openapi.json` exportado do web e copiado/baixado; versionar o snapshot em `mobile/api/openapi.json`); saida em `src/api/schema.d.ts` (nao editar a mao); CI/pre-commit falha se o schema gerado divergir do snapshot; cliente HTTP usa esses tipos. Mudanca incompativel no contrato = nova versao /v2.
- Specs do mobile: as SPECs 021-026 permanecem em `web/specs`; o repo mobile referencia por ID e README.
- Expo managed workflow (D-M3), Expo Router, TypeScript estrito; versoes atuais do SDK verificadas na doc antes de instalar (nao assumir).
- Cliente HTTP unico (axios, regra transversal) com base URL por env (`EXPO_PUBLIC_API_URL`, so URL publica; nenhum segredo no bundle), interceptor: anexa Bearer, refresh automatico em 401 `token_expired` (single-flight), erro normalizado PT-BR, timeout, 429 com `Retry-After`.
- Tokens em `expo-secure-store` (Keychain/Keystore); nada de AsyncStorage para token. Biometria (`expo-local-authentication`) opcional em Ajustes: bloqueia o app ao ir para background (>30 s) e ao abrir; falha/cancelamento = tela de bloqueio; fallback e re-login com senha.
- Login (email/senha, nome do dispositivo), logout real (chama `/auth/logout` e apaga SecureStore e cache).
- Cache de dados: react-query em memoria; persistencia em disco so de agregados sem PII e criptografavel; NAO persistir listas com nome de lead (D-M6). Limpa no logout.
- Tema claro/escuro seguindo o sistema, tokens de cor alinhados ao design system web (SPEC-002), contraste AA; fontes escalaveis; alvos de toque >= 44 pt; labels de acessibilidade; suporte a leitor de tela.
- Componentes base: `Screen`, `Card`, `Stat`, `StatusPill`, `EmptyState`, `ErrorState` (com "Tentar de novo"), `Skeleton`, `OfflineBanner` (`expo-network`/NetInfo).
- Estados: loading (skeleton), erro (mensagem PT-BR + retry), vazio, offline (mostra ultimo dado em memoria com selo "desatualizado"), 401 definitivo = volta ao login.
- Deep links: esquema `leadforge://` com allowlist de rotas (`alerts/{id}`, `approvals/{id}`); ao abrir sem sessao vai ao login e retoma o destino; parametros validados (uuid), nunca executa acao por deep link.
- Sem analytics/telemetria de terceiros por padrao; logs sem tokens/PII; `console` removido em release.
- Distribuicao gratuita para teste: (1) Expo Go (mais rapido; limitado a modulos incluidos; push remoto e biometria podem ter restricoes por plataforma/SDK, verificar); (2) development build local (`expo run`) gratuito, exige Xcode/Android Studio; (3) EAS Build plano gratis (fila e cota mensal limitada) para APK Android interno; iOS em aparelho fisico exige Apple Developer paga (US$99/ano) — no simulador e gratis. Backend precisa ser alcancavel do aparelho por HTTPS (tunel ou deploy) — D-M8.
## Criterios de aceite
1. Login/logout funcionam contra a API da SPEC-021; tokens so no SecureStore (teste unitario com mock verificando que AsyncStorage nao e usado).
2. Access expirado renova sozinho uma vez mesmo com 5 requests simultaneos (teste do single-flight); refresh falho = tela de login.
3. Biometria: bloqueio ao voltar do background; falha nao libera; desativavel.
4. Modo aviao: `OfflineBanner` e dado em memoria marcado como desatualizado; sem crash.
5. Logout limpa SecureStore e cache (teste).
6. Deep link invalido/uuid malformado e ignorado com seguranca; com sessao ausente exige login primeiro.
7. Sem segredo no bundle (varredura do `app.config`/env publico); `tsc --noEmit` e lint limpos.
8. Acessibilidade: elementos interativos com `accessibilityLabel`/role; tema escuro sem texto ilegivel (checagem de contraste dos tokens em teste).
## Testes obrigatorios
Jest + React Native Testing Library: cliente HTTP (refresh, 401, 429, offline), auth store, guard de rotas, deep link parser, tokens de tema. Teste manual em simulador iOS e emulador/aparelho Android documentado.
## Seguranca / LGPD
SecureStore; sem PII em disco; captura de tela/preview em app switcher oculta quando possivel (`expo-screen-capture` opcional); cert pinning fora do escopo (registrar risco).
## Fora do escopo
Telas de metricas (025), acoes e push (026), publicacao em lojas.
## Limitacoes de validacao
O agente nao ve simulador/aparelho: validacao visual/biometria/background PENDENTE do usuario; automatizado cobre logica e tipos.
