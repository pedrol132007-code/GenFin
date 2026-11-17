// Agente de investimentos (função da Vercel): conversa com a IA do Groq apoiada em dados reais de mercado.
// Para caber no plano gratuito (8 mil tokens por minuto), o código entende a pergunta, busca os dados certos já reduzidos
// e faz uma chamada ao modelo, com no máximo uma rodada extra de ferramenta.
// Recebe o retrato da carteira em percentuais (sem valores em reais nem quantidades) e não guarda nada.
const { barrar } = require("./_limite.js");
const mercado = require("./_mercado.js");
const { escolherModelo, ORIGENS, raciocinio } = require("./resumo.js");

const CLASSES = ["acao", "etf", "fii", "rf", "cripto"];
const TAMANHO_MAX = 24000, MAX_TOKENS = { dia: 1500, pergunta: 2500 };
const texto = (v, n = 120) => String(v ?? "").slice(0, n);
const num = v => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const r2 = v => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const pctR = v => (v == null || !Number.isFinite(v) ? null : Math.round(v * 1000) / 10);   // fração → % com 1 casa
const TICKER = /^[A-Z0-9]{4}\d{1,2}$/;

const REGRAS_AGENTE = "Você é o agente de investimentos de uma pessoa física no Brasil, dentro do app GenFin. Responda em português do Brasil. " +
  "O perfil da pessoa vem nos dados: siga-o. Você PODE sugerir comprar, reduzir ou vender ativos e começar ativos novos, mas só citando números " +
  "que estão nos dados (preço, P/L, P/VP, DY, ROE, faixa de 52 semanas, DY médio de 5 anos, distância ao preço médio, peso, metas). Nunca invente " +
  "número nem ticker; ativo novo só se estiver entre os candidatos ou nos dados. Não faça previsão de preço. Vender é exceção: só quando o fundamento " +
  "piorou ou o ativo está caro perto do próprio histórico, nunca por oscilação curta. Lembre de reinvestir proventos quando fizer sentido. ETFs e cripto: " +
  "só reforço do que a pessoa já tem. Renda fixa: só compare com a Selic e o IPCA esperados. Percentuais dos dados já vêm em % (dy_pct 8.1 = 8,1%). " +
  "Não escreva valores em reais nem quantidades de cotas: o app calcula. Responda SOMENTE com um objeto JSON: " +
  "{\"texto\": string, \"avisos\": [{\"texto\": string, \"ticker\": string opcional}], \"compras\": [{\"ticker\": string, \"pct_do_aporte\": number, \"motivo\": string}], " +
  "\"vendas\": [{\"ticker\": string, \"acao\": \"vender\" ou \"reduzir\", \"motivo\": string}]}. Cada motivo cita os números em até 25 palavras. " +
  "Se a pergunta não for sobre investimentos ou a carteira, responda {\"texto\": \"Eu só respondo sobre a sua carteira.\", \"avisos\": [], \"compras\": [], \"vendas\": []}.";
