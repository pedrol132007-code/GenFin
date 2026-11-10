// Proventos anunciados de um ativo (dividendos, JCP e rendimentos), lidos do site público da B3.
// O navegador não lê a B3 direto, por causa do CORS. Um ativo por pedido, com cache de 6 horas na CDN da Vercel.
// Recebe só o código do ativo; devolve valor por ação/cota, data com e data de pagamento. Nada é guardado aqui.
const ORIGENS = ["https://genfin-rose.vercel.app", "https://localhost", "http://localhost", "capacitor://localhost", "null"];
const B3 = "https://sistemaswebb3-listados.b3.com.br/";
const DIAS = 150, MAX_ITENS = 24;

// A B3 recebe os parâmetros como JSON em base64 no caminho
const urlB3 = (caminho, params) => B3 + caminho + "/" + Buffer.from(JSON.stringify(params)).toString("base64");
async function lerB3(caminho, params) {
  const r = await fetch(urlB3(caminho, params), { headers: { "User-Agent": "Mozilla/5.0 (GenFin)" }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error("b3 " + r.status);
  const txt = await r.text();
  if (!txt.trim()) return null;   // ativo desconhecido volta vazio
  const j = JSON.parse(txt);
  return typeof j === "string" ? JSON.parse(j) : j;   // dependendo do Accept, a B3 manda o JSON dentro de uma string
}

const isoDe = s => { const m = /^(\d\d)\/(\d\d)\/(\d{4})$/.exec(String(s || "").trim()); return m && m[3] < "9000" ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const tipoDe = rotulo => { const r = String(rotulo || "").toUpperCase(); return /JRS|JUROS/.test(r) ? "jcp" : /DIVIDEND/.test(r) ? "dividendo" : /RENDIMENTO/.test(r) ? "rendimento" : "outro"; };

// Só o que ainda vai ser pago ou foi pago há pouco (para o app sugerir o registro), do mais novo para o mais antigo.
// O agente pede o histórico inteiro: {dias: Infinity, max: Infinity}.
function lerProventos(lista, aceita, agora = Date.now(), { dias = DIAS, max = MAX_ITENS } = {}) {
  const limite = dias === Infinity ? "" : new Date(agora - dias * 864e5).toISOString().slice(0, 10), vistos = new Set(), itens = [];
  for (const d of Array.isArray(lista) ? lista : []) {
    if (!aceita(String(d.isinCode || d.assetIssued || ""))) continue;
    const valor = Number(String(d.rate || "").replace(/\./g, "").replace(",", "."));
    const dataCom = isoDe(d.lastDatePrior), pagamento = isoDe(d.paymentDate);
    if (!(valor > 0) || !dataCom || (pagamento || dataCom) < limite) continue;
    const item = { tipo: tipoDe(d.label), valor, dataCom, pagamento, ref: String(d.relatedTo || "").slice(0, 40) };
    const chave = [item.tipo, valor, dataCom, pagamento].join("|");
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    itens.push(item);
  }
  return itens.sort((a, b) => (b.pagamento || b.dataCom).localeCompare(a.pagamento || a.dataCom)).slice(0, max);
}

// Lista crua da B3 e o filtro de ISIN do ativo: ação pelo detalhe da empresa, FII só pelas cotas (CTF)
async function listaB3(t, classe) {
  if (classe === "fii") {
    const fundo = await lerB3("fundsProxy/fundsCall/GetListedSupplementFunds", { cnpj: "0", identifierFund: t.slice(0, 4), typeFund: 7 });
    // Só as cotas (ISIN com CTF); recibos de subscrição ficam de fora
    return fundo ? { lista: fundo.cashDividends, aceita: i => /^BR[A-Z0-9]{4}CTF/.test(i) } : null;
  }
  const sup = await lerB3("listedCompaniesProxy/CompanyCall/GetListedSupplementCompany", { issuingCompany: t.slice(0, 4), language: "pt-br" });
  const emp = Array.isArray(sup) ? sup[0] : null;
  if (!emp || !emp.codeCVM) return null;
  // A empresa lista os proventos por ISIN; o detalhe diz qual ISIN é ITSA3, ITSA4 ou a unit
  const det = await lerB3("listedCompaniesProxy/CompanyCall/GetDetail", { codeCVM: String(emp.codeCVM), language: "pt-br" });
  const isin = ((det && det.otherCodes) || []).find(o => String(o.code).toUpperCase() === t);
  return isin ? { lista: emp.cashDividends, aceita: i => i === isin.isin } : null;
}
// Proventos recentes e a receber (rota /api/proventos)
async function recentes(t, classe) { const b = await listaB3(t, classe); return b ? lerProventos(b.lista, b.aceita) : []; }
// Histórico inteiro, para o agente calcular o DY de cada ano
async function cashDividends(t, classe) { const b = await listaB3(t, classe); return b ? lerProventos(b.lista, b.aceita, Date.now(), { dias: Infinity, max: Infinity }) : []; }

module.exports = async (req, res) => {
  const origem = req.headers.origin || "";
  if (ORIGENS.includes(origem) || /^https:\/\/genfin-[a-z0-9-]+\.vercel\.app$/.test(origem)) {
    res.setHeader("Access-Control-Allow-Origin", origem);
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ erro: "metodo" });

  const t = String((req.query && req.query.t) || "").trim().toUpperCase(), classe = String((req.query && req.query.c) || "");
  if (!/^[A-Z]{4}\d{1,2}$/.test(t) || !["acao", "fii"].includes(classe)) return res.status(400).json({ erro: "ativo" });
  try {
    const itens = await recentes(t, classe);
    res.setHeader("Cache-Control", "public, s-maxage=21600, stale-while-revalidate=86400");
    return res.status(200).json({ itens });
  } catch (e) {
    return res.status(502).json({ erro: "servico" });
  }
};
module.exports.lerProventos = lerProventos;
module.exports.cashDividends = cashDividends;
