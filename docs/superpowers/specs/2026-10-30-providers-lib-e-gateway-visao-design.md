# Providers numa lib compartilhada e o Gateway por perfis — visão

**Data:** 2026-10-30
**Status:** aprovado pelo dono (brainstorm de 2026-10-30, seção a seção)
**Escopo:** partes 2, 3 e 4 da reforma de providers
([parte 1](2026-10-29-providers-parte-1-operacao-e-forma-design.md), seção 0),
juntando o Igris e o Igris Gateway (`e:\Projetos\igris-gateway`).
**Documentos filhos desta rodada:**
- [T1.1 — lib, núcleo](2026-10-30-lib-providers-nucleo-design.md)
- T2.1 — Gateway, dados e API: `igris-gateway/docs/superpowers/specs/2026-10-30-gateway-perfis-produtos-e-api-compativel-design.md`

## 0. Por que

A parte 1 deu ao Igris uma camada de providers mais forte que a do Gateway. Cada modelo
declara operação e forma (`chat text+image->text`), os usos pedem nesse vocabulário e
contas novas são cadastradas sem código. O Gateway precisa da mesma coisa. Hoje ele
tem estas limitações:

- **Provedores fixos.** São 6 classes TypeScript (openrouter, openai, anthropic, google,
  groq, typesafe), e a chave de cada uma vem de variável de ambiente. Não existe cadastro
  de conta nem de modelo.
- **Perfis e preços no código** (`src/routing/profiles.ts`, `src/credits/pricing.ts`).
  Mudar um perfil exige deploy.
- **Perfis quase só de conversa.** Só o `default` cobre todas as modalidades, e as regras
  escolhem só pelo nome do uso (`compose`, `very-low-cost`).
- **Fallback diferente em cada rota**, sem timeout.
- **Rótulos que só um lado conhece.** `igris-text` e afins só existem no Igris: o Gateway
  ignora `model` e tira a operação da rota.

Já houve uma cópia de código entre os dois, e ela divergiu. O planejador de cache da
Anthropic existe nos dois lados: `anthropic-cache.js`, com 533 linhas, e
`anthropic-cache.ts`, com 414. A regra "quais Claude pensam por padrão" também está
repetida.

## 1. Decisões do dono

| # | Decisão |
|---|---|
| D1 | A lógica de providers vira uma **lib separada desde já**, em JavaScript ESM com tipos (JSDoc + `.d.ts` gerado). O Igris e o Gateway importam a mesma lib. |
| D2 | A lib também faz a **conversão de custo em créditos**, com taxa configurável. No Igris ela fica desligada; no Gateway, ligada com a taxa dele. Outros projetos podem usar com outra conversão. |
| D3 | O **repositório da lib é público** no GitHub. |
| D4 | Pode **reescrever**. Não é porte linha a linha. |
| D5 | A lib **não armazena nada**. Cada cliente guarda contas, modelos e consumo como quiser. |
| D6 | O **cache planejado fica no Gateway** por enquanto, porque depende do formato do prompt do Igris e guarda estado em memória. Desce para a lib depois que o Gateway estabilizar. |
| D7 | O Gateway fala **o formato da OpenAI/OpenRouter**, e o campo `model` passa a ser o **perfil**. `/v1/decide` e as capacidades continuam como rotas próprias. Para o Igris, o Gateway vira uma conta comum da lib. |
| D8 | O Gateway passa a ser **multiproduto**. Cada pedido diz de qual produto vem: hoje `igris`, amanhã `okapp`. Os **créditos são do usuário** e valem para todos os produtos. |
| D9 | O **padrão de cada uso fica no Gateway**, por produto. Um perfil é uma chave com uma operação + forma e uma cadeia ordenada de modelos (o principal e os fallbacks). O cliente nunca vê a cadeia. |
| D10 | A lista de um uso mostra primeiro os **sugeridos para aquele uso** e depois os **outros perfis compatíveis** pela forma. |
| D11 | O custo relativo é **só informativo**. Cada perfil tem dois textos: `descricao` (livre) e `referenciaDeCusto` (curta, por exemplo "consome ~2,5x mais créditos que o padrão"). Nenhum dos dois entra em cálculo. |
| D12 | As **chaves dos provedores ficam no Firestore, cifradas** com uma chave-mestra do ambiente (`GATEWAY_SECRETS_KEY`). A tela cadastra a conta sem deploy. As variáveis de ambiente continuam como reserva. |
| D13 | **Ordem de execução.** Os trens 1 (lib) e 2 (Gateway) andam em paralelo, e o Gateway é o primeiro consumidor da lib. Os dois se encontram quando o Gateway troca os adapters pela lib. Em seguida o Igris passa a falar com o Gateway como conta comum. Por último, o Igris troca os próprios protocolos pela lib. |

## 2. Arquitetura

