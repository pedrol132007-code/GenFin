// Manchetes do Google Notícias para um ativo da carteira (o navegador não lê o RSS direto, por causa do CORS).
// Um ativo por pedido, com cache de 30 minutos na CDN da Vercel: cada ativo vai ao Google no máximo duas vezes por hora.
// Devolve só título, fonte, data e o link do Google Notícias; nada é guardado aqui.
const ORIGENS = ["https://genfin-rose.vercel.app", "https://localhost", "http://localhost", "capacitor://localhost", "null"];
const MAX_ITENS = 8, DIAS = 30;

const ENTIDADES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decodificar = s => String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENTIDADES[e.toLowerCase()] ?? m))
  .replace(/\s+/g, " ").trim();
const campo = (item, tag) => { const m = item.match(new RegExp("<" + tag + "\\b[^>]*>([\\s\\S]*?)</" + tag + ">")); return m ? decodificar(m[1]) : ""; };

function lerRSS(xml, agora = Date.now()) {
  const limite = agora - DIAS * 864e5, vistos = new Set(), itens = [];
  for (const [, item] of String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const fonte = campo(item, "source"), link = campo(item, "link"), data = Date.parse(campo(item, "pubDate"));
    let titulo = campo(item, "title");
    if (fonte && titulo.endsWith(" - " + fonte)) titulo = titulo.slice(0, -(fonte.length + 3)).trim();   // o Google repete a fonte no título
    if (!titulo || !/^https:\/\/news\.google\.com\//.test(link) || !Number.isFinite(data) || data < limite) continue;
    const chave = titulo.toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    itens.push({ titulo: titulo.slice(0, 240), fonte: fonte.slice(0, 80), link, data: new Date(data).toISOString() });
  }
  return itens.sort((a, b) => b.data.localeCompare(a.data)).slice(0, MAX_ITENS);
}

const urlRSS = q => "https://news.google.com/rss/search?q=" + encodeURIComponent(q) + "&hl=pt-BR&gl=BR&ceid=BR:pt-419";
// Para o agente: as n manchetes mais recentes de um ativo (lança erro se o Google não responder)
async function manchetes(q, n = 3) {
  const r = await fetch(urlRSS(q), { headers: { "User-Agent": "Mozilla/5.0 (GenFin)" }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error("fonte:noticias");
  return lerRSS(await r.text()).slice(0, n).map(({ titulo, fonte, data }) => ({ titulo, fonte, data }));
}

module.exports = async (req, res) => {
  const origem = req.headers.origin || "";
  if (ORIGENS.includes(origem) || /^https:\/\/genfin-[a-z0-9-]+\.vercel\.app$/.test(origem)) {
    res.setHeader("Access-Control-Allow-Origin", origem);
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ erro: "metodo" });

  const q = String((req.query && req.query.q) || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9 .-]{1,39}$/.test(q)) return res.status(400).json({ erro: "busca" });
  const url = urlRSS(q);
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (GenFin)" }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return res.status(502).json({ erro: "servico" });
    res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=3600");
    return res.status(200).json({ itens: lerRSS(await r.text()) });
  } catch (e) {
    return res.status(502).json({ erro: "servico" });
  }
};
module.exports.lerRSS = lerRSS;
module.exports.manchetes = manchetes;
