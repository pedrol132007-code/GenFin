// Testes da função do agente (api/agente.js), com Groq e fontes de mercado simulados. Uso: npm test.
const fs = require("fs");
let falhas = 0; const ok = (c, m) => { if (!c) { falhas++; console.log("FALHOU:", m); } else console.log("ok:", m); };
const fx = n => fs.readFileSync(__dirname + "/fixtures/" + n);
const lat = b => new TextDecoder("latin1").decode(b);

function carregar() {
  for (const m of ["../api/agente.js", "../api/_mercado.js", "../api/resumo.js"]) delete require.cache[require.resolve(m)];
  return require("../api/agente.js");
}
function chamar(fn, { method = "POST", origin = "https://genfin-rose.vercel.app", body } = {}) {
  return new Promise(resolve => {
    const res = { headers: {}, statusCode: 200,
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      status(c) { this.statusCode = c; return this; },
      json(o) { this.body = o; resolve(this); return this; },
      end() { resolve(this); return this; } };
    fn({ method, headers: { origin }, body }, res);
  });
}
const resp = (corpo, status = 200, headers = {}) => ({ ok: status === 200, status,
  headers: { get: k => headers[k.toLowerCase()] ?? null },
  text: async () => typeof corpo === "string" ? corpo : JSON.stringify(corpo),
  json: async () => (typeof corpo === "string" ? JSON.parse(corpo) : corpo),
  arrayBuffer: async () => { const b = Buffer.from(typeof corpo === "string" ? corpo : JSON.stringify(corpo), "latin1"); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); } });

// Estado do fetch simulado: respostas do Groq em fila; fontes respondem com as fixtures
let groq = [], pedidosGroq = [], fundamentusFora = false;
const msg = conteudo => resp({ choices: [{ message: { content: typeof conteudo === "string" ? conteudo : JSON.stringify(conteudo) }, finish_reason: "stop" }] });
global.fetch = async (url, op = {}) => {
  if (/api\.groq\.com\/openai\/v1\/models/.test(url)) return resp({ data: [{ id: "openai/gpt-oss-120b" }] });
  if (/api\.groq\.com/.test(url)) { pedidosGroq.push(JSON.parse(op.body)); return groq.shift() || msg({ texto: "ok", compras: [], vendas: [], avisos: [] }); }
  if (/fundamentus\.com\.br\/resultado/.test(url)) return fundamentusFora ? resp("x", 503) : resp(lat(fx("fundamentus-acoes.html")));
  if (/fundamentus\.com\.br\/fii_resultado/.test(url)) return fundamentusFora ? resp("x", 503) : resp(lat(fx("fundamentus-fii.html")));
  if (/fundamentus\.com\.br\/detalhes/.test(url)) return fundamentusFora ? resp("x", 503) : resp(lat(fx("fundamentus-detalhe.html")));
  if (/finance\.yahoo/.test(url)) return resp(JSON.parse(fx("yahoo-petr4.json")));
  if (/olinda\.bcb/.test(url)) return resp(JSON.parse(fx("focus.json")));
  if (/news\.google/.test(url)) return resp("<rss></rss>");
  return resp("", 404);
};

const carteira = {
  classes: [{ classe: "Ações", carteira_pct: 60, meta_pct: 50, diferenca_meta_pp: 10 }, { classe: "FIIs", carteira_pct: 40, meta_pct: 50, diferenca_meta_pp: -10 }],
  posicoes: [{ ativo: "ITSA4", classe: "acao", peso_pct: 40, resultado_pct: -4, dist_pm_pct: -4 },
    { ativo: "PETR4", classe: "acao", peso_pct: 20, resultado_pct: 30, dist_pm_pct: 30 },
    { ativo: "MXRF11", classe: "fii", peso_pct: 30, resultado_pct: 2, dist_pm_pct: 2 },
    { ativo: "BOVA11", classe: "etf", peso_pct: 10, resultado_pct: 5, dist_pm_pct: 5 }],
  metas_ok: true, ir: { vendas_acoes_pct_do_limite: 0, prejuizo_a_compensar: false }, proventos_a_receber: [] };
const pedido = extra => ({ modo: "pergunta", carteira, perfil: "Longo prazo, patrimônio e renda.", ...extra });

