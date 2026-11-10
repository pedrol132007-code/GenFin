# Agente de investimentos: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aba **Agente** no GenFin: conversa com a IA que sugere comprar, vender ou começar ativos novos (ações e FIIs), sempre com números reais de mercado, mais o resumo do dia e o plano de aporte com botão Comprar.

**Architecture:** Um módulo de mercado sem IA (`api/_mercado.js`, não vira função por começar com `_`) lê Fundamentus, Yahoo, B3 e Focus, normaliza e faz a triagem em código. A função `api/agente.js` identifica a intenção da pergunta, pré-busca os dados certos e faz uma chamada ao Groq (no máximo 1 rodada extra de ferramenta), devolvendo JSON validado. No aparelho, `carteira.html` monta o retrato em percentuais, converte o plano em cotas e calcula o imposto de venda localmente.

**Tech Stack:** JS sem framework em `carteira.html` (arquivo único), funções CommonJS da Vercel (Node 24, `fetch` nativo), Groq (`openai/gpt-oss-120b` via `escolherModelo`), testes em Node puro (`npm test`).

**Spec:** `docs/superpowers/specs/2026-11-10-agente-investimentos-design.md`

## Global Constraints

- Tudo grátis: Vercel Hobby + Groq gratuito (`GROQ_API_KEY` já em Production). Limite: 8 000 tokens/minuto, 200 000/dia, 30 req/min.
- Meta de ~6–8k tokens por pergunta; uma chamada ao modelo + **no máximo 1** rodada extra de ferramenta.
- Nenhum valor em reais e nenhuma quantidade sai do aparelho. O servidor recebe percentuais, códigos, distância % ao preço médio, perfil e pergunta, e não guarda nada.
- A IA não faz conta de dinheiro: devolve `pct_do_aporte` por ativo; o app converte em cotas inteiras.
- Ticker sugerido só é aceito se veio das ferramentas ou da carteira.
- Ativos novos: só ações e FIIs. ETFs e cripto: só reforço do que já existe. Renda fixa: linha "Renda fixa: R$ X, escolha o título".
- gpt-oss: `reasoning_effort: "low"` e `max_tokens` com folga (senão volta vazio, `finish_reason: "length"`).
- Fundamentus vem em **ISO-8859-1**: decodificar com `new TextDecoder("latin1")`; números BR (`1.234,56`, `12,3%`).
- Status Invest descartado (anti-robô). Não contornar.
- CORS: mesma lista `ORIGENS` de `api/resumo.js` + regex de prévias `genfin-*.vercel.app`.
- Textos em português do Brasil; frase fixa na aba: "Sugestões automáticas a partir de números públicos; a decisão é sua."
- Sem notificações; nada guardado no servidor por causa do agente.
- Versão 2.0.0. Trabalhar na branch `agente`; mesclar na main só depois de o usuário testar a prévia.

## Review Focus

1. **Fonte de mercado fora do ar ou HTML mudou** (Fundamentus 5xx, tabela sem cabeçalhos esperados): o agente responde com o que tiver e diz "não consegui os indicadores agora"; nunca 500 nem candidatos inventados. Teste na Tarefa 4.
2. **IA devolve JSON quebrado, ticker fora da lista ou percentuais que não somam 100:** o texto aparece, as linhas inválidas somem e os percentuais são normalizados. Teste na Tarefa 4.
3. **Aporte menor que o preço de uma cota, ou com sobra:** linhas com 0 cotas não aparecem e a sobra é mostrada certa; aporte vazio ou "abc" pede um valor. Teste na Tarefa 6.
4. **Groq em 429:** a mensagem diz quanto esperar (`retry-after`) e a pergunta continua na tela para reenviar. Testes nas Tarefas 4 e 5.
5. **Ticker fracionário (`ITSA4F`) e carteira vazia ou modo exemplo:** fracionário vira `ITSA4` nas fontes; carteira vazia ou modo exemplo mostra convite sem chamar a IA. Testes nas Tarefas 4 e 5.

---

### Tarefa 1: Leitores das fontes de mercado (funções puras)

