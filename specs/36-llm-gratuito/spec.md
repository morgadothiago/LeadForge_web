# SPEC-036 — LLM gratuito (provedor OpenAI-compatible: Ollama, Gemini, Groq)
- status: DRAFT | domain: fullstack | depende de: SPEC-018 (chaves no painel), SPEC-019 (agentes e interface `LlmProvider`), SPEC-030 (multi-tenant)

## Objetivo
Tornar os agentes de IA testáveis de graça. Hoje o código só tem `ClaudeProvider` (Anthropic, pago, sem tier grátis) — em produção o caminho grátis é "agentes desligados" (`docs/GUIA.md` 4.5). Esta SPEC adiciona um provedor **OpenAI-compatible** configurável por Organization que cobre, com a MESMA classe: **Ollama local** (`http://localhost:11434/v1`, custo zero, dado não sai do computador), **Gemini free tier** (endpoint OpenAI-compatível `https://generativelanguage.googleapis.com/v1beta/openai`), **Groq/OpenRouter free tier** e qualquer outro compatível. `ClaudeProvider` continua sendo o fallback de quem já usa hoje.

## Contexto (leitura do código, 2026-09-26)
- `src/lib/agents/provider.ts`: só `ClaudeProvider` (`https://api.anthropic.com/v1/messages`, chave via `getIntegrationConfig(orgId, "llm")`) e `FakeLlmProvider` (testes). `getLlmProvider` não tem noção de provedor.
- Modelo vem de `Agent.model` (já existe; usado em `run-agent.ts:142` e `budget.ts:150`) — **nenhuma migration de modelo é necessária**.
- `IntegrationSecret` já tem `baseUrl` e `allowPrivateHost` (SPEC-018) — **nenhuma migration nova** para endereço/SSRF.
- `src/lib/integrations/types.ts`: `REQUIRES_BASE_URL.llm = false` e `TESTABLE.llm = false` hoje.
- `src/lib/agents/budget.ts`: `PRICES` só tem modelos Claude e `FALLBACK = [5, 25]` USD/M tokens; **modelo desconhecido é cobrado pelo mais caro** — um modelo local ou free-tier ficaria caro na contagem do orçamento sem esta SPEC.
- `src/lib/schemas/integration.ts`: `saveIntegrationSchema` exige `value` (chave) com ≥ `SECRET_MIN` para `llm` — Ollama não tem chave.
- Regra transversal (specs/README.md): um cliente HTTP por integração, erro PT-BR da SPEC-016, sem vazar segredo.

## Escopo
### Backend
1. **`OpenAICompatProvider implements LlmProvider`** (`src/lib/agents/`): `POST {baseUrl}/chat/completions` com `{model, messages: [{role:"system"},{role:"user"}], max_tokens, temperature?}`; parse tolerante de `choices[0].message.content` (mesmo extrator de JSON de `parseAgentOutput`, saída segue `agentOutputSchema`) e de `usage.prompt_tokens`/`usage.completion_tokens` (ausentes => 0, sem quebrar). Streaming **fora de escopo** (igual Claude hoje).
2. **`createOpenAICompatClient(baseUrl, apiKey?)`**: uma instância axios por integração (createHttpClient da SPEC-016), timeout 30 s, retry/backoff, `Authorization: Bearer <key>` **só quando houver chave** (Ollama não exige), header `Content-Type`, redação de segredo em erro/log, sem redirect para host diferente.
3. **Seleção em `getLlmProvider(orgId)`**: `cfg.baseUrl` presente => `OpenAICompatProvider`; ausente => `ClaudeProvider` (compatibilidade retroativa — quem só tem chave Claude continua funcionando sem tocar em nada). O `IntegrationConfig` já expõe `baseUrl`; se vier de `.env` (só evolution) não se aplica.
4. **SSRF/URL**: para `llm` a URL base passa a existir => reusar `src/lib/integrations/url-guard.ts` no SALVO (metadados/link-local sempre bloqueados; loopback/privado **só** com `allowPrivateHost` marcado pelo admin — é exatamente o caso do Ollama em localhost). **Não** virar `REQUIRES_BASE_URL.llm = true` de forma incondicional (quebraria quem salva só a chave Claude); validação condicional: *se* `baseUrl` preenchida => guarda roda.
5. **Chave opcional quando há URL**: `saveIntegrationSchema` passa a exigir `value` só quando `baseUrl` ausente (Claude) ou quando o provedor marcado exigir; com `baseUrl` (Ollama) o cadastro é válido sem chave. Manter `SECRET_MIN` para quem digita chave.
6. **Custo/budget** (`budget.ts`): incluir na tabela `PRICES` os modelos de tier grátis/locais com custo **0** (ex.: `llama*`, `qwen*`, `mistral*`, `gemma*`, `gemini-*-flash*`) e manter `FALLBACK` conservador para modelo desconhecido. Tokens continuam sendo **contados** (métrica e limite de execuções) mesmo com custo 0; hard stop em 100% e alerta em 80% da SPEC-019 permanecem. Ver D-36-3.
7. **Nada muda nos guardrails**: saída estruturada, guardrails determinísticos, opt-out/supressão, política da SPEC-017 e orçamento continuam decidindo se algo é enviado — esta SPEC só troca **quem gera o texto**.
8. Multi-tenant: tudo por `orgId` (SPEC-030); **não** toca em `src/app/api/mobile/**` nem no contrato mobile (regra dura da sessão 6).