```
                    ┌──────────────── LIB ok-gateway-providers (GitHub público) ─────────┐
                    │ vocabulário · formato de conta e modelo · fios · compat          │
                    │ transporte de anexo · uso normalizado · custo US$ → créditos     │
                    │ leitor de catálogo (formato OpenRouter)                          │
                    │ SEM banco, SEM roteamento, SEM cache planejado, SEM retry        │
                    └──────────────▲───────────────────────────▲──────────────────────┘
                                   │ importa                   │ importa
     ┌─────────────────────────────┴──────┐       ┌────────────┴──────────────────────────┐
     │ GATEWAY                            │       │ IGRIS                                 │
     │ guarda: contas (chave cifrada),    │       │ guarda: contas, modelos, usos         │
     │   modelos, perfis, produtos,       │       │   (Postgres, como hoje)               │
     │   saldo e consumo (Firestore)      │       │ créditos: conversão desligada         │
     │ faz: auth, produto, perfil →       │       │ Gateway = conta openai-completions    │
     │   cadeia, fallback, cache          │◄──────┤   (model = perfil ou "igris")         │
     │   planejado, cobrança              │ HTTP  └───────────────────────────────────────┘
     │ fala: OpenAI/OpenRouter-compatível │       ┌───────────────────────────────────────┐
     │   + /v1/decide + capacidades       │◄──────┤ OKAPP (futuro): model = okapp/…        │
     └────────────────────────────────────┘       │   mesmo saldo do usuário              │
                                                  └───────────────────────────────────────┘
```

O papel de cada parte:

- **A lib fala com provedores.** Recebe um pedido no vocabulário (operação + forma), a
  conta e o modelo. Devolve os eventos, o uso normalizado, o custo em dólar e um erro
  tipado. Os créditos só aparecem se o cliente ligar o conversor.
- **O Gateway decide para quem mandar e cobra.** Identifica o usuário e o produto, resolve
  o perfil na cadeia, percorre a cadeia com fallback, aplica o cache planejado e lança o
  consumo no saldo do usuário.
- **O Igris decide o que pedir.** Os usos escolhem conta e modelo. Na conta do Gateway, o
  "modelo" é um perfil ou o "Padrão do Igris".

Duas fronteiras ficam explícitas:

- **Cache.** A lib transporta os marcadores de cache (`cache_control`,
  `prompt_cache_breakpoint`, referência `cachedContent`). Quem decide onde eles vão é o
  cliente.
- **Codex.** Fica no Igris, porque depende do login do ChatGPT e do app-server local.

Duas regras de convivência:

- A lib só ganha um recurso quando um fio ou uma compat de provedor o justifica.
  Comportamento de cliente fica no cliente.
- A lib usa versão semântica, e cada consumidor fixa a versão que usa.

## 3. A lib (resumo — detalhe na T1.1)

- **Nome e licença.** `ok-gateway-providers`, no repositório `PatrickCavalcanti/ok-gateway-providers`,
  licença MIT. Node 20 ou mais novo, `fetch` nativo, zero dependência de runtime, testes
  em `node:test`.
- **Dados.**
  - Conta: `{ id, provider, api, baseUrl, apiKey, headers, compat, timeouts }`. A `apiKey`
    pode ser string **ou função** que devolve a chave na hora (é o caso do token Firebase
    do Gateway).
  - Modelo: `{ id, name, operations, input, output, reasoning, contextWindow, maxTokens,
    cost, compat, transport, params }`, no formato do pi-ai acrescido das nossas
    modalidades. O `cost` é em US$ por milhão de tokens e inclui leitura e escrita de
    cache, escrita de 1 h, áudio por segundo, mínimo cobrado e faixas de preço.
  - Os identificadores da lib ficam **em inglês**, para casar com o pi-ai e o OpenRouter.
    No brainstorm eles apareceram em português (`fio`, `custo`, `podeTentarOutro`). Os
    textos do perfil no Gateway se chamam `description` e `costReference`.
- **Fios.** `openai-completions`, `openai-responses` (adiado para a E4), `anthropic-messages` e
  `google-generative-ai`. As outras operações (embeddings, STT, TTS, imagem) ficam nos
  endpoints de cada fio. `decision` entra como fio da OpenRouter e da TypeSafe.
- **Compat declarado.** É um conjunto de campos no lugar dos cerca de 40 `if` por
  provedor. A conta define o padrão e o modelo sobrescreve. A conta genérica nasce
  conservadora: sem `developer`, sem `store` e sem saída estruturada.
- **Anexo (parte 3).** Imagem vai por `data-url` ou `url`. Áudio e vídeo vão por
  `input_audio` e `input_video`. Mídia que o modelo não aceita **dá erro claro**, nunca é
  descartada em silêncio. Upload por Files API fica fora até um fio precisar.
