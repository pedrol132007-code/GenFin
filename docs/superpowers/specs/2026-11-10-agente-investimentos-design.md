# Agente de investimentos: design

Data: 2026-11-10 · Projeto: GenFin (`carteira.html` + funções em `api/` na Vercel)

## Intenção

O usuário quer um "assessor" dentro do app: uma aba onde ele conversa com a IA e recebe **sugestões concretas de ativos**:
comprar mais, considerar vender, ou começar a ter um ativo novo. Hoje o app para um passo antes: a aba Rebalancear divide
o aporte **por classe**, e a IA tem regra explícita para **não** citar ativos. O agente dá o passo seguinte.

Nas palavras do usuário: "só quero sugestões com bases matemáticas", "sei que não é nenhum corretor pessoal, é só pra me
ajudar". Perguntas típicas: "como estão as ações, tem algo que sugere comprar?", "vou fazer meu aporte, tem sugestões?".

**Perfil do investidor** (dito pelo usuário): longo prazo, dinheiro sem urgência, quer construir patrimônio **e** ter renda
("multiplicar o que eu ganho"). Usa a XP e opera algumas vezes por mês. Aprovou esta leitura do perfil:
- mistura crescimento (empresas boas e baratas: lucro crescendo, ROE alto, dívida controlada, P/L razoável) com renda
  (boas pagadoras e FIIs), sem perseguir o maior dividendo do momento;
- reinvestir proventos é a regra (o agente lembra);
- vender é exceção: só quando o fundamento piorou (lucro caiu, dívida explodiu, cortou dividendos) ou ficou caro demais
  perto do próprio histórico, e sempre com a conta do imposto (isenção de R$ 20 mil/mês em ações);
- aceita mais risco (ações e FIIs) mas respeita as metas da aba Rebalancear;
- aponta concentração e setores ausentes.
O perfil fica num texto editável na configuração do agente, com esse conteúdo como padrão.

## Objetivos

1. Aba **Agente** com conversa contínua (modelo "conversa primeiro", escolhido pelo usuário entre três rascunhos).
2. Sugestões de **compra, venda e ativos novos** (ações e FIIs fora da carteira), sempre apoiadas em números reais
   buscados de fontes de mercado, nunca em "opinião" do modelo.
3. Cada sugestão mostra **por quê**: os números usados (P/L, DY, P/VP, ROE, distância do preço médio, posição na faixa
   histórica, efeito nas metas, imposto).
4. **Avisos do dia** dentro do app: ao abrir a aba, a primeira mensagem do agente traz até ~3 avisos curtos.
5. Plano de aporte: "vou aportar R$ X" → lista de compra (ativo, quantidade, valor) com botão **Comprar** por linha que
   abre a folha de compra existente (`#dlg-op`) já preenchida.

## Não objetivos

- **Notificações** (push ou locais com o app fechado). O usuário escolheu só avisos dentro do app. Nada da carteira é
  guardado no servidor por causa do agente.
- Treinar ou fazer fine-tuning de modelo.
- Previsão de preço, análise gráfica, day trade.
- Nota de corretagem e taxas (descartado em 2026-11-10; não reabrir).
- Executar ordens na corretora. O agente só sugere; registrar no app continua sendo um toque do usuário.

## Anti-objetivos (falharia mesmo funcionando)

- Sugestão sem número por trás, ou com número **inventado** pelo modelo. O usuário confia no agente porque ele mostra as
  contas.
- Citar ticker que não existe ou que não veio das fontes (o modelo só pode escolher entre candidatos que o código
  entregou; ver "Proteções").
- Estourar o limite do Groq gratuito a ponto de a aba virar "tente mais tarde" no uso normal.
- Empurrar giro: sugerir vender por oscilação de curto prazo contradiz o perfil.

## Restrições

- **Tudo grátis**, sem licença da empresa: Vercel (plano Hobby) + Groq (chave `GROQ_API_KEY` já na Vercel, Production).
  Modelo atual: `openai/gpt-oss-120b`, escolhido em `escolherModelo()` de `api/resumo.js`.
