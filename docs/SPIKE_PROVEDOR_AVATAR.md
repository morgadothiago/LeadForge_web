# Spike: provedor de vídeo com avatar de IA (SPEC-070)

Status: **MODELO PARA PREENCHER** (nada testado ainda). Criado em 2026-10-13. Spec: `specs/70-spike-provedor-video-avatar/spec.md`.
Quem testa: o dono do projeto (e, de preferência, uma pessoa que fala português do Brasil como língua nativa).

> Regra de ouro: **nunca cole chave de API no chat, no repositório ou no `.env` versionado.** Chave fica em `~/.leadforge-secrets/` (pasta com permissão 700).
> Vídeos de teste ficam **fora** do repositório (ex.: `~/Desktop/spike-avatar/`). Aqui só entram notas e links.

---

## 1. Passo a passo (30 a 60 minutos)

1. **Crie a conta** com o e-mail da empresa, **sem cartão**, em cada provedor:
   - [ ] Magic Hour (400 créditos grátis + 100 por dia, com API e servidor mock; conta grátis NÃO tem direito comercial, só serve para teste)
   - [ ] D-ID (candidato a produção; trial grátis com marca d'água e uso comercial excluído, valores divergem entre fontes: conferir na página oficial)
   - [ ] deAPI (US$ 5 grátis, sem cartão; **NÃO confirmado que tenha avatar falante**: só testar se achar um endpoint de avatar/lip-sync na documentação oficial)
2. **Anote o que cada um dá de graça hoje** (preço e créditos mudam; olhe a página oficial, não blog) na tabela da seção 4.
3. **Gere os 3 vídeos** de cada provedor com os roteiros da seção 2, pelo **site** de cada um (não precisa de código nem de chave para isso). Use sempre o mesmo avatar de catálogo e a voz **pt-BR** (Brasil, não Portugal).
4. **Ouça e assista** cada vídeo e dê nota de 1 a 5 (seção 3). Se possível, peça para outra pessoa avaliar sem saber qual provedor fez qual vídeo.
5. **Preencha a seção 4** (custo e termos) lendo as páginas oficiais.
6. **Decida** na seção 5.

Só depois, se algum provedor passar, entra a chave de API (seção 6) e a SPEC-071.

---

## 2. Os 3 roteiros fixos (use exatamente estes textos)

### Roteiro A: saudação e prospecção (~15 s)
> Olá! Aqui é a Luciana, da LeadForge. Vi que a sua clínica está buscando novos pacientes. Posso te mostrar em dez minutos como automatizar o primeiro contato pelo WhatsApp. Responda esta mensagem e a gente agenda.

### Roteiro B: números, siglas e nomes (~30 s)
> Olá, tudo bem? Meu nome é Luciana e eu falo em nome da LeadForge Tecnologia, CNPJ doze ponto trezentos e quarenta e cinco ponto seiscentos e setenta e oito, barra zero zero zero um, traço nove cinco. Nosso plano Pro custa seiscentos e noventa e sete reais por mês e inclui até três mil leads, dez campanhas e integração com o Google Ads e o Meta. Se preferir falar com a gente, o telefone é onze, nove nove nove nove nove, zero zero zero zero. O atendimento é de segunda a sexta, das nove às dezessete horas.

### Roteiro C: perguntas e frases longas (~45 s)
> Você já parou para pensar quanto tempo a sua equipe gasta respondendo as mesmas perguntas todos os dias? Imagine ter um assistente que faz o primeiro contato, entende o que o cliente precisa e só chama uma pessoa quando realmente vale a pena. É isso que a LeadForge faz: ela organiza os seus contatos, envia mensagens no horário certo, respeita quem não quer receber e mostra, em um painel simples, quem respondeu e quem está pronto para comprar. Quer ver como funciona na prática? Posso preparar uma demonstração com os dados da sua própria clínica, sem compromisso, ainda esta semana.

**O que cada roteiro testa:** A = voz e simpatia; B = números por extenso, CNPJ, telefone, valores, siglas (Pro, CNPJ, Google Ads, Meta); C = entonação de pergunta, pausas e frases longas.

**Formato:** gere cada um em **9:16 (vertical)**; pelo menos um em **16:9** também.

---

## 3. Notas (1 a 5; 5 = excelente)

Preencha uma linha por vídeo. "Erros" = palavras mal pronunciadas por 100 palavras (conte só no Roteiro B e C).

### deAPI (só se tiver avatar falante)
| Roteiro | Pronúncia | Sotaque BR? (s/n) | Erros/100 pal. | Lip-sync | Naturalidade | Tempo p/ ficar pronto | Marca d'água? | Obs. |
|---|---|---|---|---|---|---|---|---|
| A | | | | | | | | |
| B | | | | | | | | |
| C | | | | | | | | |

### D-ID
| Roteiro | Pronúncia | Sotaque BR? (s/n) | Erros/100 pal. | Lip-sync | Naturalidade | Tempo p/ ficar pronto | Marca d'água? | Obs. |
|---|---|---|---|---|---|---|---|---|
| A | | | | | | | | |
| B | | | | | | | | |
| C | | | | | | | | |

### Magic Hour
| Roteiro | Pronúncia | Sotaque BR? (s/n) | Erros/100 pal. | Lip-sync | Naturalidade | Tempo p/ ficar pronto | Marca d'água? | Obs. |
|---|---|---|---|---|---|---|---|---|
| A | | | | | | | | |
| B | | | | | | | | |
| C | | | | | | | | |

**Aprovado se (da SPEC-070):** pronúncia ≤ 3 erros/100 palavras e sotaque brasileiro, nota média ≥ 4; lip-sync média ≥ 4 e sem deriva ao fim; naturalidade média ≥ 3,5; vídeo de 30 s pronto em até 5 minutos.

---

## 4. Conferência oficial (preço, termos, privacidade)

Preencha **só com o que estiver na página oficial** e registre a URL e a data. O que não for conferido fica **PLACEHOLDER**.

| Item | deAPI | D-ID | Magic Hour |
|---|---|---|---|
| Créditos/plano grátis hoje (URL + data) | | | |
| Preço por minuto ou por crédito (plano pago) | | | |
| Cobra vídeo que falhou? | | | |
| Duração máxima de um vídeo | | | |
| Marca d'água por plano | | | |
| Uso comercial permitido? | | | |
| Avatares de catálogo licenciados para anúncio/publicidade? | | | |
| Clonar rosto/voz exige consentimento? | | | |
| Roteiro/dados usados para treinar IA? (privacidade/DPA) | | | |
| Quanto tempo guarda o vídeo? Dá para apagar por API? | | | |
| Região dos dados / LGPD | | | |
| Idempotência na API (`Idempotency-Key`)? | | | |
| Status por polling e/ou webhook? | | | |
| Cancelar um vídeo em andamento? | | | |
| Limite de requisições (rate limit) | | | |
| O que acontece com roteiro rejeitado (moderação)? | | | |
| Endereço de download do vídeo (host/CDN, expira?) | | | |

**Conta de custo** (para o teto do plano Pro, SPEC-069: até 20 criativos/mês):
`custo por minuto × duração média (30 s = 0,5 min) × 20 vídeos × (1 + parte refeita) = ____ por cliente Pro/mês`. Cabe no teto definido? ( ) sim ( ) não.

---

## 5. Decisão

- Provedor vencedor: ______________________
- Motivo (nota mais alta entre os que passaram nos critérios eliminatórios, e depois o melhor custo): ______________________
- Se empatar em qualidade, preferir a API mais estável e com idempotência, mesmo custando um pouco mais.
- Se nenhum passar: ( ) testar outro provedor ( ) manter só o mock por enquanto. Próximos passos: ______________________
- Riscos que ficam: ______________________

---

## 6. Guardar a chave de API (só se algum provedor passar)

Não cole a chave no chat. Peça ao Claude para criar um script igual ao `~/save_resend_key.sh` para o provedor escolhido; ele grava em `~/.leadforge-secrets/` com permissão 700, sem eco no terminal. Antes de fechar o spike, confirme que não vazou:

```
git grep -nEi "(api[_-]?key|secret|token)\s*[:=]\s*['\"][A-Za-z0-9_\-]{16,}" -- . ':!node_modules' | head
```

(deve voltar vazio)

---

## 7. Como reproduzir (para quem for repetir)

1. Mesma conta, mesmo avatar, mesma voz, mesmos 3 roteiros da seção 2.
2. Medir o tempo entre clicar em gerar e o vídeo ficar pronto, 3 vezes, para o Roteiro B.
3. Registrar data e URL de cada conferência oficial.