const INSTRUCOES = {
  dia: " Agora escreva o resumo do dia: em \"texto\", uma frase curta de abertura; em \"avisos\", até 3 avisos curtos (até 25 palavras cada), os mais " +
    "úteis entre: ativo da carteira abaixo do preço médio (dist_pm_pct negativo) ou que subiu muito, provento a receber, ativo caro perto do próprio " +
    "histórico, candidato novo que vale olhar. \"compras\" e \"vendas\" vazios.",
  pergunta: " Responda à pergunta em \"texto\" (até 150 palavras; tópicos com \"- \" se ajudar). Se a pessoa for aportar, preencha \"compras\": para cada " +
    "classe com parcela maior que zero em aporte_por_classe_pct, escolha de 1 a 3 ativos (da carteira ou dos candidatos) e dê pct_do_aporte DENTRO da " +
    "classe (somando 100 em cada classe). Renda fixa não entra em compras. Sem aporte_por_classe_pct, use só ações e FIIs, divididos pelo perfil. " +
    "Se sugerir vender ou reduzir, use \"vendas\". Quando preencher \"compras\", o app mostra o plano com cotas e valores: em \"texto\" " +
    "explique só o raciocínio da divisão em até 3 frases, sem listar os ativos com percentuais."
};
const FERRAMENTAS = [
  { type: "function", function: { name: "fundamentos", description: "Indicadores atuais (preço, P/L, P/VP, DY, ROE) e histórico (faixa de 52 semanas, DY médio de 5 anos) de até 3 ações ou FIIs da bolsa brasileira.",
    parameters: { type: "object", properties: { tickers: { type: "array", items: { type: "string" }, maxItems: 3 } }, required: ["tickers"] } } },
  { type: "function", function: { name: "candidatos", description: "Melhores ações ou FIIs da triagem pelo perfil, fora da carteira.",
    parameters: { type: "object", properties: { classe: { type: "string", enum: ["acao", "fii"] }, n: { type: "integer", minimum: 1, maximum: 8 } }, required: ["classe"] } } }
];

/* ---------- Pedido ---------- */
function limparPedido(c) {
  if (!c || typeof c !== "object") return null;
  const modo = c.modo === "dia" || c.modo === "pergunta" ? c.modo : null, k = c.carteira;
  if (!modo || !k || typeof k !== "object" || !Array.isArray(k.posicoes)) return null;
  const ir = k.ir && typeof k.ir === "object" ? k.ir : {};
  const carteira = {
    classes: (Array.isArray(k.classes) ? k.classes : []).slice(0, 10).map(x => ({ classe: texto(x && x.classe, 30), carteira_pct: num(x && x.carteira_pct), meta_pct: num(x && x.meta_pct), diferenca_meta_pp: num(x && x.diferenca_meta_pp) })),
    posicoes: k.posicoes.slice(0, 30).filter(p => p && CLASSES.includes(p.classe)).map(p => ({
      ativo: p.classe === "rf" ? texto(p.ativo, 40) : mercado.tickerBase(texto(p.ativo, 12).trim().toUpperCase()),
      classe: p.classe, peso_pct: num(p.peso_pct), resultado_pct: num(p.resultado_pct), dist_pm_pct: num(p.dist_pm_pct) })),
    metas_ok: k.metas_ok === true,
    ir: { vendas_acoes_pct_do_limite: num(ir.vendas_acoes_pct_do_limite), prejuizo_a_compensar: ir.prejuizo_a_compensar === true },
    proventos_a_receber: (Array.isArray(k.proventos_a_receber) ? k.proventos_a_receber : []).slice(0, 10).map(e => ({ ativo: texto(e && e.ativo, 12), tipo: texto(e && e.tipo, 20),
      data_com: texto(e && e.data_com, 10), paga_em: e && e.paga_em ? texto(e.paga_em, 10) : null, pct_do_custo: num(e && e.pct_do_custo) }))
  };
  const ap = c.aporte_por_classe_pct && typeof c.aporte_por_classe_pct === "object" ? Object.fromEntries(CLASSES.map(x => [x, num(c.aporte_por_classe_pct[x]) || 0])) : null;
  return { modo, carteira, perfil: texto(c.perfil, 800), pergunta: texto(c.pergunta, 400).trim(), aporte: ap,
    historico: (Array.isArray(c.historico) ? c.historico : []).slice(-3).filter(h => h && h.p && h.r).map(h => ({ p: texto(h.p, 400), r: texto(h.r, 1200) })) };
}