- **Limite do Groq gratuito:** ~30 req/min, 1 000 req/dia, **8 000 tokens/minuto**, 200 000 tokens/dia. O de tokens por minuto
  é o mais apertado. O trabalho pesado (filtrar, ranquear, calcular) fica no código, e a IA recebe resumos enxutos
  (ordem de 10 candidatos com seus números), nunca tabelas inteiras. Se um dia não bastar, o Gemini gratuito é a saída
  (não implementar agora).
- Privacidade atual: a sincronização é cifrada, o servidor não lê a carteira, e a IA recebe **percentuais, códigos e
  leituras, sem valores em reais** (`dadosParaIA()`, `limpar()` em `api/resumo.js`). O agente mantém esse princípio:
  valores em reais e quantidades são calculados **no aparelho**; o servidor recebe o retrato da carteira em percentuais
  só durante o pedido e não guarda nada.
- App em arquivo único (`carteira.html`, ~3 100 linhas, JS sem framework), funções CommonJS em `api/*.js` com lista de
  origens CORS `ORIGENS` (inclui `"null"` para o arquivo aberto do disco) e testes em `tests/*.test.js` (`npm test`, 283
  passando). Seguir os mesmos padrões.
- Texto do app em português do Brasil, visual sóbrio, mesmas cores (`--ink #16232B` etc.).

## Fontes de dados (testadas em 2026-11-10 a partir da Vercel: todas responderam)

| Fonte | Endereço | Para quê |
|---|---|---|
| Fundamentus, ações | `https://www.fundamentus.com.br/resultado.php` (HTML, ~990 linhas) | P/L, P/VP, PSR, DY, EV/EBIT, margens, ROIC, ROE, liquidez 2 meses, dív. bruta/patrim., cresc. receita 5a. Universo para ativos novos. |
| Fundamentus, FIIs | `https://www.fundamentus.com.br/fii_resultado.php` (~570 linhas) | segmento, FFO yield, DY, P/VP, valor de mercado, liquidez, cap rate, vacância |
| Fundamentus, detalhe | `https://www.fundamentus.com.br/detalhes.php?papel=XXXX` | setor/subsetor (diversificação: "você não tem nenhum banco") |
| Yahoo, preços | `https://query1.finance.yahoo.com/v8/finance/chart/{TICKER}.SA?range=5y&interval=1mo` | preço atual, máx./mín. 52 semanas, histórico de 5 anos |
| B3, proventos | mesma base de `api/proventos.js` (`GetListedSupplementCompany` → `cashDividends`; FIIs por `fundsProxy`) | histórico de proventos → DY de cada ano |
| BCB Focus | `olinda.bcb.gov.br/.../ExpectativasMercadoAnuais` (OData, JSON) | Selic e IPCA esperados, para "vale mais que a renda fixa?" |
| Já no app | CDI/IPCA (séries BCB 12 e 433), cotações (brapi com a chave do usuário), notícias (`api/noticias.js`), proventos anunciados (`api/proventos.js`) | — |

Todas exigem `User-Agent` de navegador e não têm CORS, então são lidas por funções na Vercel.
**Status Invest foi descartado:** responde com página anti-robô (Cloudflare) ao `fetch` do Node. Não tentar contornar.
O "histórico do indicador" sai das fontes abertas: DY por ano = proventos da B3 no ano ÷ preço médio do ano (Yahoo).
P/L histórico fica fora desta versão.

## Como funciona (decidido com o usuário)

**Aba e navegação.** Nova aba **Agente** na barra de baixo, no lugar de **Análises**. A barra fica: Resumo · Agente ·
Lançar · Ativos · Mais. Análises passa para a folha "Mais".

**Abertura da aba ("conversa primeiro").** Layout de chat: a primeira mensagem do agente é o **resumo do dia**, com até ~3
avisos (quem caiu ou subiu, quem ficou abaixo do preço médio, provento chegando, ativo novo que vale olhar). Acima da caixa
de texto ficam chips de perguntas prontas ("Como estão as ações?", "Algo para vender?", "Vou aportar…"). Rascunho aprovado:
`.superpowers/brainstorm/136-1794333162/content/aba-agente.html`, opção A (local, fora do git).