(async () => {
  process.env.GROQ_API_KEY = "gsk-teste";
  let ag = carregar();

  // intencao
  ok(ag.intencao("vou aportar 2 mil, sugestões?").tipo === "aporte", "intenção: aporte");
  const at = ag.intencao("e o ITSA4F?");
  ok(at.tipo === "ativo" && at.tickers.length === 1 && at.tickers[0] === "ITSA4", "intenção: ticker citado, fracionário vira o lote");
  ok(ag.intencao("algo pra vender?").tipo === "venda", "intenção: venda");
  ok(ag.intencao("como estão meus FIIs?").tipo === "fiis" && ag.intencao("como estão as ações?").tipo === "acoes", "intenção: panorama por classe");
  ok(ag.intencao("o que acha da economia?").tipo === "aberta", "intenção: pergunta aberta");

  // validarSaida
  const permitidos = new Map([["ITSA4", "acao"], ["BBAS3", "acao"], ["MXRF11", "fii"], ["BOVA11", "etf"], ["IVVB11", "etf"]]);
  const v = ag.validarSaida({ texto: "t", avisos: [1, 2, 3, 4].map(i => ({ texto: "a" + i })),
    compras: [{ ticker: "FAKE3", pct_do_aporte: 50 }, { ticker: "ITSA4", pct_do_aporte: 30 }, { ticker: "BBAS3", pct_do_aporte: 30 },
      { ticker: "IVVB11", pct_do_aporte: 100 }, { ticker: "BOVA11", pct_do_aporte: 100 }, { ticker: "MXRF11", pct_do_aporte: 40 }],
    vendas: [{ ticker: "PETR4", acao: "vender", motivo: "caro" }, { ticker: "BBAS3", acao: "vender", motivo: "?" }] }, permitidos, carteira);
  const pc = t => (v.compras.find(c => c.ticker === t) || {}).pct_do_aporte;
  ok(!v.compras.some(c => c.ticker === "FAKE3"), "validarSaida: ticker inventado sai");
  ok(!v.compras.some(c => c.ticker === "IVVB11") && pc("BOVA11") === 100, "validarSaida: ETF novo sai, reforço de ETF que já tem fica");
  ok(pc("ITSA4") === 50 && pc("BBAS3") === 50 && pc("MXRF11") === 100, "validarSaida: percentuais somam 100 dentro de cada classe");
  ok(v.compras.find(c => c.ticker === "BBAS3").novo === true && v.compras.find(c => c.ticker === "ITSA4").novo === false && v.compras.find(c => c.ticker === "BBAS3").classe === "acao", "validarSaida: classe e 'novo' decididos pelo servidor");
  ok(v.vendas.length === 1 && v.vendas[0].ticker === "PETR4", "validarSaida: só vende o que a pessoa tem");
  ok(v.avisos.length === 3, "validarSaida: no máximo 3 avisos");

  // aporte: dados certos e sem reais
  groq = [msg({ texto: "Plano", compras: [{ ticker: "BBAS3", pct_do_aporte: 100, motivo: "barato" }], vendas: [], avisos: [] })]; pedidosGroq = [];
  let r = await chamar(ag, { body: pedido({ pergunta: "vou aportar, sugestões?", aporte_por_classe_pct: { acao: 60, fii: 40, etf: 0, rf: 0, cripto: 0 } }) });
  const enviado = JSON.stringify(pedidosGroq[0] ? pedidosGroq[0].messages : []);
  ok(r.statusCode === 200 && r.body.compras.length === 1 && r.body.compras[0].ticker === "BBAS3", "aporte: responde 200 com a compra validada");
  ok(/BBAS3/.test(enviado) && !/R\$/.test(enviado), "aporte: candidato da triagem vai para a IA, sem valores em reais");
  ok(enviado.length < 24000, "aporte: contexto enxuto (" + enviado.length + " caracteres)");
  ok(r.body.dados.BBAS3 && r.body.dados.BBAS3.preco === 17.02 && r.body.dados.ITSA4 && r.body.dados.ITSA4.preco > 0, "aporte: dados trazem o preço de cada ticker sugerível");
  ok(pedidosGroq[0].reasoning_effort === "low" && pedidosGroq[0].max_tokens >= 2000, "gpt-oss com raciocínio curto e folga de tokens");

  // pedido com reais é recusado
  r = await chamar(ag, { body: pedido({ pergunta: "tenho R$ 2.000" }) });
  ok(r.statusCode === 200, "R$ na pergunta é aceito (é texto da pessoa)");
  r = await chamar(ag, { body: { modo: "pergunta", carteira: { ...carteira, posicoes: [{ ativo: "R$ 5.000", classe: "acao", peso_pct: 1 }] }, perfil: "x", pergunta: "oi" } });
  ok(r.statusCode === 400, "R$ dentro do retrato da carteira é recusado");

  // JSON quebrado
  groq = [msg("Não consegui montar o JSON, mas ITSA4 parece barata.")];
  r = await chamar(ag, { body: pedido({ pergunta: "como estão as ações?" }) });
  ok(r.statusCode === 200 && /ITSA4 parece barata/.test(r.body.texto) && r.body.compras.length === 0, "resposta que não é JSON vira texto, sem sugestões");

  // JSON quebrado no modo JSON do Groq: 400 com failed_generation vira texto
  groq = [resp({ error: { code: "json_validate_failed", failed_generation: '{"texto": "Bom dia, carteira estável.", "avisos": [{"texto": "ITSA4 abaixo do preço médio", "ticker": "ITSA4"' } }, 400)];
  r = await chamar(ag, { body: { modo: "dia", carteira, perfil: "x" } });
  ok(r.statusCode === 200 && r.body.texto === "Bom dia, carteira estável." && !/[{}"]/.test(r.body.texto), "JSON inválido do modo JSON: aproveita o texto gerado, sem pedaços de JSON");
  groq = [msg('{"texto": "Resposta pela metade", "compras": [')];
  r = await chamar(ag, { body: pedido({ pergunta: "como estão as ações?" }) });
  ok(r.statusCode === 200 && r.body.texto === "Resposta pela metade", "JSON cortado: mostra só o texto");
  r = await chamar(ag, { body: { modo: "dia", carteira, perfil: "x" } });
  ok(pedidosGroq[pedidosGroq.length - 1].max_tokens <= 1500, "resumo do dia pede menos tokens que a conversa");

  // 429 do Groq
  groq = [resp({ error: "rate" }, 429, { "retry-after": "20" })];
  r = await chamar(ag, { body: pedido({ pergunta: "como estão as ações?" }) });
  ok(r.statusCode === 429 && r.body.erro === "limite" && r.body.esperar_s === 20, "Groq em 429 devolve quanto esperar");

  // Fundamentus fora do ar
  ag = carregar(); fundamentusFora = true; pedidosGroq = [];
  groq = [msg({ texto: "Sem indicadores hoje.", compras: [{ ticker: "BBAS3", pct_do_aporte: 50 }, { ticker: "ITSA4", pct_do_aporte: 50 }], vendas: [], avisos: [] })];
  r = await chamar(ag, { body: pedido({ pergunta: "vou aportar, sugestões?" }) });
  ok(r.statusCode === 200 && r.body.fontes_falharam.includes("fundamentus"), "Fundamentus fora do ar: responde e diz qual fonte falhou");
  ok(r.body.compras.every(c => c.ticker === "ITSA4"), "Fundamentus fora do ar: só sobra o que já está na carteira");
  ok(/indispon/i.test(JSON.stringify(pedidosGroq[0].messages)), "a IA é avisada de que os indicadores estão indisponíveis");
  fundamentusFora = false;

  // Rodada extra de ferramenta
  ag = carregar(); pedidosGroq = [];
  groq = [resp({ choices: [{ message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "fundamentos", arguments: JSON.stringify({ tickers: ["WEGE3"] }) } }] }, finish_reason: "tool_calls" }] }),
    msg({ texto: "WEGE3 está cara.", compras: [], vendas: [], avisos: [] })];
  r = await chamar(ag, { body: pedido({ pergunta: "o que acha da economia?" }) });
  ok(r.statusCode === 200 && r.body.texto === "WEGE3 está cara." && pedidosGroq.length === 2, "ferramenta: 1 rodada extra e resposta final");
  ok(Array.isArray(pedidosGroq[0].tools) && !pedidosGroq[1].tools && /WEGE3/.test(JSON.stringify(pedidosGroq[1].messages.slice(-1))), "ferramenta: a segunda chamada leva o resultado e vai sem ferramentas");

  // Modo dia
  pedidosGroq = [];
  groq = [msg({ texto: "Bom dia", avisos: [{ texto: "ITSA4 abaixo do seu preço médio", ticker: "ITSA4" }], compras: [], vendas: [] })];
  r = await chamar(ag, { body: { modo: "dia", carteira, perfil: "x" } });
  ok(r.statusCode === 200 && r.body.avisos[0].ticker === "ITSA4" && !pedidosGroq[0].tools, "modo dia: avisos, sem ferramentas");

  // HTTP e CORS
  r = await chamar(ag, { method: "GET" });
  ok(r.statusCode === 405, "só aceita POST");
  r = await chamar(ag, { method: "OPTIONS", origin: "https://site-qualquer.com" });
  ok(!r.headers["access-control-allow-origin"], "outra origem não recebe CORS");
  r = await chamar(ag, { method: "OPTIONS", origin: "https://genfin-git-agente-prodt.vercel.app" });
  ok(r.headers["access-control-allow-origin"] === "https://genfin-git-agente-prodt.vercel.app", "prévia da Vercel recebe CORS");
  r = await chamar(ag, { body: { modo: "pergunta", carteira, perfil: "x" } });
  ok(r.statusCode === 400, "pergunta vazia é recusada");
  delete process.env.GROQ_API_KEY;
  r = await chamar(carregar(), { body: pedido({ pergunta: "oi" }) });
  ok(r.statusCode === 503 && r.body.erro === "sem_chave", "sem GROQ_API_KEY: 503 sem_chave");

  console.log(falhas ? `\n${falhas} teste(s) falharam` : "\nagente: todos os testes passaram");
  process.exit(falhas ? 1 : 0);
})();