- **Retorno.**
  - Eventos: `texto`, `raciocinio`, `tool_call` e `fim`.
  - Uso: entrada, saída, cache lido e gravado, segundos de áudio.
  - Custo: o valor que o provedor informa vence; sem ele, usa a tabela do modelo; sem
    preço nenhum, marca `semPreco`.
  - Erro tipado `{ tipo, podeTentarOutro, jaEmitiu }`.
- **Créditos.** `criarConversorDeCreditos({ creditosPorDolar })`. O Gateway usa 5.500
  (5,5 ÷ 0,001).
- **Catálogo.** Lê o `/models` no formato OpenRouter e transforma em registros de modelo.
- **Fora da lib.** Retry, decisão de fallback, armazenamento, roteamento e planejadores de
  cache. A lib só classifica o erro.

## 4. O Gateway (resumo — detalhe na T2.1)

- **Dados no Firestore**, com cache de 60 s:
  - `provider_accounts`, com a chave cifrada em AES-256-GCM;
  - `models`, com o custo (a `MODEL_COSTS` do código migra para cá);
  - `profiles`;
  - `products`, que guarda o padrão **por pedido** (operação + forma, como o
    `model_defaults` do Igris) e o padrão **por uso**.
- **O perfil.** `{ chave: 'igris/chat-padrao', produto, nome, descricao, referenciaDeCusto,
  operation, forma, cadeia: [{ conta, modelo, reasoning?, params?, providerRouting? }],
  sugeridoPara: ['compose'], ativo }`.
- **Validação na gravação.** Cada modelo da cadeia cobre a forma do perfil. A conta tem o
  método da operação. Um modelo sem preço só entra se a conta informa o custo.
- **Cadastro.** Primeiro pela linha de comando (`npm run perfil|conta|modelo|produto -- ls |
  set --file | disable`), com os JSON versionados no repositório. Depois vem uma tela, e
  aí o Firestore passa a ser a fonte, com `profiles_history`.
- **API compatível.**
  - `GET /v1/models?produto=` lista os perfis no formato OpenRouter, com o bloco
    `gateway: { operation, referenciaDeCusto, sugeridoPara, padraoDe }` e **sem a cadeia**.
  - Rotas: `/v1/chat/completions`, `/v1/embeddings`, `/v1/audio/transcriptions`,
    `/v1/audio/speech` e `/v1/images/generations`, todas com o bloco
    `gateway: { uso, sessao, intencao, fallbackIndex }`.
- **Resolução.**
  - `model: "igris"` resolve para o padrão do uso. Sem ele, usa o padrão do pedido. Sem
    esse, usa um padrão da mesma operação que cubra a forma.
  - `model: "igris/rapido"` é perfil explícito.
  - Perfil inexistente ou desativado cai no padrão daquele uso, e a resposta traz
    `perfilPedido` e `perfilUsado`.
  - Pedido fora da forma do perfil recebe 400 com mensagem clara.
- **Fallback único, para todas as rotas.** O Gateway pula o alvo quando:
  - a conta está sem chave ou inativa;
  - o pedido exige algo que a compat do modelo não tem;
  - o erro tem `podeTentarOutro` e nada foi emitido ainda.

  Depois do primeiro byte, o erro é final. Os timeouts vêm da conta. O `fallbackIndex`
  vale em todas as operações. As tentativas descartadas vão para `gateway_failures`.
- **Rotas antigas** (`/v1/chat`, `/v1/vision`, `/v1/embed`, `/v1/stt`, `/v1/tts`) passam
  a traduzir para o motor novo: `routing.slot` vira uso, e `routing.profile` passa pela
  tabela de nomes antigos. Um script converte o `REGISTRY_BASE` em perfis e no produto
  `igris`. O Igris de hoje segue funcionando sem mudar.
- **Cobrança.** O custo em US$ da lib passa pelo conversor e vira créditos. `usage_events`
  ganha `produto` e `perfil`. O saldo é do usuário. A liberação por produto fica para
  quando houver um segundo produto à venda.
- **Cache.** Os planejadores continuam no Gateway e rodam antes da chamada, escolhidos pelo
  fio do alvo.

## 5. O Igris (entregas E3 e E4, depois dos trens)

**E3 — o Gateway como conta comum.**
- A conta "Igris Gateway" passa a usar o fio `openai-completions`. A chave é uma função
  que devolve o token Firebase, com a renovação que o Igris já tem.
- Os modelos da conta vêm de `/v1/models?produto=igris`, lido no boot e no botão
  "atualizar". Isso substitui o seed `packages/providers/src/seed/gateway-defaults.js` e os
  rótulos `igris-*`.
- Duas colunas novas, opcionais: `descricao` e `referencia_de_custo`.
- O modelo especial **"Padrão do Igris"** (`model: "igris"`) passa a ser o padrão de todo
  uso que aponta para o Gateway.
