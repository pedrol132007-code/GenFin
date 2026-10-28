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