**Conversa.** O agente pode buscar dados no meio da resposta (ferramentas abaixo). Respostas de aporte vêm como lista de
compra com botão **Comprar** por linha. Toda sugestão tem um "por quê?" que expande os números.

**Integração com o que existe.** A caixa "Pergunte à sua carteira" do Resumo, os botões ✦ e a folha `#dlg-ia` passam a
levar à aba Agente. Fica uma conversa só no app. A conversa fica salva no aparelho (localStorage, como `conversa` hoje),
com "Nova conversa".

Destino das IAs atuais *(decisões minhas, após a revisão)*:
- **Manchete do Resumo:** deixa de ter chamada própria. Passa a mostrar o primeiro aviso do resumo do dia do agente
  (uma chamada diária só). Tocar nela abre a aba Agente.
- **Resumo por IA em Análises:** continua (sob pedido, raro), com as regras antigas.
- **Modo `pergunta` antigo e a folha `#dlg-ia`:** removidos; a conversa é a do agente. Remover/migrar os testes
  correspondentes.
- **Chave própria do Groq no aparelho:** o agente sempre usa o servidor. A chave própria continua valendo só para o
  resumo de Análises. Se o servidor da IA não estiver disponível, a aba diz isso.

## Arquitetura (proposta; o construtor pode ajustar os detalhes)

**`api/mercado.js`** (sem IA): busca e normaliza as fontes, com cache na CDN (`s-maxage`), por exemplo 6 h para
fundamentos e Focus e 1 h para preços. Funções puras e testáveis: `lerTabelaFundamentus(html)`,
`lerTabelaFII(html)`, `lerSetor(html)`, `lerPrecos(json)`, `dyPorAno(proventos, precos)`. Um **filtro e ranking em código**
(`triagem()`) produz candidatos a partir do universo com filtros de sanidade: liquidez mínima, P/L e P/VP positivos, DY
plausível (descartar DY anômalo, sinal típico de provento extraordinário), e uma nota composta coerente com o perfil
(crescimento + renda).

**`api/agente.js`** (com IA): loop de ferramentas do Groq (formato OpenAI `tools`). Ferramentas, todas executadas no servidor
e devolvendo JSON **enxuto**:
- `fundamentos(tickers[])`: indicadores atuais + setor;
- `historico(ticker)`: posição do preço na faixa de 52 semanas e de 5 anos, DY atual × DY médio dos anos;
- `candidatos(classe, criterio?)`: top N da triagem, excluindo o que já está na carteira;
- `proventos(ticker)` e `noticias(ticker)`: reaproveitar a lógica de `api/proventos.js` e `api/noticias.js`;
- `macro()`: Selic/IPCA do Focus + CDI.
O pedido do app traz: modo (`dia` | `pergunta`), o retrato da carteira em percentuais (mesmo formato de `dadosParaIA()`,
acrescido de preço médio relativo, ou seja, distância % do preço atual ao preço médio), o perfil (texto), a pergunta e um
histórico curto.

**Orçamento de tokens: modelo híbrido** *(decisão minha, após a revisão)*. Um loop livre de ferramentas reenvia tudo a
cada rodada (~3–5k tokens por rodada) e estoura 8k tokens/minuto numa única pergunta. Então:
1. O **código** identifica a intenção da pergunta (aporte, panorama de ações/FIIs, venda, ativo específico citado, aberta)
   por regras simples e **pré-busca** os dados certos, já reduzidos, antes da IA.
2. Uma chamada ao modelo responde com esses dados. As ferramentas ficam disponíveis, mas com **no máximo 1 rodada extra**
   (para um ticker ou critério que o código não previu).