- O seletor, no grupo do Gateway, mostra nesta ordem: Padrão do Igris, Sugeridos para este
  uso, Outros compatíveis. A referência de custo aparece sob o nome, e a descrição no
  ícone de informação.
- Toda chamada leva `gateway.uso`. Quando `perfilUsado` for diferente de `perfilPedido`, o
  Igris registra no log e mostra um aviso no uso.
- `decide` e capacidades ficam numa extensão do Igris.
- **Migração:**
  - usos que apontam para `igris-*` passam a apontar para Padrão do Igris;
  - `config.gatewayProfile` sai e vira o perfil explícito do modelo principal, convertido
    pela tabela de nomes antigos;
  - o perfil por sessão do eval vira `model` explícito.
- **Verificação:** bancada num banco clonado.

**E4 — protocolos do Igris pela lib (parte 2 no Igris).**
- `packages/providers/src/protocols/*` dá lugar a um adaptador sobre a lib. Ficam no Igris
  o Codex, o Codex app-server, a extensão do Gateway e o planejador de cache da Anthropic,
  que serve a conta Anthropic própria.
- As contas ganham `fio` e `compat`. A migração converte `api_style`, `request_timeout_ms`
  e `stream_timeout_ms`.
- `vocabulario.js` reexporta o vocabulário da lib.
- **Verificação:** respostas gravadas cobrindo cada fio antes de apagar qualquer protocolo.

## 6. Erros e testes

| Situação | Comportamento |
|---|---|
| Chave que não decifra | A conta fica indisponível e a cadeia pula para o próximo alvo. O log diz qual conta. A chave nunca vai para log nem para resposta. |
| Sem `GATEWAY_SECRETS_KEY` | O Gateway sobe só com as chaves do ambiente e registra erro alto. |
| Firestore fora no boot | Os JSON do repositório, empacotados na imagem, servem de cópia de emergência. Se o Firestore cair depois do boot, vale a última cópia boa em memória. |
| Modelo sem preço | A gravação recusa, exceto em conta que informa custo. Se ainda assim chegar `semPreco`, a cobrança usa o custo de reserva ($5/$30) e grava um alerta. |
| Pedido fora da forma | 400 com mensagem clara, antes de gastar saldo. |

- **Lib.** Cada fio é testado contra respostas gravadas (SSE real, sem chave). Também
  entram na suíte a matriz de compat, o uso e o custo, o catálogo e o conversor. Um script
  manual com chaves reais confere cada provedor antes de publicar uma versão.
- **Gateway.** Testes de resolução, de fallback com uma lib falsa, de cifra, do cadastro e
  das rotas antigas: o mesmo pedido tem de dar a mesma forma de resposta de hoje. A
  verificação da entrega é rodar o Igris atual contra o Gateway novo local. O deploy só
  acontece com aprovação do dono, e a conversão dos dados de produção roda antes em
  `--dry-run`.

## 7. Entregas

| Entrega | O que entra | Spec |
|---|---|---|
| **T1.1 — lib, núcleo** | Vocabulário, formatos, fios `openai-completions` e `anthropic-messages`, compat, anexo, uso, custo e créditos, erros, catálogo, chave como função | [2026-10-30-lib-providers-nucleo-design.md](2026-10-30-lib-providers-nucleo-design.md) |
| T1.2 — lib, resto | `google-generative-ai` (com `cachedContent`), embeddings, STT, TTS, imagem, decision | spec própria |
| **T2.1 — Gateway, dados e API** | Coleções, cifra, linha de comando, migração do registry e dos preços, API compatível, resolução, fallback único, rotas antigas traduzidas. Roda sobre os adapters atuais até a lib chegar. | `igris-gateway/docs/superpowers/specs/2026-10-30-gateway-perfis-produtos-e-api-compativel-design.md` |
| T2.2 — encontro | O Gateway troca os 6 adapters pela lib | spec própria |
| E3 | O Igris fala com o Gateway como conta comum e ganha o seletor de perfis | spec própria |
| E4 | O Igris troca os protocolos pela lib | spec própria |

Criar o repositório público no GitHub é publicar, então pede a confirmação do dono no
momento de fazer, dentro da T1.1.

**Pendências da parte 1 que estas entregas resolvem** (os planos marcam cada uma):

| Pendência | Resolvida em |
|---|---|
| TTS do Gateway apagado a cada boot pelo seed | E3, porque o seed sai |
| Ideia do dono de o Gateway oferecer um conjunto de modelos | T2.1 + E3 |
| Gemini do Gateway descartando imagem em silêncio | T1.2, com erro claro |
| Saída estruturada por conta (F15) | compat da lib, T1.1 |
| `decision` por conta própria do OpenRouter | T1.2 |
