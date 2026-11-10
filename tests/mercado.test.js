// Testes do módulo de mercado do agente (api/_mercado.js): leitores das fontes, triagem e busca com cache.
// Uso: npm test (roda junto com os outros). Sem rede: fixtures em tests/fixtures e fetch simulado.
const fs = require("fs");
let falhas = 0; const ok = (c, m) => { if (!c) { falhas++; console.log("FALHOU:", m); } else console.log("ok:", m); };
const m = require("../api/_mercado.js");
const fx = n => fs.readFileSync(__dirname + "/fixtures/" + n);
const lat = b => new TextDecoder("latin1").decode(b);

(async () => {
  // Leitores
  ok(m.numBR("1.234,56") === 1234.56 && Math.abs(m.numBR("12,3%") - 0.123) < 1e-12 && m.numBR("") === null && m.numBR("-") === null, "numBR lê formato brasileiro");
  const acoes = m.lerTabelaFundamentus(lat(fx("fundamentus-acoes.html")));
  const bb = acoes.find(a => a.ticker === "BBAS3");
  ok(bb && bb.cotacao === 17.02 && bb.pl > 0 && bb.dy > 0 && bb.dy < 1 && bb.liq2m > 1e6, "BBAS3 com cotação, P/L, DY em fração e liquidez");
  ok(acoes.length === 6 && acoes.every(a => "crescRec5a" in a && "divLiqPatrim" in a), "todas as linhas com os campos esperados");
  ok(m.lerTabelaFundamentus("<html>mudou</html>").length === 0, "HTML sem a tabela devolve lista vazia, sem erro");
  const fii = m.lerTabelaFII(lat(fx("fundamentus-fii.html"))).find(f => f.ticker === "MXRF11");
  ok(fii && fii.segmento && fii.pvp > 0 && fii.dy > 0 && fii.dy < 1, "MXRF11 com segmento, P/VP e DY");
  const det = m.lerDetalhe(lat(fx("fundamentus-detalhe.html")));
  ok(det.setor === "Intermediários Financeiros" && det.subsetor === "Bancos" && det.max52 === 27.21 && det.min52 === 16.19, "setor, subsetor e faixa de 52 semanas do BBAS3");
  const pr = m.lerPrecos(JSON.parse(fx("yahoo-petr4.json")));
  ok(pr.preco > 0 && pr.max52 >= pr.min52 && pr.mensal.length >= 50 && /^\d{4}-\d\d$/.test(pr.mensal[0].mes), "5 anos de preços mensais");
  ok(m.lerPrecos({}).mensal.length === 0, "resposta sem gráfico não quebra");
  const focus = m.lerFocus(JSON.parse(fx("focus.json")));
  ok(focus.selic[2027] === 12.5 && focus.ipca[2026] === 5.2195, "Focus: mediana mais recente de Selic e IPCA por ano");
  const dy = m.dyPorAno([{ valor: 1, dataCom: "2024-03-10" }, { valor: 1, dataCom: "2024-09-10" }],
    Array.from({ length: 12 }, (_, i) => ({ mes: "2024-" + String(i + 1).padStart(2, "0"), fech: 20 })));
  ok(dy.length === 1 && dy[0].ano === 2024 && Math.abs(dy[0].dy - 0.1) < 1e-9, "DY do ano = proventos ÷ preço médio");
  ok(m.dyPorAno([{ valor: 1, dataCom: "2024-03-10" }], [{ mes: "2024-01", fech: 20 }]).length === 0, "ano com menos de 6 meses de preço fica de fora");
  ok(m.tickerBase("ITSA4F") === "ITSA4" && m.tickerBase("MXRF11") === "MXRF11", "fracionário vira o lote");

  // Triagem
  const base = { cotacao: 10, pvp: 1, evEbit: 5, margemLiq: .1, roic: .1, divLiqPatrim: .5, crescRec5a: .1 };
  const lista = [
    { ...base, ticker: "BOA3", pl: 5, roe: .25, dy: .09, liq2m: 5e6 },
    { ...base, ticker: "MEIA3", pl: 12, roe: .12, dy: .05, liq2m: 5e6 },
    { ...base, ticker: "ILIQ3", pl: 4, roe: .30, dy: .10, liq2m: 1e4 },
    { ...base, ticker: "PREJ3", pl: -3, roe: -.1, dy: 0, liq2m: 5e6 },
    { ...base, ticker: "XTRA3", pl: 6, roe: .2, dy: .45, liq2m: 5e6 }];
  const t = m.triagem(lista, "acao");
  ok(t[0].ticker === "BOA3" && t.length === 2, "melhor primeiro; ilíquida, com prejuízo e DY anômalo ficam fora");
  ok(m.triagem(lista, "acao", { excluir: ["BOA3"] })[0].ticker === "MEIA3", "exclui o que já está na carteira");
  ok(t[0].motivos.some(s => /P\/L 5/.test(s)) && t[0].nota >= 0 && t[0].nota <= 1, "motivos citam os números e a nota vai de 0 a 1");
  const fiis = [
    { ticker: "BOM11", segmento: "Logística", dy: .11, pvp: .85, vacancia: .02, liquidez: 2e6 },
    { ticker: "CARO11", segmento: "Logística", dy: .07, pvp: 1.25, vacancia: .10, liquidez: 2e6 },
    { ticker: "PEQ11", segmento: "Lajes", dy: .12, pvp: .8, vacancia: 0, liquidez: 1e5 },
    { ticker: "PAGA11", segmento: "Papel", dy: .30, pvp: .9, vacancia: 0, liquidez: 2e6 }];
  const tf = m.triagem(fiis, "fii", { n: 1 });
  ok(tf.length === 1 && tf[0].ticker === "BOM11", "FIIs: DY alto, P/VP baixo e vacância baixa primeiro; n limita a lista");
  const armadilha = m.triagem([...fiis, { ticker: "RISCO11", segmento: "Outros", dy: .18, pvp: .6, vacancia: 0, liquidez: 2e6 }], "fii");
  ok(!armadilha.some(f => f.ticker === "RISCO11"), "FII com DY de 18% e P/VP 0,6 (fundo em apuros) fica fora");
  const grandes = m.triagem([{ ...base, ticker: "MICRO3", pl: 8, roe: .15, dy: .06, liq2m: 2e6 }, { ...base, ticker: "GRANDE3", pl: 8, roe: .15, dy: .06, liq2m: 2e8 }], "acao");
  ok(grandes[0].ticker === "GRANDE3", "com o resto igual, a mais negociada vem primeiro");

  console.log(falhas ? `\n${falhas} teste(s) falharam` : "\nmercado: todos os testes passaram");
  process.exit(falhas ? 1 : 0);
})();
