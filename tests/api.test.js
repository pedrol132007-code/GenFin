// Testes da função da Vercel api/resumo.js, com o Groq simulado.
// Uso: npm test (roda junto com os testes do app)
const path = require("path");
let falhas = 0; const ok = (c, m) => { if (!c) { falhas++; console.log("FALHOU:", m); } else console.log("ok:", m); };

function carregar() { delete require.cache[require.resolve("../api/resumo.js")]; return require("../api/resumo.js"); }
function chamar(fn, {method = "POST", origin = "https://genfin-rose.vercel.app", body} = {}) {
  return new Promise(resolve => {
    const res = { headers: {}, statusCode: 200,
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      status(c) { this.statusCode = c; return this; },
      json(o) { this.body = o; resolve(this); return this; },
      end() { resolve(this); return this; } };
    fn({ method, headers: { origin }, body }, res);
  });
}
const dados = { data: "2026-10-28", classes: [{ classe: "Ações", carteira_pct: 40, meta_pct: 30 }], posicoes: [{ ativo: "PETR4", classe: "Ações", peso_pct: 40, resultado_pct: 12.3 }],
  resultado_sobre_aportado_pct: 8, contra_cdi_pct: -1.2, contra_ibovespa_pct: null, desde: "2026-01-05", leituras: ["PETR4 representa 40% da carteira"] };