**Files:**
- Create: `api/_mercado.js`
- Create: `tests/fixtures/fundamentus-acoes.html`, `tests/fixtures/fundamentus-fii.html`, `tests/fixtures/fundamentus-detalhe.html`, `tests/fixtures/yahoo-petr4.json`, `tests/fixtures/focus.json`
- Create: `tests/mercado.test.js`
- Modify: `package.json` (script `test` passa a rodar também `node tests/mercado.test.js`)

**Interfaces:**
- Produces (exportadas de `api/_mercado.js`):
  - `numBR(s: string) -> number|null`: `"1.234,56"`→1234.56, `"12,3%"`→0.123, `""`/`"-"`→null.
  - `lerTabelaFundamentus(html: string) -> Acao[]`, onde `Acao = {ticker, cotacao, pl, pvp, dy, evEbit, margemLiq, roic, roe, liq2m, divLiqPatrim, crescRec5a}` (percentuais como fração).
  - `lerTabelaFII(html) -> FII[]`, onde `FII = {ticker, segmento, cotacao, ffoYield, dy, pvp, valorMercado, liquidez, qtdImoveis, capRate, vacancia}`.
  - `lerDetalhe(html) -> {setor, subsetor, max52, min52}`.
  - `lerPrecos(json) -> {preco, max52, min52, mensal: [{mes:"AAAA-MM", fech:number}]}`.
  - `lerFocus(json) -> {selic: {[ano]: mediana}, ipca: {[ano]: mediana}}`.
  - `dyPorAno(proventos: [{valor, dataCom}], mensal) -> [{ano, dy}]`: soma dos proventos com data com no ano ÷ média dos fechamentos mensais do ano; só anos completos com ≥ 6 meses de preço.
  - `tickerBase(t) -> string`: `ITSA4F`→`ITSA4`.

- [ ] **Step 1: Salvar as fixtures.** Baixar as páginas reais (User-Agent de navegador; URLs na spec), cortar cada tabela para ~6 linhas, incluindo `PETR4`, `BBAS3`, `ITSA4`, uma linha toda zerada (como `IVTT3`) e, nos FIIs, `MXRF11`, `HGLG11`, `KNCR11`. Gravar em latin1, como o site manda. `yahoo-petr4.json` com `range=5y&interval=1mo`; `focus.json` com Selic e IPCA (`$filter=Indicador eq 'Selic' or Indicador eq 'IPCA'`).

Cabeçalhos exatos (ler colunas **pelo cabeçalho**, não pela posição):
- ações: `Papel, Cotação, P/L, P/VP, PSR, Div.Yield, P/Ativo, P/Cap.Giro, P/EBIT, P/Ativ Circ.Liq, EV/EBIT, EV/EBITDA, Mrg Bruta, Mrg Ebit, Mrg. Líq., Liq. Corr., ROIC, ROE, Liq.2meses, Patrim. Líq, Dív.Líq/ Patrim., Cresc. Rec.5a`
- FIIs: `Papel, Segmento, Cotação, FFO Yield, Dividend Yield, P/VP, Valor de Mercado, Liquidez, Qtd de imóveis, Preço do m2, Aluguel por m2, Cap Rate, Vacância Média, Endereço`

- [ ] **Step 2: Escrever os testes que falham** em `tests/mercado.test.js` (mesmo estilo `ok(cond, msg)` de `tests/api.test.js`, saindo com código 1 se houver falha):