// O que a pergunta pede, por palavras (sem IA): decide quais dados buscar antes de chamar o modelo
function intencao(pergunta) {
  const p = String(pergunta || ""), low = p.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const tickers = [...new Set((p.match(/\b[A-Z]{4}\d{1,2}F?\b/g) || []).map(mercado.tickerBase))];
  let tipo = "aberta";
  if (/aport|investir|comprar com|tenho r\$|onde colocar/.test(low)) tipo = "aporte";
  else if (/vend|realizar|sair de/.test(low)) tipo = "venda";
  else if (tickers.length) tipo = "ativo";
  else if (/\bfii|fundos? imobili/.test(low)) tipo = "fiis";
  else if (/\bac(ao|oes)\b|bolsa/.test(low)) tipo = "acoes";
  return { tipo, tickers };
}

/* ---------- Dados de mercado para o contexto ---------- */
function novoContexto(carteira) { return { carteira, falhas: new Set(), permitidos: new Map(), dados: {}, blocos: {} }; }
async function tentar(ctx, fn) {
  try { return await fn(); }
  catch (e) { ctx.falhas.add(String((e && e.message) || "fonte").replace(/^fonte:/, "")); return null; }
}
function compacto(x) {
  return x.classe === "fii"
    ? { classe: "fii", preco: r2(x.cotacao), dy_pct: pctR(x.dy), pvp: r2(x.pvp), segmento: x.segmento || null, vacancia_pct: pctR(x.vacancia) }
    : { classe: "acao", preco: r2(x.cotacao), pl: r2(x.pl), pvp: r2(x.pvp), dy_pct: pctR(x.dy), roe_pct: pctR(x.roe), cresc_receita_5a_pct: pctR(x.crescRec5a), div_liq_patrim: r2(x.divLiqPatrim) };
}
function registrar(ctx, t, classe, extra) { ctx.permitidos.set(t, classe); ctx.dados[t] = { ...(ctx.dados[t] || {}), ...extra }; }
async function tabelas(ctx) {
  if (!ctx.idx) {
    const [acoes, fiis] = await Promise.all([tentar(ctx, mercado.acoes), tentar(ctx, mercado.fiis)]);
    ctx.tab = { acoes: acoes || [], fiis: fiis || [] };
    ctx.idx = new Map([...ctx.tab.acoes.map(a => [a.ticker, { ...a, classe: "acao" }]), ...ctx.tab.fiis.map(f => [f.ticker, { ...f, classe: "fii" }])]);
  }
}
// Posições da carteira: entram como permitidas, com indicadores quando a tabela tem
async function base(ctx) {
  await tabelas(ctx);
  for (const p of ctx.carteira.posicoes) {
    if (p.classe === "rf") continue;
    const x = ctx.idx.get(p.ativo);
    registrar(ctx, p.ativo, p.classe, x && (p.classe === "acao" || p.classe === "fii") ? compacto(x) : {});
  }
}
async function historico(ctx, t, classe) {
  const pr = await tentar(ctx, () => mercado.precos(t));
  const out = {};
  if (pr && pr.preco) {
    out.max52 = r2(pr.max52); out.min52 = r2(pr.min52);
    if (pr.max52 > pr.min52) out.pos_faixa_52s_pct = Math.round((pr.preco - pr.min52) / (pr.max52 - pr.min52) * 100);
    const ha12 = pr.mensal.length >= 13 ? pr.mensal[pr.mensal.length - 13].fech : null;
    if (ha12) out.var_12m_pct = num((pr.preco / ha12 - 1) * 100);
    { const anos = mercado.dyPorAno(pr.dividendos, pr.mensal).slice(-5); if (anos.length) out.dy_medio_5a_pct = pctR(anos.reduce((s, a) => s + a.dy, 0) / anos.length); }
  }
  return out;
}
async function setor(ctx, t) { const d = await tentar(ctx, () => mercado.detalhe(t)); return d && (d.subsetor || d.setor) ? { setor: d.subsetor || d.setor } : {}; }
async function candidatos(ctx, classe, n) {
  await tabelas(ctx);
  const c = mercado.triagem(classe === "fii" ? ctx.tab.fiis : ctx.tab.acoes, classe, { excluir: ctx.carteira.posicoes.map(p => p.ativo), n });
  const setores = classe === "acao" ? await Promise.all(c.map(x => setor(ctx, x.ticker))) : [];
  c.forEach((x, i) => registrar(ctx, x.ticker, classe, { ...compacto({ ...x, classe }), ...(setores[i] || {}) }));
  return c.map(x => ({ ticker: x.ticker, nota: Math.round(x.nota * 100) }));
}
// Indicadores + histórico + setor de tickers citados (pela pergunta ou pela ferramenta)
async function fundamentosDe(ctx, tickers, { noticias = 0 } = {}) {
  await tabelas(ctx);
  const out = {};
  await Promise.all(tickers.slice(0, 3).map(async t => {
    const x = ctx.idx.get(t), tem = ctx.carteira.posicoes.find(p => p.ativo === t);
    if (!x) { out[t] = { sem_dados: true }; if (tem) registrar(ctx, t, tem.classe, {}); return; }
    const [h, s, man] = await Promise.all([historico(ctx, t, x.classe), x.classe === "acao" ? setor(ctx, t) : {}, noticias ? tentar(ctx, () => mercado.manchetes(t, noticias)) : null]);
    registrar(ctx, t, x.classe, { ...compacto(x), ...s, ...h });
    out[t] = { ...ctx.dados[t], ...(man && man.length ? { manchetes: man.map(m => m.titulo) } : {}) };
  }));
  return out;
}
async function macro(ctx) {
  const f = await tentar(ctx, mercado.focus);
  if (f) ctx.blocos.expectativas_focus = { selic_pct: f.selic, ipca_pct: f.ipca };
}
const posicoesDe = (ctx, classes, n = 8) => ctx.carteira.posicoes.filter(p => classes.includes(p.classe)).sort((a, b) => (b.peso_pct || 0) - (a.peso_pct || 0)).slice(0, n);

