// Dados de mercado para o agente: leitura das fontes públicas, triagem de candidatos e busca com cache.
// O nome começa com "_" para a Vercel não publicar este arquivo como função: só api/agente.js o usa.
// Fontes: Fundamentus (indicadores de ações e FIIs, setor), Yahoo (preços), B3 (proventos) e Focus do Banco Central.

// "1.234,56" → 1234.56; "12,3%" → 0.123; vazio ou "-" → null
function numBR(s) {
  const t = String(s ?? "").replace(/<[^>]*>/g, "").trim();
  if (!t || t === "-") return null;
  const pct = t.endsWith("%"), n = Number(t.replace(/%$/, "").replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? (pct ? n / 100 : n) : null;
}
const semTags = s => String(s).replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

// Tabela do Fundamentus: colunas lidas pelo cabeçalho, para não depender da posição
function lerTabela(html, campos) {
  const tab = /<table[^>]*>([\s\S]*?)<\/table>/i.exec(String(html || ""));
  if (!tab) return [];
  const cab = [...tab[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map(x => semTags(x[1]));
  const idx = Object.fromEntries(Object.entries(campos).map(([k, nome]) => [k, cab.indexOf(nome)]));
  if (idx.ticker < 0) return [];
  const corpo = tab[1].slice(tab[1].search(/<tbody/i) >= 0 ? tab[1].search(/<tbody/i) : 0);
  const linhas = [];
  for (const tr of corpo.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const tds = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(x => x[1]);
    if (tds.length < cab.length - 1) continue;
    const o = {};
    for (const [k, i] of Object.entries(idx)) o[k] = i < 0 ? null : (k === "ticker" || k === "segmento") ? semTags(tds[i] || "") : numBR(tds[i]);
    if (/^[A-Z0-9]{4}\d{1,2}$/.test(o.ticker)) linhas.push(o);
  }
  return linhas;
}
const CAMPOS_ACAO = { ticker: "Papel", cotacao: "Cotação", pl: "P/L", pvp: "P/VP", dy: "Div.Yield", evEbit: "EV/EBIT", margemLiq: "Mrg. Líq.",
  roic: "ROIC", roe: "ROE", liq2m: "Liq.2meses", divLiqPatrim: "Dív.Líq/ Patrim.", crescRec5a: "Cresc. Rec.5a" };
const CAMPOS_FII = { ticker: "Papel", segmento: "Segmento", cotacao: "Cotação", ffoYield: "FFO Yield", dy: "Dividend Yield", pvp: "P/VP",
  valorMercado: "Valor de Mercado", liquidez: "Liquidez", qtdImoveis: "Qtd de imóveis", capRate: "Cap Rate", vacancia: "Vacância Média" };
const lerTabelaFundamentus = html => lerTabela(html, CAMPOS_ACAO);
const lerTabelaFII = html => lerTabela(html, CAMPOS_FII);

// Página de detalhe: o valor vem na célula seguinte ao rótulo
function campoDetalhe(html, rotulo) {
  const re = new RegExp(`<span class="txt">${rotulo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</span></td>\\s*<td[^>]*>([\\s\\S]*?)</td>`);
  const x = re.exec(String(html || ""));
  return x ? semTags(x[1]) : null;
}
function lerDetalhe(html) {
  return { setor: campoDetalhe(html, "Setor"), subsetor: campoDetalhe(html, "Subsetor"),
    max52: numBR(campoDetalhe(html, "Max 52 sem")), min52: numBR(campoDetalhe(html, "Min 52 sem")) };
}

// Yahoo: preço atual, faixa de 52 semanas e fechamento de cada mês (AAAA-MM no fuso da bolsa)
function lerPrecos(json) {
  const r = json && json.chart && Array.isArray(json.chart.result) ? json.chart.result[0] : null;
  if (!r) return { preco: null, max52: null, min52: null, mensal: [] };
  const meta = r.meta || {}, ts = r.timestamp || [], fech = (((r.indicators || {}).quote || [])[0] || {}).close || [];
  const off = Number(meta.gmtoffset) || 0, mensal = [];
  ts.forEach((t, i) => {
    if (!(fech[i] > 0)) return;
    const d = new Date((t + off) * 1000), mes = d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
    if (mensal.length && mensal[mensal.length - 1].mes === mes) mensal[mensal.length - 1].fech = fech[i];
    else mensal.push({ mes, fech: fech[i] });
  });
  return { preco: meta.regularMarketPrice ?? null, max52: meta.fiftyTwoWeekHigh ?? null, min52: meta.fiftyTwoWeekLow ?? null, mensal };
}

// Focus: mediana mais recente de cada indicador e ano
function lerFocus(json) {
  const out = { selic: {}, ipca: {} }, quando = {};
  for (const v of (json && Array.isArray(json.value) ? json.value : [])) {
    const k = String(v.Indicador || "").toLowerCase(), ano = Number(v.DataReferencia);
    if (!out[k] || !ano || !Number.isFinite(v.Mediana)) continue;
    const id = k + ano;
    if (!quando[id] || v.Data > quando[id]) { quando[id] = v.Data; out[k][ano] = v.Mediana; }
  }
  return out;
}

// DY de cada ano: proventos com data com no ano ÷ média dos fechamentos mensais do ano (anos com ≥ 6 meses de preço)
function dyPorAno(proventos, mensal) {
  const precos = {}, provs = {};
  for (const p of mensal || []) (precos[p.mes.slice(0, 4)] ||= []).push(p.fech);
  for (const p of proventos || []) { const a = String(p.dataCom || "").slice(0, 4); if (p.valor > 0) provs[a] = (provs[a] || 0) + p.valor; }
  return Object.keys(precos).filter(a => precos[a].length >= 6 && provs[a]).sort()
    .map(a => ({ ano: Number(a), dy: provs[a] / (precos[a].reduce((s, v) => s + v, 0) / precos[a].length) }));
}

/* Triagem: candidatos para o perfil "patrimônio no longo prazo + renda".
   Filtros de sanidade (fora disso o número costuma enganar):
   - ações: liquidez de 2 meses ≥ R$ 1 mi/dia, P/L entre 0 e 25, P/VP > 0, ROE > 0, DY ≤ 20% (acima disso é provento extraordinário);
   - FIIs: liquidez ≥ R$ 500 mil/dia, P/VP entre 0,7 e 1,3, DY entre 0 e 16% (DY muito alto com P/VP baixo costuma ser fundo em apuros).
   Nota: média dos percentis dentro do grupo filtrado. Ações: lucro barato (1/P/L), ROE, DY, crescimento de receita em 5 anos e
   dívida baixa. FIIs: DY, desconto (1/P/VP) e vacância baixa. Nos dois, liquidez também conta: no longo prazo, empresa e fundo
   grandes e muito negociados tendem a ser mais estáveis. */
const FILTROS = {
  acao: a => a.liq2m >= 1e6 && a.pl > 0 && a.pl <= 25 && a.pvp > 0 && a.roe > 0 && a.dy != null && a.dy <= 0.20,
  fii: f => f.liquidez >= 5e5 && f.pvp >= 0.7 && f.pvp <= 1.3 && f.dy > 0 && f.dy <= 0.16
};
const CRITERIOS = {
  acao: [a => 1 / a.pl, a => a.roe, a => a.dy, a => a.crescRec5a, a => a.divLiqPatrim == null ? null : -a.divLiqPatrim, a => Math.log10(a.liq2m)],
  fii: [f => f.dy, f => 1 / f.pvp, f => f.vacancia == null ? null : -f.vacancia, f => Math.log10(f.liquidez)]
};
const fmtN = v => Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
const fmtP = v => fmtN(v * 100) + "%";
const MOTIVOS = {
  acao: a => [`P/L ${fmtN(a.pl)}`, `ROE ${fmtP(a.roe)}`, `DY ${fmtP(a.dy)}`],
  fii: f => [`DY ${fmtP(f.dy)}`, `P/VP ${fmtN(f.pvp)}`, ...(f.segmento ? [f.segmento] : [])]
};
// Percentil de cada valor no grupo (0 = pior, 1 = melhor); valor ausente fica no meio
function percentis(vals) {
  const ok = vals.filter(v => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  return vals.map(v => {
    if (v == null || !Number.isFinite(v) || ok.length < 2) return ok.length < 2 && v != null ? 1 : 0.5;
    const menores = ok.filter(x => x < v).length, iguais = ok.filter(x => x === v).length;
    return (menores + (iguais - 1) / 2) / (ok.length - 1);
  });
}
function triagem(lista, classe, { excluir = [], n = 10 } = {}) {
  const fora = new Set(excluir.map(tickerBase));
  const grupo = (lista || []).filter(x => FILTROS[classe](x) && !fora.has(x.ticker));
  if (!grupo.length) return [];
  const cols = CRITERIOS[classe].map(f => percentis(grupo.map(f)));
  return grupo.map((x, i) => ({ ...x, nota: cols.reduce((s, c) => s + c[i], 0) / cols.length, motivos: MOTIVOS[classe](x) }))
    .sort((a, b) => b.nota - a.nota).slice(0, n);
}

const tickerBase = t => /^[A-Z0-9]{4}\d{1,2}F$/.test(String(t)) ? String(t).slice(0, -1) : String(t);

module.exports = { numBR, lerTabelaFundamentus, lerTabelaFII, lerDetalhe, lerPrecos, lerFocus, dyPorAno, triagem, tickerBase };
