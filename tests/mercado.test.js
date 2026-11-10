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

  console.log(falhas ? `\n${falhas} teste(s) falharam` : "\nmercado: todos os testes passaram");
  process.exit(falhas ? 1 : 0);
})();