async function prebusca(ctx, modo, int, aporte) {
  await base(ctx);
  const tipo = modo === "dia" ? "dia" : int.tipo;
  if (tipo === "aporte") {
    for (const classe of ["acao", "fii"]) if (!aporte || aporte[classe] > 0) ctx.blocos["candidatos_" + classe] = await candidatos(ctx, classe, 6);
    if (aporte) ctx.blocos.aporte_por_classe_pct = aporte;
    await macro(ctx);
  } else if (tipo === "acoes" || tipo === "fiis") {
    const classe = tipo === "fiis" ? "fii" : "acao";
    if (classe === "acao") await Promise.all(posicoesDe(ctx, ["acao"]).map(async p => { if (ctx.permitidos.has(p.ativo)) Object.assign(ctx.dados[p.ativo], await setor(ctx, p.ativo)); }));
    ctx.blocos["candidatos_" + classe] = await candidatos(ctx, classe, 5);
  } else if (tipo === "venda") {
    await Promise.all(posicoesDe(ctx, ["acao", "fii"]).map(async p => {
      const [h, man] = await Promise.all([historico(ctx, p.ativo, p.classe), tentar(ctx, () => mercado.manchetes(p.ativo, 2))]);
      registrar(ctx, p.ativo, p.classe, { ...h, ...(man && man.length ? { manchetes: man.map(m => m.titulo) } : {}) });
    }));
    if (int.tickers.length) await fundamentosDe(ctx, int.tickers, { noticias: 2 });
  } else if (tipo === "ativo") {
    ctx.blocos.ativos_citados = await fundamentosDe(ctx, int.tickers, { noticias: 3 });
  } else if (tipo === "dia") {
    await Promise.all(posicoesDe(ctx, ["acao", "fii"]).map(async p => registrar(ctx, p.ativo, p.classe, await historico(ctx, p.ativo, p.classe))));
    const sets = await Promise.all(posicoesDe(ctx, ["acao"], 15).map(p => setor(ctx, p.ativo)));
    ctx.blocos.setores_da_carteira = [...new Set(sets.map(s => s.setor).filter(Boolean))];
    ctx.blocos.candidatos_acao = await candidatos(ctx, "acao", 3);
    ctx.blocos.candidatos_fii = await candidatos(ctx, "fii", 3);
  } else {
    await macro(ctx);
  }
}