(async () => {
  let pedidos = [];
  global.fetch = async (url, op = {}) => {
    pedidos.push({ url, op });
    if (url.endsWith("/models")) return { ok: true, status: 200, json: async () => ({ data: [{ id: "whisper-large-v3" }, { id: "openai/gpt-oss-120b" }] }) };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "- Resumo." } }] }) };
  };

  delete process.env.GROQ_API_KEY;
  let r = await chamar(carregar(), { body: dados });
  ok(r.statusCode === 503 && r.body.erro === "sem_chave" && pedidos.length === 0, "sem GROQ_API_KEY responde 503 sem chamar o Groq");

  process.env.GROQ_API_KEY = "gsk-servidor";
  const fn = carregar();
  r = await chamar(fn, { method: "OPTIONS", origin: "https://localhost" });
  ok(r.statusCode === 204 && r.headers["access-control-allow-origin"] === "https://localhost", "pré-requisição do app Android é aceita");
  r = await chamar(fn, { method: "OPTIONS", origin: "https://site-qualquer.com" });
  ok(!r.headers["access-control-allow-origin"], "outra origem não recebe permissão de CORS");
  r = await chamar(fn, { method: "GET" });
  ok(r.statusCode === 405, "só aceita POST");
  r = await chamar(fn, { body: { pergunta: "me escreva um poema" } });
  ok(r.statusCode === 400 && pedidos.length === 0, "rejeita o que não é o formato da carteira");
  r = await chamar(fn, { body: { ...dados, leituras: ["patrimônio de R$ 100.000"] } });
  ok(r.statusCode === 400 && r.body.erro === "valores_em_reais", "rejeita valores em reais");

  pedidos = [];
  r = await chamar(fn, { body: JSON.stringify({ ...dados, extra: "campo estranho", posicoes: [{ ativo: "PETR4", peso_pct: 40, segredo: "x" }] }) });
  const enviado = JSON.parse(pedidos.find(p => p.url.endsWith("/chat/completions")).op.body);
  ok(r.statusCode === 200 && r.body.texto === "- Resumo." && r.body.modelo === "openai/gpt-oss-120b", "resume e devolve o texto e o modelo");
  ok(enviado.messages[0].role === "system" && /Não recomende comprar ou vender/.test(enviado.messages[0].content), "instrução fixa no servidor");
  ok(!/campo estranho|segredo/.test(enviado.messages[1].content) && pedidos.find(p => p.url.endsWith("/chat/completions")).op.headers.Authorization === "Bearer gsk-servidor", "repassa só os campos esperados, com a chave do servidor");

  global.fetch = async url => url.endsWith("/models") ? { ok: true, status: 200, json: async () => ({ data: [{ id: "openai/gpt-oss-120b" }] }) } : { ok: false, status: 429, json: async () => ({}) };
  r = await chamar(carregar(), { body: dados });
  ok(r.statusCode === 429 && r.body.erro === "limite", "limite do Groq vira 429");
  global.fetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
  r = await chamar(carregar(), { body: dados });
  ok(r.statusCode === 502 && r.body.erro === "chave_invalida", "chave do servidor recusada vira 502");

  // modos manchete e pergunta
  let ultimo = null;
  global.fetch = async (url, op = {}) => {
    if (url.endsWith("/models")) return { ok: true, status: 200, json: async () => ({ data: [{ id: "openai/gpt-oss-120b" }] }) };
    ultimo = JSON.parse(op.body); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "Resposta." } }] }) };
  };
  const fnM = carregar();
  r = await chamar(fnM, { body: { modo: "manchete", dados: { ...dados, evolucao: [{ mes: "2026-09", resultado_pct: 7.25 }], ir: { darf_a_pagar: true, extra: "x" } } } });
  ok(r.statusCode === 200 && /manchete do dia: no máximo 2 frases/.test(ultimo.messages[0].content) && ultimo.max_tokens >= 600 && ultimo.reasoning_effort === "low", "modo manchete: instrução curta, raciocínio curto e folga de tokens (o gpt-oss pensa antes de responder)");
  ok(/"evolucao":\[\{"mes":"2026-09","resultado_pct":7.3\}\]/.test(ultimo.messages[1].content) && /"darf_a_pagar":true/.test(ultimo.messages[1].content) && !/extra/.test(ultimo.messages[1].content), "campos novos passam pela limpeza");
  r = await chamar(fnM, { body: { modo: "pergunta", dados, pergunta: "Por que PETR4 pesa tanto?", historico: [{ p: "Resuma", r: "- Tudo bem." }, { p: "só p" }] } });
  const ms = ultimo.messages;
  ok(r.statusCode === 200 && ms.length === 5 && ms[2].content === "Resuma" && ms[3].role === "assistant" && ms[4].content === "Por que PETR4 pesa tanto?" && /Eu só respondo sobre a sua carteira/.test(ms[0].content), "pergunta leva o histórico válido e a regra de só falar da carteira");
  r = await chamar(fnM, { body: { modo: "pergunta", dados, pergunta: "   " } });
  ok(r.statusCode === 400 && r.body.erro === "pergunta", "pergunta vazia é recusada");
  r = await chamar(fnM, { body: { modo: "qualquer", dados } });
  ok(r.statusCode === 200 && /no máximo 6 tópicos/.test(ultimo.messages[0].content), "modo desconhecido vira resumo");

  // api/noticias.js: lê o RSS do Google Notícias
  const noticias = require("../api/noticias.js");
  const hojeIso = new Date().toUTCString(), velha = new Date(Date.now() - 40 * 864e5).toUTCString();
  const rss = `<rss><channel>
    <item><title>Petrobras (PETR4) anuncia dividendos &amp; JCP - ISTOÉ DINHEIRO</title><link>https://news.google.com/rss/articles/AAA?oc=5</link><pubDate>${hojeIso}</pubDate><source url="https://istoe.com.br">ISTOÉ DINHEIRO</source></item>
    <item><title>Petrobras (PETR4) anuncia dividendos &amp; JCP - Outro Site</title><link>https://news.google.com/rss/articles/BBB?oc=5</link><pubDate>${hojeIso}</pubDate><source>Outro Site</source></item>
    <item><title>Notícia antiga - X</title><link>https://news.google.com/rss/articles/CCC</link><pubDate>${velha}</pubDate><source>X</source></item>
    <item><title>Link estranho - Y</title><link>https://site-malicioso.com/a</link><pubDate>${hojeIso}</pubDate><source>Y</source></item>
  </channel></rss>`;
  const lidos = noticias.lerRSS(rss);
  ok(lidos.length === 1 && lidos[0].titulo === "Petrobras (PETR4) anuncia dividendos & JCP" && lidos[0].fonte === "ISTOÉ DINHEIRO", "RSS: tira a fonte do título, decodifica, tira repetidas e mantém só links do Google dos últimos 30 dias");
  let urlGoogle = null;
  global.fetch = async url => { urlGoogle = url; return { ok: true, status: 200, text: async () => rss }; };
  const chamarGet = (q, origin) => new Promise(resolve => { const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; resolve(this); return this; }, end() { resolve(this); return this; } };
    noticias({ method: "GET", headers: { origin: origin || "https://genfin-rose.vercel.app" }, query: { q } }, res); });
  r = await chamarGet("BTC cripto");
  ok(r.statusCode === 200 && r.body.itens.length === 1 && /q=BTC%20cripto&hl=pt-BR/.test(urlGoogle) && /s-maxage=1800/.test(r.headers["cache-control"]), "notícias: busca no Google Notícias em português, com cache de 30 min");
  r = await chamarGet("<script>");
  ok(r.statusCode === 400, "notícias: busca fora do formato é recusada");
  r = await chamarGet("PETR4", "https://localhost");
  ok(r.headers["access-control-allow-origin"] === "https://localhost", "notícias: app Android pode chamar");

  // api/proventos.js: proventos anunciados na B3 (site público simulado)
  const proventos = require("../api/proventos.js");
  const iso = d => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10), br = d => iso(d).split("-").reverse().join("/");
  const pv = (isin, label, rate, com, paga) => ({ assetIssued: isin, isinCode: isin, label, rate, lastDatePrior: br(com), paymentDate: paga == null ? "" : br(paga), relatedTo: "3º Trimestre", approvedOn: br(com - 5) });
  const itsa = [{ codeCVM: "7617", cashDividends: [
    pv("BRITSAACNPR7", "JRS CAP PROPRIO", "0,02424250000", -10, 20), pv("BRITSAACNOR0", "JRS CAP PROPRIO", "0,02424250000", -10, 20),
    pv("BRITSAACNPR7", "DIVIDENDO", "1.234,50000000000", 5, null), pv("BRITSAACNPR7", "DIVIDENDO", "0,5", -400, -380),
    pv("BRITSAACNPR7", "JRS CAP PROPRIO", "0,02424250000", -10, 20)] }];
  const detalhe = { otherCodes: [{ code: "ITSA3", isin: "BRITSAACNOR0" }, { code: "ITSA4", isin: "BRITSAACNPR7" }] };
  const mxrf = { cashDividends: [pv("BRMXRFCTF008", "RENDIMENTO", "0,09500000000", -4, 13), pv("BRMXRFR27M13", "RENDIMENTO", "0,05", -4, 13)] };
  let urlsB3 = [];
  global.fetch = async url => {
    urlsB3.push(url);
    const params = JSON.parse(Buffer.from(url.split("/").pop(), "base64").toString());
    const corpo = /GetListedSupplementCompany/.test(url) ? (params.issuingCompany === "ITSA" ? itsa : [])
      : /GetDetail/.test(url) ? detalhe : /GetListedSupplementFunds/.test(url) ? (params.identifierFund === "MXRF" ? mxrf : "") : null;
    return { ok: true, status: 200, text: async () => corpo === "" ? "" : JSON.stringify(JSON.stringify(corpo)) };   // a B3 às vezes manda o JSON dentro de uma string
  };
  const chamarProv = (query, origin) => new Promise(resolve => { const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; resolve(this); return this; }, end() { resolve(this); return this; } };
    proventos({ method: "GET", headers: { origin: origin || "https://genfin-rose.vercel.app" }, query }, res); });
  r = await chamarProv({ t: "itsa4", c: "acao" });
  const its = r.body.itens || [];
  ok(r.statusCode === 200 && /s-maxage=21600/.test(r.headers["cache-control"]) && urlsB3.some(u => /GetDetail/.test(u)), "proventos: ação busca a empresa e o detalhe na B3, com cache de 6 h");
  ok(its.length === 2 && its.every(i => i.tipo !== "outro") && (d => d && d.valor === 1234.5 && d.pagamento === null && d.dataCom === iso(5))(its.find(i => i.tipo === "dividendo")),
    "proventos: só o ISIN do ITSA4, sem repetidos nem antigos; data de pagamento vazia vira null e valor em formato BR é lido");
  ok((j => j && j.valor === 0.0242425 && j.pagamento === iso(20) && j.dataCom === iso(-10))(its.find(i => i.tipo === "jcp")) && its[0].tipo === "jcp", "proventos: JCP com data com e pagamento em ISO, o de pagamento mais distante primeiro");
  r = await chamarProv({ t: "ITSA11", c: "acao" });
  ok(r.statusCode === 200 && r.body.itens.length === 0, "proventos: código que a empresa não tem volta vazio");
  r = await chamarProv({ t: "MXRF11", c: "fii" });
  ok(r.body.itens.length === 1 && r.body.itens[0].tipo === "rendimento" && r.body.itens[0].valor === 0.095, "proventos: FII pega só a cota (CTF), sem recibo de subscrição");
  r = await chamarProv({ t: "ZZZZ11", c: "fii" });
  ok(r.statusCode === 200 && r.body.itens.length === 0, "proventos: fundo desconhecido (resposta vazia) volta vazio");
  urlsB3 = [];
  r = await chamarProv({ t: "ITSA4; DROP", c: "acao" });
  ok(r.statusCode === 400 && !urlsB3.length, "proventos: código fora do formato é recusado sem ir à B3");
  r = await chamarProv({ t: "ITSA4", c: "cripto" });
  ok(r.statusCode === 400, "proventos: só ações e FIIs");
  global.fetch = async () => ({ ok: false, status: 503, text: async () => "" });
  r = await chamarProv({ t: "ITSA4", c: "acao" }, "null");
  ok(r.statusCode === 502 && r.body.erro === "servico" && r.headers["access-control-allow-origin"] === "null", "proventos: B3 fora do ar vira 502; arquivo local pode chamar");

  // api/sync.js com o Blob em memória
  const { instalar, chamar: chamarSync } = require("./blob-falso.js");
  const blob = instalar();
  const sync = require("../api/sync.js");
  const id = "a".repeat(32), token = "T".repeat(43), outro = "U".repeat(43);
  const cifra = { iv: "AAAAAAAAAAAAAAAA", dados: "QUJD" };
  let s = await chamarSync(sync, { body: { acao: "ler", id, token } });
  ok(s.status === 404 && s.body.erro === "nao_existe", "sync: ler o que não existe dá 404");
  s = await chamarSync(sync, { body: { acao: "gravar", id: "xyz", token } });
  ok(s.status === 400, "sync: id fora do formato é recusado");
  s = await chamarSync(sync, { body: { acao: "gravar", id, token, etag: null, atualizado: 10, ...cifra } });
  const etag1 = s.body.etag;
  ok(s.status === 200 && etag1 && blob.arquivos[`sync/${id}.json`] && !/T{43}/.test(blob.arquivos[`sync/${id}.json`].txt), "sync: cria o arquivo e guarda só o hash do token");
  s = await chamarSync(sync, { body: { acao: "ler", id, token: outro } });
  ok(s.status === 403, "sync: outro token não lê");
  s = await chamarSync(sync, { body: { acao: "gravar", id, token: outro, etag: etag1, ...cifra } });
  ok(s.status === 403, "sync: outro token não grava");
  s = await chamarSync(sync, { body: { acao: "gravar", id, token, etag: "\"velha\"", atualizado: 20, ...cifra } });
  ok(s.status === 409 && s.body.etag === etag1 && s.body.atualizado === 10, "sync: versão velha dá conflito e mostra a atual");
  s = await chamarSync(sync, { body: { acao: "gravar", id, token, etag: etag1, atualizado: 30, iv: cifra.iv, dados: "<script>" } });
  ok(s.status === 400, "sync: dados que não são base64 são recusados");
  s = await chamarSync(sync, { body: { acao: "gravar", id, token, etag: etag1, atualizado: 30, ...cifra } });
  ok(s.status === 200 && s.body.etag !== etag1, "sync: grava com a versão certa e gera ETag nova");
  s = await chamarSync(sync, { body: { acao: "ler", id, token } });
  ok(s.status === 200 && s.body.atualizado === 30 && s.body.dados === cifra.dados, "sync: lê de volta o bloco cifrado");
  s = await chamarSync(sync, { body: { acao: "apagar", id, token } });
  ok(s.status === 200 && !blob.arquivos[`sync/${id}.json`], "sync: apagar remove da nuvem");
  s = await chamarSync(sync, { method: "OPTIONS", origin: "https://localhost" });
  ok(s.status === 204 && s.headers["access-control-allow-origin"] === "https://localhost", "sync: app Android pode chamar");

  // O carteira.html aberto direto do disco (file://) manda Origin "null"
  s = await chamarSync(sync, { method: "OPTIONS", origin: "null" });
  ok(s.headers["access-control-allow-origin"] === "null", "sync: arquivo local (origem null) pode chamar");
  r = await chamar(carregar(), { method: "OPTIONS", origin: "null" });
  ok(r.headers["access-control-allow-origin"] === "null", "resumo: arquivo local (origem null) pode chamar");

  console.log(falhas ? falhas + " falha(s)" : "todos passaram");
  if (falhas) process.exitCode = 1;
})().catch(e => { console.error("ERRO:", e); process.exit(1); });