### Frontend
- **Configurações > Integrações** (card "Provedor de LLM"): campo **URL base** (opcional; placeholder mostrando exemplos Ollama/Gemini/Groq), campo **chave** write-only (opcional quando há URL), checkbox **"Instância própria"** (`allowPrivateHost`, obrigatório para localhost/privado, com aviso), aviso de privacidade (provedor externo => dados de lead saem do computador), botões Salvar/Remover conforme já existe, e **"Testar conexão"** quando houver URL base (D-36-5).
- **Configurações > Agentes / tela "Simular"**: mostrar **provedor ativo** (Claude vs OpenAI-compatible), base URL redigida (sem segredo) e o `model` que será usado — hoje o Simular gasta tokens sem dizer de quem.

## Fora do escopo
- Streaming, function calling/tools, embeddings/RAG/busca vetorial (SPEC-019 já definiu conhecimento como texto).
- Vários provedores por org ao mesmo tempo (uma config `llm` por org, como já é).
- Troca do `ClaudeProvider` por outro formato proprietário (Anthropic-compatível), novos modelos Claude, e qualquer coisa em `../mobile/`.
- Alterar a interface `LlmProvider` ou o schema de saída `agentOutputSchema`.

## Decisões pendentes (recomendação entre parênteses; aguardam confirmação do usuário)
- **D-36-1 Provedor para validar primeiro:** (a) **Ollama local** — custo zero total, dado não sai da máquina, exige instalar Ollama + baixar modelo (2-8 GB) e marcar "instância própria"; (b) **Gemini free tier** — não instala nada, exige chave do Google, no free tier o conteúdo pode ser usado para melhoria de produto (importa para LGPD/dado de lead). *(Recomendado: implementar a classe única e validar primeiro com **Ollama** — sem chave, sem limite de taxa, sem custo; Gemini em seguida como segunda validação.)*
- **D-36-2 De onde vem o modelo:** usar `Agent.model` como está *(recomendado: sem migration; a UI sugere um modelo default por provedor ao criar o agente)* vs. modelo default na integração `llm` (exigiria coluna nova em `IntegrationSecret`).
- **D-36-3 Custo de modelo grátis/local:** *(recomendado: 0 micros para modelos da lista de free/local e para baseUrl em host privado; tokens sempre contados; modelo desconhecido mantém o fallback conservador até a tabela ser atualizada.)* Alternativa: custo 0 para TUDO quando `baseUrl` existir — mais simples, porém esconde o custo real de Gemini/Groq free-tier após o limite diário.
- **D-36-4 "Simular":** continua chamando o provedor real e gastando tokens *(recomendado: sim, mostrando provedor/modelo/custo na tela)* vs. exigir provedor fake.
- **D-36-5 "Testar conexão" para `llm`:** *(recomendado: sim quando houver URL base — `GET {baseUrl}/models` ou um `/chat/completions` mínimo com `max_tokens:1`, timeout curto, resultado PT-BR; para Claude sem URL, manter "teste indisponível" como hoje.)*
- **D-36-6 Chave sem URL:** continua obrigatória *(recomendado: sim para Claude; opcional quando há URL, que é o caso Ollama)*.

## Modelo de dados
Sem migration. `IntegrationSecret.baseUrl`, `IntegrationSecret.allowPrivateHost`, `Agent.model` já existem e são suficientes. Se D-36-2 mudar, a SPEC passa a exigir migration nova (será marcada aqui na aprovação).