```js
const m = require("../api/_mercado.js"), fs = require("fs"), fx = n => fs.readFileSync(__dirname + "/fixtures/" + n);
const lat = b => new TextDecoder("latin1").decode(b);
ok(m.numBR("1.234,56") === 1234.56 && m.numBR("12,3%") === 0.123 && m.numBR("") === null, "numBR lê formato brasileiro");
const acoes = m.lerTabelaFundamentus(lat(fx("fundamentus-acoes.html")));
const bb = acoes.find(a => a.ticker === "BBAS3");
ok(bb && bb.pl > 0 && bb.dy > 0 && bb.dy < 1 && bb.liq2m > 1e6, "BBAS3 com P/L, DY em fração e liquidez");
ok(m.lerTabelaFundamentus("<html>mudou</html>").length === 0, "HTML sem a tabela devolve lista vazia, sem erro");
const fii = m.lerTabelaFII(lat(fx("fundamentus-fii.html"))).find(f => f.ticker === "MXRF11");
ok(fii && fii.segmento && fii.pvp > 0, "MXRF11 com segmento e P/VP");
ok(m.lerDetalhe(lat(fx("fundamentus-detalhe.html"))).setor === "Intermediários Financeiros", "setor do BBAS3");
const pr = m.lerPrecos(JSON.parse(fx("yahoo-petr4.json")));
ok(pr.preco > 0 && pr.mensal.length >= 50 && /^\d{4}-\d\d$/.test(pr.mensal[0].mes), "5 anos de preços mensais");
ok(m.lerFocus(JSON.parse(fx("focus.json"))).selic[2027] > 0, "Selic esperada para 2027");
const dy = m.dyPorAno([{valor: 1, dataCom: "2024-03-10"}, {valor: 1, dataCom: "2024-09-10"}],
  Array.from({length: 12}, (_, i) => ({mes: "2024-" + String(i + 1).padStart(2, "0"), fech: 20})));
ok(dy.length === 1 && dy[0].ano === 2024 && Math.abs(dy[0].dy - 0.1) < 1e-9, "DY do ano = proventos ÷ preço médio");
ok(m.tickerBase("ITSA4F") === "ITSA4" && m.tickerBase("MXRF11") === "MXRF11", "fracionário vira o lote");
```

- [ ] **Step 3: Rodar e ver falhar.** `node tests/mercado.test.js` → erro "Cannot find module '../api/_mercado.js'".
- [ ] **Step 4: Implementar** as funções acima em `api/_mercado.js` (regex sobre `<tr>/<td>`, como já é feito no app; sem dependências novas).
- [ ] **Step 5: Rodar.** `npm test` → todos `ok`, inclusive os 283 antigos.
- [ ] **Step 6: Commit.** `git checkout -b agente` (se ainda não estiver), `git add api/_mercado.js tests/ package.json`, mensagem "Agente: leitores de Fundamentus, Yahoo e Focus".

---

### Tarefa 2: Triagem de candidatos

**Files:**
- Modify: `api/_mercado.js`
- Test: `tests/mercado.test.js`

**Interfaces:**
- Consumes: `Acao`, `FII` da Tarefa 1.
- Produces: `triagem(lista: Acao[]|FII[], classe: "acao"|"fii", {excluir?: string[], n?: number=10}) -> Candidato[]`, onde `Candidato = {ticker, nota: 0..1, motivos: string[], ...campos originais}`, ordenado por nota decrescente.

Filtros de sanidade (valores fixos, documentados em comentário):
- ações: `liq2m >= 1_000_000`, `pl > 0 && pl <= 25`, `pvp > 0`, `roe > 0`, `dy <= 0.20` (acima disso é provento extraordinário);
- FIIs: `liquidez >= 500_000`, `pvp >= 0.5 && pvp <= 1.3`, `dy > 0 && dy <= 0.20`.

Nota (perfil crescimento + renda): média dos **percentis** dentro do grupo filtrado. Ações: `1/pl`, `roe`, `dy`, `crescRec5a`, `-divLiqPatrim`. FIIs: `dy`, `1/pvp`, `-vacancia`. `motivos` traz 2–3 frases curtas com os números, por exemplo `"P/L 6,7"` ou `"ROE 17%"`.

- [ ] **Step 1: Testes que falham**

```js
const base = {cotacao: 10, pvp: 1, evEbit: 5, margemLiq: .1, roic: .1, divLiqPatrim: .5, crescRec5a: .1};
const lista = [
  {...base, ticker: "BOA3", pl: 5, roe: .25, dy: .09, liq2m: 5e6},
  {...base, ticker: "MEIA3", pl: 12, roe: .12, dy: .05, liq2m: 5e6},
  {...base, ticker: "ILIQ3", pl: 4, roe: .30, dy: .10, liq2m: 1e4},
  {...base, ticker: "PREJ3", pl: -3, roe: -.1, dy: 0, liq2m: 5e6},
  {...base, ticker: "XTRA3", pl: 6, roe: .2, dy: .45, liq2m: 5e6}];
const t = m.triagem(lista, "acao");
ok(t[0].ticker === "BOA3" && t.length === 2, "melhor primeiro; ilíquida, com prejuízo e DY anômalo ficam fora");
ok(m.triagem(lista, "acao", {excluir: ["BOA3"]})[0].ticker === "MEIA3", "exclui o que já está na carteira");
ok(t[0].motivos.some(s => /P\/L 5/.test(s)), "motivos citam os números");
```