3. Meta: ~6–8k tokens por pergunta → ~25–30 perguntas/dia no gratuito. Só o usuário usa este servidor.
4. Se o Groq devolver 429 (limite), o app mostra quanto esperar (cabeçalho `retry-after`) e não perde a pergunta.
Para o usuário o efeito é o mesmo de "o agente busca os dados"; a diferença é quem decide o que buscar na maioria dos
casos.

**Plano de aporte.** A IA **não** faz contas de dinheiro. Ela devolve, em JSON estruturado, a escolha: `[{ticker,
pct_do_aporte, motivo}]`. O app, no aparelho, converte em quantidades inteiras de cotas com o preço atual, respeitando a
divisão por classe que a aba Rebalancear já calcula (reaproveitar essa lógica), e mostra o que sobra. O valor em reais do
aporte não precisa sair do aparelho.

Regras do plano *(decisões minhas, após a revisão)*:
- A IA escolhe **por classe**: os `pct_do_aporte` vêm dentro da parcela de cada classe que o Rebalancear calculou.
- Ações e FIIs: ativos da carteira ou **novos** (candidatos da triagem).
- ETFs e cripto: só **reforço dos que o usuário já tem** (nada novo nessas classes).
- Renda fixa: o app mostra uma linha "Renda fixa: R$ X, escolha o título" com a comparação ao CDI/Focus. Sem sugestão de título.
- **Sem metas que somem 100%:** o agente avisa que as metas deixam o plano mais certeiro, com um botão para Rebalancear,
  e ainda assim monta o plano só com ações e FIIs, dividido pelo perfil (IA escolhe os pesos entre as duas classes).

**Venda e imposto** *(decisão minha)*: a conta do imposto é feita **no aparelho**, não pela IA. A IA marca sugestões de
venda em saída estruturada (`[{ticker, acao:"vender"|"reduzir", motivo}]`) e o app anexa, com os dados locais (preço médio,
quantidade, vendas do mês, prejuízo a compensar), "vendendo tudo agora: R$ Y de IR" ou "isento: vendas do mês ficam
abaixo de R$ 20 mil". O princípio de não mandar reais ao servidor fica intacto.

**Resumo do dia.** Gerado no máximo 1× por dia por carteira (mesmo padrão da manchete atual: cache local com data) e
regerado sob pedido.

**Proteções.**
- Instruções novas para o agente (a regra atual "não recomende ativos específicos" **não** vale para ele, mas continua
  valendo nos modos antigos, enquanto existirem). Ele pode sugerir, mas só com números vindos das ferramentas ou do
  retrato. Sem previsão de preço. Toda sugestão cita os números.
- **Validação em código** da saída: ticker sugerido precisa ter vindo das ferramentas ou da carteira, senão a linha é
  descartada; percentuais do aporte são normalizados para somar 100.
- Cada sugestão vem marcada com a data dos dados.
- Uma frase fixa e discreta na aba: "Sugestões automáticas a partir de números públicos; a decisão é sua."
- Fora do tema → mesma recusa curta que existe hoje.

## Deixado para o construtor

- Fórmula exata da nota da triagem e limiares (liquidez mínima, faixas de P/L/DY), desde que coerentes com o perfil e
  documentados no código.
- Esquema exato das ferramentas e do JSON de saída; `max_tokens` e `reasoning_effort` (lembrar: gpt-oss precisa
  `reasoning_effort: "low"` e folga de tokens, senão volta vazio com `finish_reason: length`).
- Parsing do HTML do Fundamentus (números no formato BR, `%`, colunas por cabeçalho e não por posição).
- Visual fino da aba, dentro do estilo atual.
- Versão: subir para 2.0.0 (aba nova muda a navegação). *(decisão minha)*
- Escopo de "ativos novos": **ações e FIIs**. ETFs, cripto e títulos específicos de renda fixa ficam fora das sugestões
  de ativo novo; renda fixa entra só como comparação ("isso rende mais que o CDI esperado?"). *(decisão minha)*
- Testes: unitários para os leitores das fontes (com HTML e JSON de exemplo salvos em `tests/`), para a triagem, para a
  validação da saída da IA e para a conversão pct → cotas. Sem rede nos testes.