## Runtime (contrato)
```ts
// provider.ts
export function createOpenAICompatClient(baseUrl: string, apiKey?: string, adapter?): AxiosInstance
export class OpenAICompatProvider implements LlmProvider { /* POST /chat/completions -> LlmResult */ }

export async function getLlmProvider(orgId: string): Promise<LlmProvider> {
  const cfg = await getIntegrationConfig(orgId, "llm");
  return cfg.baseUrl
    ? new OpenAICompatProvider(createOpenAICompatClient(cfg.baseUrl, cfg.reveal() || undefined))
    : new ClaudeProvider(createClaudeClient(cfg.reveal()));
}
```
- Normalização de erro (429 com `Retry-After`, timeout, 401/403, modelo inexistente, corpo fora do formato) em PT-BR via SPEC-016; falha do LLM cai em handoff/rascunho, **nunca** em envio (SPEC-019 inalterada).
- URL conferida pelo `url-guard` ao salvar e ao conectar; sem redirecionamento para outro host.

## Segurança, privacidade e LGPD
- Chave/baseURL cifradas no banco (SPEC-018), nunca logadas, nunca em toast/RSC/auditoria; `IntegrationConfig.toJSON` já redige — manter teste de vazamento.
- **Ollama local**: nada sai da máquina. **Gemini/Groq/OpenRouter**: dados de lead (nome, empresa, ICP, histórico mínimo já montado pela SPEC-019) trafegam para o provedor; free tier do Google pode usar conteúdo para melhoria de produto — aviso explícito na tela antes de salvar (opt-in do admin).
- `allowPrivateHost` só libera loopback/privado para a URL da própria org; metadados/link-local continuam sempre bloqueados (SPEC-018).

## Testes
- [ ] `OpenAICompatProvider`: sucesso (JSON válido), saída fora do schema, 400/401/404 (modelo inexistente), 429 com `Retry-After`, timeout, corpo não-JSON — todos virando erro PT-BR, com adapter fake de HTTP (mesmo padrão dos testes de `ClaudeProvider`).
- [ ] Parse de `usage` ausente/parcial => tokens 0 sem quebrar.
- [ ] Seleção: com `baseUrl` => compat; sem `baseUrl` => Claude (e a chave continua sendo usada como hoje).
- [ ] `url-guard` para `llm`: metadados bloqueados sempre; localhost/privado só com `allowPrivateHost` (caso Ollama).
- [ ] `saveIntegrationSchema`: chave exigida sem URL; aceita sem chave com URL; `SECRET_MIN` mantido.
- [ ] `costMicros`: modelos free/local => 0 com tokens contados; desconhecido => fallback conservador; orçamento 100% ainda pausa.
- [ ] Vazamento de segredo (console/log/toast/auditoria) com chave e URL.
- [ ] build/lint/typecheck/testes verdes.
- [ ] **PENDENTE (validação real):** Ollama local respondendo de verdade e/ou chave Gemini — marcado no relatório, como em SPECs anteriores.

## Criterios de aceite
- [ ] Agentes rodam com provedor gratuito configurado só pelo painel (sem mexer em `.env` nem código).
- [ ] Sem `baseUrl` configurada, o comportamento atual (Claude) não muda em nada (teste de regressão).
- [ ] URL privada exige confirmação "instância própria"; metadados sempre bloqueados.
- [ ] Custos com modelo grátis/local não estouram o orçamento, mas tokens e execuções continuam contados e o hard stop continua valendo.
- [ ] Saída continua passando por `agentOutputSchema` + guardrails; nenhuma mudança em envio/supressão/opt-out (SPEC-017/019 intactas).
- [ ] Nada em `../mobile/` alterado.
- [ ] Tela de Simular mostra provedor/modelo ativo.
- [ ] build/lint/typecheck/testes verdes; validação real (Ollama/Gemini) registrada como PENDENTE ou OK.

## Fases / ordem de execução
1. **dev-backend**: `OpenAICompatProvider` + seleção + url-guard/schema condicional + tabela de custo + testes.
2. **dev-frontend**: card do LLM em Integrações (URL/chave/instância própria/aviso LGPD/testar) + provedor/modelo visível no Simular.
3. **QA** (qa-reviewer): foco em vazamento de segredo, SSRF/`allowPrivateHost` e regressão do caminho Claude.
4. Validação real com Ollama (D-36-1) e depois Gemini, pelo usuário.

## Riscos / pendências
- Dialectos OpenAI-compatible variam (nomes de erro, `usage` ausente) — parse tolerante e erros normalizados; testar com pelo menos Ollama e um provedor nuvem.
- Ollama sem modelo baixado ou fora do ar => erro claro em PT-BR ("Provedor local indisponível…"), caindo em handoff, nunca envio.
- Custo 0 não pode desligar a noção de volume: limite diário/mensal de execuções continua valendo.
- Rate limit do free tier (Gemini/Groq) => 429 com backoff já coberto pela SPEC-016; mensagem no painel sugerindo Ollama para volume.