- [ ] **Step 2:** `node tests/mercado.test.js` → FALHA ("m.triagem is not a function").
- [ ] **Step 3: Implementar** `triagem` em `api/_mercado.js`.
- [ ] **Step 4:** `npm test` → passa.
- [ ] **Step 5: Commit** "Agente: triagem de ações e FIIs pelo perfil".

---

### Tarefa 3: Busca com cache (rede)

**Files:**
- Modify: `api/_mercado.js`, `api/proventos.js`, `api/noticias.js`
- Test: `tests/mercado.test.js`

**Interfaces:**
- Produces (todas `async`, com cache em memória do processo por TTL; a Fluid Compute reaproveita a instância):
  - `acoes() -> Acao[]` (TTL 6 h), `fiis() -> FII[]` (6 h), `detalhe(t) -> {setor,subsetor,max52,min52}` (24 h), `precos(t) -> lerPrecos(...)` (1 h), `focus() -> lerFocus(...)` (6 h), `historicoProventos(t, classe) -> [{valor, dataCom}]` (24 h).
  - Toda busca usa `AbortSignal.timeout(8000)` e User-Agent de navegador; erro de rede ou status ≠ 200 **lança** `Error("fonte:<nome>")`, e o erro não fica no cache.
- `api/noticias.js`: extrair e exportar `manchetes(t, n = 3) -> [{titulo, fonte, data}]` (a mesma busca RSS da rota, reaproveitando `lerRSS`), com cache de 30 min. A rota não muda.
- `api/proventos.js`: extrair `cashDividends(t, classe) -> [{valor, dataCom, pagamento, tipo}]` sem a janela de 150 dias, exportar, e fazer `proventosAcao/proventosFII` usarem isso + `lerProventos`. O comportamento da rota `/api/proventos` não muda.

- [ ] **Step 1: Testes que falham** com `global.fetch` falso (contar chamadas):
  - `await acoes()` duas vezes → 1 só chamada a `fundamentus.com.br/resultado.php`.
  - fetch que devolve status 503 → `acoes()` rejeita com mensagem `"fonte:fundamentus"`; a chamada seguinte tenta de novo (erro não ficou no cache).
  - `historicoProventos("ITSA4","acao")` com respostas B3 simuladas (copiar o formato de `tests/api.test.js` para proventos) → inclui provento de 2 anos atrás.
  - Os testes existentes de `/api/proventos` continuam passando.
- [ ] **Step 2:** `npm test` → FALHA nas novas.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** `npm test` → passa.
- [ ] **Step 5: Commit** "Agente: busca das fontes com cache".

---

### Tarefa 4: Função `api/agente.js`

**Files:**
- Create: `api/agente.js`
- Modify: `api/resumo.js` (exportar `escolherModelo`, `ORIGENS` e o tratamento de CORS para reaproveitar; ver Tarefa 7 para os modos que saem)
- Create: `tests/agente.test.js`; Modify: `package.json` (incluir no `test`)

**Interfaces:**
- Consumes: Tarefas 1–3.
- Pedido (`POST`, JSON):
  ```
  { modo: "dia" | "pergunta",
    carteira: { classes: [{classe, carteira_pct, meta_pct, diferenca_meta_pp}],
                posicoes: [{ativo, classe: "acao"|"etf"|"fii"|"rf"|"cripto", peso_pct, resultado_pct, dist_pm_pct}],
                metas_ok: boolean,
                ir: {vendas_acoes_pct_do_limite, prejuizo_a_compensar},
                proventos_a_receber: [...mesmo formato de hoje] },
    perfil: string (≤ 800 chars),
    pergunta?: string (≤ 400),
    historico?: [{p, r}] (≤ 3),
    aporte_por_classe_pct?: {acao, etf, fii, rf, cripto} }   // divisão do aporte em %, sem reais
  ```
  `dist_pm_pct` = (cotação − preço médio) ÷ preço médio × 100.
