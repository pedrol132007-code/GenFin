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

const tickerBase = t => /^[A-Z0-9]{4}\d{1,2}F$/.test(String(t)) ? String(t).slice(0, -1) : String(t);

module.exports = { numBR, lerTabelaFundamentus, lerTabelaFII, lerDetalhe, lerPrecos, lerFocus, dyPorAno, tickerBase };