function montarDados(ped, ctx) {
  const d = { perfil: ped.perfil, carteira: ped.carteira, ativos: ctx.dados, ...ctx.blocos };
  if (ctx.falhas.size) d.aviso_fontes = "Indisponíveis agora: " + [...ctx.falhas].join(", ") + ". Indicadores dessas fontes estão faltando; diga isso e não invente números.";
  return d;
}

/* ---------- Ferramentas ---------- */
async function executarFerramenta(ctx, nome, args) {
  try {
    if (nome === "fundamentos") {
      const ts = (Array.isArray(args.tickers) ? args.tickers : []).map(t => mercado.tickerBase(String(t).trim().toUpperCase())).filter(t => TICKER.test(t));
      return await fundamentosDe(ctx, ts);
    }
    if (nome === "candidatos" && (args.classe === "acao" || args.classe === "fii")) {
      const lista = await candidatos(ctx, args.classe, Math.min(8, Math.max(1, Number(args.n) || 5)));
      return { candidatos: lista.map(c => ({ ...c, ...ctx.dados[c.ticker] })) };
    }
  } catch (e) { /* cai no erro abaixo */ }
  return { erro: "ferramenta indisponível" };
}

/* ---------- Saída da IA ---------- */
function lerJSON(conteudo) {
  const s = String(conteudo || "");
  try { return JSON.parse(s); } catch (e) { /* tenta o trecho entre chaves */ }
  const i = s.indexOf("{"), f = s.lastIndexOf("}");
  if (i >= 0 && f > i) { try { return JSON.parse(s.slice(i, f + 1)); } catch (e) { /* não era JSON */ } }
  return null;
}
// Acha a resposta mesmo quando a IA a embrulha (como {"name": …, "arguments": {…}}, às vezes com os argumentos em texto)
function respostaDe(v, nivel = 0) {
  if (nivel > 4) return null;
  if (typeof v === "string") return /^\s*\{/.test(v) ? respostaDe(lerJSON(v), nivel + 1) : null;
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  if (typeof v.texto === "string" || Array.isArray(v.compras) || Array.isArray(v.vendas) || Array.isArray(v.avisos)) return v;
  for (const k of Object.keys(v)) { const r = respostaDe(v[k], nivel + 1); if (r) return r; }
  return null;
}
// Lê a mensagem da IA: JSON (mesmo embrulhado), JSON quebrado ou texto solto. JSON válido sem resposta (só argumentos
// de ferramenta, por exemplo) vira vazio, para não mostrar pedaços dele na conversa.
function interpretar(conteudo) {
  if (!conteudo) return {};
  const lido = lerJSON(conteudo);
  return lido ? respostaDe(lido) || {} : { texto: textoDeJSONQuebrado(conteudo) };
}
const vazia = s => !s.texto && !s.avisos.length && !s.compras.length && !s.vendas.length;
// Quando nem o JSON fecha, tira só o campo "texto" (melhor que mostrar pedaços de JSON na conversa)
function textoDeJSONQuebrado(conteudo) {
  const m = /"texto"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(String(conteudo || ""));
  if (m) { try { return JSON.parse('"' + m[1] + '"'); } catch (e) { return m[1]; } }
  return String(conteudo || "").replace(/[{}]/g, "").trim();
}
// Só passa o que dá para confiar: ticker que veio dos dados, classe decidida aqui, percentuais somando 100 por classe
function validarSaida(s, permitidos, carteira) {
  if (!s || typeof s !== "object") s = {};
  const tem = new Map(carteira.posicoes.map(p => [p.ativo, p.classe]));
  const tk = v => mercado.tickerBase(String(v || "").trim().toUpperCase());
  const vistos = new Set();
  const compras = (Array.isArray(s.compras) ? s.compras : []).map(c => {
    const t = tk(c && c.ticker);
    return { ticker: t, classe: tem.get(t) || permitidos.get(t), pct: Number(c && c.pct_do_aporte), motivo: texto(c && c.motivo, 300), novo: !tem.has(t) };
  }).filter(c => {
    if (!permitidos.has(c.ticker) || !c.classe || c.classe === "rf" || !(c.pct > 0) || vistos.has(c.ticker)) return false;
    if (c.novo && (c.classe === "etf" || c.classe === "cripto")) return false;
    vistos.add(c.ticker); return true;
  });
  const soma = {};
  compras.forEach(c => { soma[c.classe] = (soma[c.classe] || 0) + c.pct; });
  const comprasOk = compras.map(({ pct, ...c }) => ({ ...c, pct_do_aporte: Math.round(pct / soma[c.classe] * 1000) / 10 }));
  const vendas = (Array.isArray(s.vendas) ? s.vendas : []).map(v => ({ ticker: tk(v && v.ticker), acao: v && v.acao === "vender" ? "vender" : "reduzir", motivo: texto(v && v.motivo, 300) }))
    .filter((v, i, a) => tem.has(v.ticker) && tem.get(v.ticker) !== "rf" && a.findIndex(x => x.ticker === v.ticker) === i);
  const avisos = (Array.isArray(s.avisos) ? s.avisos : []).slice(0, 3).map(a => {
    const t = typeof a === "string" ? a : texto(a && a.texto, 300), tick = a && typeof a === "object" ? tk(a.ticker) : "";
    return { texto: texto(t, 300).trim(), ...(tick && (permitidos.has(tick) || tem.has(tick)) ? { ticker: tick } : {}) };
  }).filter(a => a.texto);
  return { texto: texto(s.texto, 3000).trim(), avisos, compras: comprasOk, vendas };
}

/* ---------- Groq ---------- */
async function chamarGroq(chave, corpo) {
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST", headers: { Authorization: "Bearer " + chave, "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  if (r.status === 429) {
    const espera = Number(r.headers && r.headers.get ? r.headers.get("retry-after") : NaN);
    throw Object.assign(new Error("limite"), { status: 429, esperar: Number.isFinite(espera) ? Math.ceil(espera) : null });
  }
  if (r.status === 401) throw Object.assign(new Error("chave"), { status: 401 });
  if (r.status === 400) {
    // No modo JSON, uma resposta que não fecha o JSON volta como 400 com o texto gerado em failed_generation
    let j = null; try { j = await r.json(); } catch (e) { /* corpo vazio */ }
    const gerado = j && j.error && j.error.failed_generation;
    if (gerado) return { choices: [{ message: { content: String(gerado) }, finish_reason: "json_invalido" }] };
    throw Object.assign(new Error("servico"), { status: 502 });
  }
  if (!r.ok) throw Object.assign(new Error("servico"), { status: 502 });
  return r.json();
}
const mensagemDe = j => j && j.choices && j.choices[0] ? j.choices[0] : {};

module.exports = async (req, res) => {
  const origem = req.headers.origin || "";
  if (ORIGENS.includes(origem) || /^https:\/\/genfin-[a-z0-9-]+\.vercel\.app$/.test(origem)) {
    res.setHeader("Access-Control-Allow-Origin", origem);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ erro: "metodo" });
  if (barrar(req, res, "agente", 40, 3600)) return;   // por IP, por hora

  const chave = process.env.GROQ_API_KEY;
  if (!chave) return res.status(503).json({ erro: "sem_chave" });

  let corpo = req.body;
  if (typeof corpo === "string") { try { corpo = JSON.parse(corpo); } catch (e) { corpo = null; } }
  const ped = limparPedido(corpo);
  if (!ped || JSON.stringify(ped).length > TAMANHO_MAX) return res.status(400).json({ erro: "dados" });
  if (/R\$/.test(JSON.stringify(ped.carteira))) return res.status(400).json({ erro: "valores_em_reais" });   // o app nunca manda reais no retrato
  if (ped.modo === "pergunta" && !ped.pergunta) return res.status(400).json({ erro: "pergunta" });

  try {
    const modelo = await escolherModelo(chave);
    if (!modelo) return res.status(502).json({ erro: "servico" });
    const ctx = novoContexto(ped.carteira);
    await prebusca(ctx, ped.modo, intencao(ped.pergunta), ped.aporte);

    const mensagens = [{ role: "system", content: REGRAS_AGENTE + INSTRUCOES[ped.modo] }, { role: "user", content: "Dados:\n" + JSON.stringify(montarDados(ped, ctx)) }];
    for (const h of ped.historico) mensagens.push({ role: "user", content: h.p }, { role: "assistant", content: h.r });
    if (ped.modo === "pergunta") mensagens.push({ role: "user", content: ped.pergunta });

    const comum = { model: modelo, temperature: 0.3, max_tokens: MAX_TOKENS[ped.modo], ...raciocinio(modelo) };
    const comFerramentas = ped.modo === "pergunta";
    let escolha = mensagemDe(await chamarGroq(chave, { ...comum, messages: mensagens,
      ...(comFerramentas ? { tools: FERRAMENTAS, tool_choice: "auto" } : { response_format: { type: "json_object" } }) }));
    const chamadas = escolha.message && Array.isArray(escolha.message.tool_calls) ? escolha.message.tool_calls.slice(0, 2) : [];
    if (comFerramentas && chamadas.length) {
      // Uma rodada extra só: executa as ferramentas e pede a resposta final já sem ferramentas
      mensagens.push({ role: "assistant", content: escolha.message.content || "", tool_calls: chamadas });
      for (const c of chamadas) {
        let args = {}; try { args = JSON.parse((c.function && c.function.arguments) || "{}"); } catch (e) { /* argumentos vazios */ }
        mensagens.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(await executarFerramenta(ctx, c.function && c.function.name, args)) });
      }
      escolha = mensagemDe(await chamarGroq(chave, { ...comum, messages: mensagens, response_format: { type: "json_object" } }));
    }
    const ler = e => validarSaida(interpretar(e.message && e.message.content), ctx.permitidos, ped.carteira);
    let saida = ler(escolha);
    if (vazia(saida) && comFerramentas && !chamadas.length) {
      // Com ferramentas, às vezes a IA tenta uma chamada malformada e não responde nada: uma nova tentativa, já sem
      // ferramentas (os dados pré-buscados bastam), mantém o máximo de duas chamadas por pergunta
      escolha = mensagemDe(await chamarGroq(chave, { ...comum, messages: mensagens, response_format: { type: "json_object" } }));
      saida = ler(escolha);
    }
    if (vazia(saida)) {
      console.warn("agente: resposta vazia", escolha.finish_reason || "", String((escolha.message && escolha.message.content) || "").slice(0, 300));
      return res.status(502).json({ erro: "servico", motivo: escolha.finish_reason || null });
    }
    return res.status(200).json({ ...saida, dados: ctx.dados, fontes_falharam: [...ctx.falhas], em: new Date().toISOString(), modelo });
  } catch (e) {
    if (e.status === 429) return res.status(429).json({ erro: "limite", esperar_s: e.esperar });
    if (e.status === 401) return res.status(502).json({ erro: "chave_invalida" });
    return res.status(502).json({ erro: "servico" });
  }
};
module.exports.intencao = intencao;
module.exports.validarSaida = validarSaida;