- Resposta 200:
  ```
  { texto: string,
    avisos: [{texto, ticker?}],                       // modo "dia", no máximo 3
    compras: [{ticker, classe, pct_do_aporte, motivo, novo: boolean}],
    vendas: [{ticker, acao: "vender"|"reduzir", motivo}],
    dados: { [ticker]: {preco, pl?, pvp?, dy?, roe?, setor?, max52?, min52?, dy_medio?} },  // o que embasou; o app mostra no "por quê?"
    fontes_falharam: string[], em: ISO }
  ```
  Erros: 405 (método), 400 (formato), 503 `{erro:"sem_chave"}`, 429 `{erro:"limite", esperar_s}` (de `retry-after` do Groq), 502 `{erro:"servico"}`.
- Produces (exportadas para teste): `intencao(pergunta) -> {tipo: "aporte"|"acoes"|"fiis"|"venda"|"ativo"|"aberta", tickers: string[]}`; `validarSaida(saida, permitidos: Set<string>, carteira) -> saida limpa`.

Regras de `intencao` (por palavras, sem IA): "aport|investir|comprar com|tenho R$" → aporte; "vend|realizar|sair de" → venda; "fii|fundo imobili" → fiis; "aç(ão|ões)|bolsa" → acoes; tickers `/\b[A-Z]{4}\d{1,2}F?\b/` (em maiúsculas) → ativo; senão, aberta.

Pré-busca por intenção (o que vai para a IA, já enxuto):
- **aporte:** triagem top 6 ações e top 6 FIIs (excluindo a carteira, se a classe tiver parcela > 0) + fundamentos das posições de ação e FII + Focus.
- **acoes / fiis:** fundamentos + `detalhe` (setor) das posições da classe + triagem top 5 da classe.
- **venda:** fundamentos + faixa de 52 semanas + `dy_medio` (de `dyPorAno`, até 5 anos) + 2 `manchetes` das posições de ação e FII (para notar notícia ruim, como corte de dividendos).
- **ativo:** fundamentos, detalhe, preços, `dy_medio` e 3 `manchetes` dos tickers citados.
- **aberta:** retrato da carteira + Focus; a ferramenta extra fica disponível.
- **dia:** posições com `dist_pm_pct`, faixa de 52 semanas, proventos a receber, triagem top 3 de ações e de FIIs, setores ausentes.

Chamada ao Groq: `response_format: {type: "json_object"}`, `temperature: 0.3`, `reasoning_effort: "low"`, `max_tokens: 2500`. Ferramentas (formato OpenAI `tools`), no máximo **1** rodada: `fundamentos(tickers[])`, `candidatos(classe, n)`. Se a resposta da rodada extra pedir outra ferramenta, a função encerra pedindo a resposta final sem ferramentas.

Instruções do agente (texto fixo, em constante `REGRAS_AGENTE`): papel de assistente de uma pessoa física no Brasil; perfil vem no pedido; **pode** sugerir comprar, reduzir ou vender e ativos novos, mas só citando números presentes nos dados; sem previsão de preço; vender é exceção (fundamento piorou, ou caro perto do próprio histórico); lembrar de reinvestir proventos; ETFs e cripto só reforço; renda fixa só comparação com CDI/Focus; responder só JSON no formato acima; fora do tema → `texto: "Eu só respondo sobre a sua carteira."`.

`validarSaida`: descarta compra ou venda cujo ticker não esteja em `permitidos` (tudo que veio das ferramentas ou da pré-busca + posições da carteira); descarta compra nova de ETF ou cripto; normaliza `pct_do_aporte` para somar 100 **dentro de cada classe**; corta `avisos` em 3; JSON que não parseia → `{texto: conteúdo bruto sem chaves, compras: [], vendas: [], avisos: []}`.

- [ ] **Step 1: Testes que falham** em `tests/agente.test.js` (Groq e fontes simulados via `global.fetch`; reaproveitar `chamar()` de `tests/api.test.js`):
  - `intencao("vou aportar 2 mil, sugestões?").tipo === "aporte"`; `intencao("e o ITSA4F?")` → `{tipo:"ativo", tickers:["ITSA4"]}`; `intencao("algo pra vender?").tipo === "venda"`.
  - aporte: o corpo enviado ao Groq contém `BBAS3` (da triagem) e **não** contém `"R$"` nem números de quantidade; `JSON.stringify(mensagens).length < 24000`.
  - `validarSaida` remove `{ticker:"FAKE3"}`, remove compra nova de ETF, e `[{acao 30},{acao 30}]` vira 50/50.
  - Groq devolve texto que não é JSON → 200 com `texto` e listas vazias.
  - Groq 429 com `retry-after: 20` → 429 `{erro:"limite", esperar_s:20}`.
  - Fundamentus 503 → 200 com `fontes_falharam` contendo `"fundamentus"` e instrução à IA de que os indicadores estão indisponíveis; `compras` só com tickers da carteira.
  - Rodada extra: Groq pede `fundamentos(["WEGE3"])` → segunda chamada inclui resultado da ferramenta; se pedir de novo, a terceira chamada vai **sem** `tools`. Total de chamadas ao Groq ≤ 3.
  - CORS: origem `https://site-qualquer.com` não recebe cabeçalho; prévias `genfin-xyz.vercel.app` recebem.
- [ ] **Step 2:** `npm test` → FALHA.
- [ ] **Step 3: Implementar** `api/agente.js`.
- [ ] **Step 4:** `npm test` → passa.
- [ ] **Step 5: Commit** "Agente: função que pré-busca dados e conversa com o Groq".

---

### Tarefa 5: Aba Agente no app (conversa e resumo do dia)

**Files:**
- Modify: `carteira.html`: `ABAS` (linha ~541), abas do desktop (`#abas`, ~436), doca (~463), folha "Mais" (~471), `irPara` (`naDoca`), `render`, novo bloco "Agente" perto do bloco da IA (~1683), CSS.
- Test: `tests/carteira.test.js`

**Interfaces:**
- Consumes: resposta da Tarefa 4.
- Produces:
  - `LS_AGENTE = "genfin-agente-conversa"` (últimas 20 mensagens), `LS_AGENTE_DIA = "genfin-agente-dia"` (`{data: "AAAA-MM-DD", hash, resposta}`), `LS_PERFIL = "genfin-agente-perfil"`.
  - `PERFIL_PADRAO`: texto do perfil aprovado na spec (longo prazo, patrimônio + renda, reinvestir, vender é exceção, mais risco respeitando metas, diversificação).
  - `dadosParaAgente(aportePorClassePct?) -> pedido.carteira` (deriva de `dadosParaIA()`, com `classe` em código, `dist_pm_pct` a partir de `p.cot` e `p.pm`, `metas_ok`).
  - `pedirAgente(modo, extra) -> resposta` (mesmo padrão de erros de `pedirIA`: `erroCot("limite")` passa a carregar `esperar_s`).
  - `resumoDoDia({forcar}) -> Promise<void>`: 1× por dia e por `hashCarteiraIA()`, guardado em `LS_AGENTE_DIA`.
  - `perguntarAgente(texto)`, `rAgente(el)`.
- Navegação: `ABAS` ganha `"agente"`; doca vira Resumo · **Agente** · Lançar · Ativos · Mais; "Análises" entra na folha "Mais"; `naDoca = ["resumo","agente","lancamentos","ativos"]`; no desktop, Agente entra logo depois de Resumo. Ícone do Agente: o ✦ já usado na IA, em SVG.
- `rAgente`: layout "conversa primeiro" do rascunho A (`.superpowers/brainstorm/136-1794333162/content/aba-agente.html`). Primeira bolha = avisos do dia; bolhas da conversa; chips "Como estão as ações?", "Algo para vender?", "Vou aportar…"; caixa de texto; frase fixa de rodapé; "Nova conversa"; seção recolhível "Seu perfil" (textarea com `PERFIL_PADRAO`, botão Restaurar). Cada compra ou venda vira linha com botão (Tarefa 6) e um `<details>` "por quê?" com `motivo` + números de `dados[ticker]` formatados (P/L, DY, P/VP, ROE, setor, faixa de 52 semanas, DY médio) e "dados de dd/mm hh:mm".
- Modo exemplo ou carteira vazia: bolha-convite, sem chamada. 429: bolha de erro "A IA atingiu o limite gratuito; tente em N s", e o texto volta para a caixa.

- [ ] **Step 1: Testes que falham** em `tests/carteira.test.js` (`__fetch` simulado):
  - `ABAS.includes("agente")`, e `render("agente")` não lança erro.
  - `dadosParaAgente()` com PETR4 (pm 30, cotação 33) → posição com `dist_pm_pct === 10` e `classe === "acao"`; `JSON.stringify` do pedido não contém o total da carteira em reais nem `qtd`.
  - `resumoDoDia()` chamado 2× no mesmo dia → 1 chamada a `/api/agente`; com a carteira mudada → chama de novo.
  - Modo exemplo: `perguntarAgente("oi")` não chama `fetch`.
  - Resposta 429 `{esperar_s: 20}` → mensagem contém "20" e a caixa de texto mantém a pergunta.
- [ ] **Step 2:** `npm test` → FALHA.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** `npm test` → passa. Abrir `carteira.html` no navegador (modo exemplo + uma carteira de teste) e conferir a aba no celular (DevTools, 390 px) e no desktop, nos temas claro e escuro.
- [ ] **Step 5: Commit** "Agente: aba com conversa, resumo do dia e perfil".

---

### Tarefa 6: Plano de aporte e imposto de venda (no aparelho)

**Files:**
- Modify: `carteira.html`: extrair a divisão de `rRebalancear` (~2445–2451) para função; `abrirOp` (~1989); bloco do Agente.
- Test: `tests/carteira.test.js`

**Interfaces:**
- Produces:
  - `divisaoAporte(ap: number) -> {porClasse: {acao, etf, fii, rf, cripto}} | null` (em R$; `null` se as metas não somam 100). `rRebalancear` passa a usá-la, com saída idêntica.
  - `planoAporte(ap, compras, dados, divisao) -> {linhas: [{ticker, classe, qtd, preco, valor, novo}], rf: number, sobra: number}`: por classe, `valor_alvo = divisao[classe] × pct/100`; `qtd = floor(valor_alvo / preco)` (cripto: 8 casas); linhas com `qtd = 0` saem; `sobra = ap − Σvalor − rf`. Sem metas (`divisao` null): só ações e FIIs, com a parcela de cada classe = soma dos `pct_do_aporte` que a IA deu a ela (normalizada para 100 entre as duas).
  - `impostoVenda(ticker) -> {lucro, imposto, isento: boolean, motivo: string}` para vender a posição inteira à cotação atual. Ações: isento se as vendas de ações do mês + esta ≤ R$ 20.000, senão 15% do lucro. ETF: 15%, sem isenção. FII: 20%, sem isenção. Lucro ≤ 0 → imposto 0 com `motivo` "sem lucro". `motivo` avisa "antes de compensar prejuízos" quando houver prejuízo acumulado. Usar `calcular()` (`p.pm`, `p.qtd`, `p.cot`, `c.vendas`).
  - `abrirOp(modo, ticker, {qtd} = {})`: pré-preenche a quantidade.
- UI: "Vou aportar…" pede o valor (campo numérico na própria bolha; `parseNum`; vazio ou inválido → "Digite quanto vai aportar"). O valor fica no aparelho; o pedido leva só `aporte_por_classe_pct`. Linhas de compra: ticker (selo "novo" se `novo`), `qtd × preço = valor`, botão **Comprar** → `abrirOp("compra", t, {qtd})`. Linha de renda fixa e linha de sobra. Sem metas: aviso "Com metas definidas o plano fica mais certeiro" + botão para Rebalancear. Linhas de venda: botão **Vender** → `abrirOp("venda", t)` e o texto de `impostoVenda`.

- [ ] **Step 1: Testes que falham**
  - `divisaoAporte` reproduz a tabela atual de `rRebalancear` num caso com metas 50/30/20 (comparar com os números do teste de rebalanceamento existente).
  - `planoAporte(2000, [{ticker:"ITSA4",classe:"acao",pct_do_aporte:50},{ticker:"BBAS3",classe:"acao",pct_do_aporte:50},{ticker:"MXRF11",classe:"fii",pct_do_aporte:100}], {ITSA4:{preco:10.4},BBAS3:{preco:17.02},MXRF11:{preco:9.7}}, {porClasse:{acao:1200,fii:800,etf:0,rf:0,cripto:0}})` → ITSA4 57 cotas, BBAS3 35, MXRF11 82; `sobra` = 2000 − Σ, com 2 casas.
  - Ativo com preço maior que a parcela → linha não aparece e o valor vai para `sobra`.
  - `planoAporte` com `divisao` null usa só ações e FIIs.
  - `impostoVenda`: ação com R$ 15 mil de venda → isento; com R$ 25 mil → 15% do lucro; FII → 20%; prejuízo → imposto 0.
- [ ] **Step 2:** `npm test` → FALHA.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4:** `npm test` → passa, inclusive os testes antigos de Rebalancear.
- [ ] **Step 5: Commit** "Agente: plano de aporte em cotas e imposto da venda no aparelho".

---

### Tarefa 7: Unificar as IAs antigas

**Files:**
- Modify: `carteira.html`: manchete (`atualizarManchete`, `htmlManchete`, ~1780–1805), caixa `#f-perguntar` (~1187), `iaMini` e a ação `ia-perguntar`, `#dlg-ia` (~484) e funções da conversa antiga (`conversa`, `perguntarIA`, `renderConversa`, `sugestoesIA`, `chipsSugestoes`), `IA_INSTRUCOES`/`IA_TOKENS` (manter só `resumo`).
- Modify: `api/resumo.js`: remover os modos `manchete` e `pergunta` (fica só `resumo`).
- Modify: `tests/api.test.js`, `tests/carteira.test.js`.

**Interfaces:**
- Manchete do Resumo: mostra `LS_AGENTE_DIA.resposta.avisos[0].texto` (ou o `texto` se não houver avisos); rodapé "Do agente, hoje às hh:mm" + "Atualizar" (`resumoDoDia({forcar:true})`); tocar abre a aba Agente. Sem chamada própria.
- `#f-perguntar` e os ✦ → `irPara("agente")` + `perguntarAgente(q)`.
- `LS_CONVERSA` antigo: na primeira abertura, apagar (não migrar).
- Chave própria do Groq (`LS_GROQ`) segue só para o resumo de Análises; a aba Agente sempre usa o servidor e, com `sem_chave`, diz "O agente precisa da IA do servidor do GenFin".

- [ ] **Step 1: Ajustar os testes:** remover os de `manchete`/`pergunta` em `api/resumo.js` e no app; adicionar: modo `pergunta` em `/api/resumo` → 400; manchete lê o primeiro aviso de `LS_AGENTE_DIA`; ✦ com `data-q` → `abaAtual === "agente"` e 1 chamada a `/api/agente`.
- [ ] **Step 2:** `npm test` → FALHA nos novos.
- [ ] **Step 3: Implementar** (apagar o código morto; `grep` por `dlg-ia`, `perguntarIA`, `LS_MANCHETE`, `"manchete"`, `"pergunta"` não deve achar sobras).
- [ ] **Step 4:** `npm test` → passa.
- [ ] **Step 5: Commit** "Agente: manchete, pergunta e ✦ passam pelo agente".

---

### Tarefa 8: Versão, documentação e prévia

**Files:**
- Modify: `package.json` (`"version": "2.0.0"`), `sw.js` (`CACHE = "genfin-v2"`), `README.md` (seção do Agente: o que faz, fontes, limites do Groq, privacidade), `docs/img/agente.png` (captura via `npm run capturas`, se o script cobrir abas; senão, captura manual).

- [ ] **Step 1:** Atualizar versão, cache e README.
- [ ] **Step 2:** `npm test` → tudo passa; anotar o total de testes.
- [ ] **Step 3:** `git push -u origin agente`. A Vercel gera a prévia `https://genfin-git-agente-prodt.vercel.app` (pede login da Vercel). **Atenção:** a prévia não tem `GROQ_API_KEY` (só Production). Antes, pedir ao usuário que habilite a variável também em Preview no painel da Vercel, ou testar a IA só depois do merge.
- [ ] **Step 4:** Pedir ao usuário que teste no celular: resumo do dia, "Como estão as ações?", "Vou aportar R$ X", "Algo para vender?", um ticker citado, "por quê?" e o botão Comprar. Conferir nos logs (`vercel logs`) o tamanho dos pedidos ao Groq.
- [ ] **Step 5:** Com o ok do usuário: merge na main (fast-forward), push, apagar a branch `agente` no GitHub. Commit da versão: "GenFin 2.0.0: aba Agente".
