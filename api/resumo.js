// IA da carteira do lado do servidor (função da Vercel), para não precisar colar a chave em cada aparelho.
// A chave do Groq fica na variável de ambiente GROQ_API_KEY do projeto na Vercel; nada é guardado aqui.
// Só aceita os dados que o app monta em dadosParaIA() (percentuais, códigos e leituras sem valores em reais)
// e usa instruções fixas: não serve como IA genérica para quem descobrir o endereço.
// Modos: "resumo" (tópicos), "manchete" (até 2 frases para o topo do Resumo) e "pergunta" (conversa curta).

// "null" é o carteira.html aberto direto do disco (file://). Liberar não expõe nada: não há cookies, e a
// sincronização exige o token que só sai do código; o resumo só aceita o formato da carteira.
const ORIGENS = ["https://genfin-rose.vercel.app", "https://localhost", "http://localhost", "capacitor://localhost", "null"];
const TAMANHO_MAX = 24000;
const REGRAS = "Você ajuda uma pessoa física no Brasil a entender a própria carteira de investimentos. Responda em português do Brasil. Use só os dados da mensagem, que vêm em percentuais, sem valores em reais; não invente números. Não recomende comprar ou vender ativos específicos e não faça previsão de preços: explique o que os números mostram e o que vale a pessoa verificar.";
const INSTRUCOES = {
  resumo: REGRAS + " Responda em no máximo 6 tópicos curtos, cada um começando com \"- \", cobrindo o que for relevante entre concentração, distância das metas, desempenho contra o CDI e o Ibovespa, proventos e imposto de renda.",
  manchete: REGRAS + " Escreva só a manchete do dia: no máximo 2 frases curtas (até 40 palavras no total), com o ponto mais importante da carteira agora. Sem tópicos, sem título, sem saudação.",
  pergunta: REGRAS + " Responda à pergunta da pessoa de forma direta, em até 120 palavras; use tópicos com \"- \" só se ajudar. Se a pergunta for sobre como dividir um aporte, explique pela distância de cada classe até a meta, sem citar ativos para comprar. Se a pergunta não for sobre a carteira ou finanças pessoais dela, responda apenas: \"Eu só respondo sobre a sua carteira.\""
};
const TOKENS = { resumo: 900, manchete: 160, pergunta: 600 };

const texto = (v, n = 120) => String(v ?? "").slice(0, n);
const numero = v => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const sim = v => v === true;
// Monta de novo só os campos esperados, com tamanhos limitados: o que chegar fora disso é descartado
function limpar(d) {
  if (!d || typeof d !== "object" || !Array.isArray(d.classes) || !Array.isArray(d.posicoes) || !Array.isArray(d.leituras)) return null;
  const ir = d.ir && typeof d.ir === "object" ? d.ir : {};
  return {
    data: texto(d.data, 10),
    classes: d.classes.slice(0, 10).map(c => ({ classe: texto(c.classe, 30), carteira_pct: numero(c.carteira_pct), meta_pct: numero(c.meta_pct) })),
    posicoes: d.posicoes.slice(0, 15).map(p => ({ ativo: texto(p.ativo, 40), classe: texto(p.classe, 30), peso_pct: numero(p.peso_pct), resultado_pct: numero(p.resultado_pct) })),
    resultado_sobre_aportado_pct: numero(d.resultado_sobre_aportado_pct),
    contra_cdi_pct: numero(d.contra_cdi_pct),
    contra_ibovespa_pct: numero(d.contra_ibovespa_pct),
    desde: texto(d.desde, 10),
    evolucao: Array.isArray(d.evolucao) ? d.evolucao.slice(-12).map(e => ({ mes: texto(e.mes, 7), resultado_pct: numero(e.resultado_pct) })) : [],
    proventos_por_mes: Array.isArray(d.proventos_por_mes) ? d.proventos_por_mes.slice(-12).map(e => ({ mes: texto(e.mes, 7), pct_do_custo: numero(e.pct_do_custo) })) : [],
    ir: { vendas_acoes_pct_do_limite: numero(ir.vendas_acoes_pct_do_limite), vendas_cripto_pct_do_limite: numero(ir.vendas_cripto_pct_do_limite),
      darf_a_pagar: sim(ir.darf_a_pagar), prejuizo_a_compensar: sim(ir.prejuizo_a_compensar) },
    leituras: d.leituras.slice(0, 30).map(l => texto(l, 240))
  };
}

let modeloGuardado = null;
async function escolherModelo(chave) {
  if (modeloGuardado) return modeloGuardado;
  const r = await fetch("https://api.groq.com/openai/v1/models", { headers: { Authorization: "Bearer " + chave } });
  if (!r.ok) throw Object.assign(new Error("modelos"), { status: r.status });
  const ids = ((await r.json()).data || []).map(m => m.id);
  for (const p of [/^openai\/gpt-oss-120b$/, /^llama-3\.3-70b/, /llama-4-maverick/, /^qwen/, /llama/]) {
    const m = ids.find(id => p.test(id)); if (m) return (modeloGuardado = m);
  }
  return (modeloGuardado = ids.find(id => !/whisper|guard|tts|embed|playai|compound|prompt/i.test(id)) || null);
}

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

  const chave = process.env.GROQ_API_KEY;
  if (!chave) return res.status(503).json({ erro: "sem_chave" });

  let corpo = req.body;
  if (typeof corpo === "string") { try { corpo = JSON.parse(corpo); } catch (e) { corpo = null; } }
  // Formato atual: {modo, dados, pergunta, historico}; o antigo mandava só os dados (modo resumo)
  const novo = corpo && typeof corpo === "object" && corpo.dados;
  const modo = novo && INSTRUCOES[corpo.modo] ? corpo.modo : "resumo";
  const dados = limpar(novo ? corpo.dados : corpo);
  const json = dados && JSON.stringify(dados);
  if (!dados || json.length > TAMANHO_MAX) return res.status(400).json({ erro: "dados" });
  if (/R\$/.test(json)) return res.status(400).json({ erro: "valores_em_reais" });   // o app nunca manda valores em reais

  const mensagens = [{ role: "system", content: INSTRUCOES[modo] }, { role: "user", content: "Dados da carteira:\n" + json }];
  if (modo === "pergunta") {
    const pergunta = texto(corpo.pergunta, 400).trim();
    if (!pergunta) return res.status(400).json({ erro: "pergunta" });
    const hist = Array.isArray(corpo.historico) ? corpo.historico.slice(-3) : [];
    for (const h of hist) {
      if (!h || !h.p || !h.r) continue;
      mensagens.push({ role: "user", content: texto(h.p, 400) }, { role: "assistant", content: texto(h.r, 1200) });
    }
    mensagens.push({ role: "user", content: pergunta });
  }

  try {
    const modelo = await escolherModelo(chave);
    if (!modelo) return res.status(502).json({ erro: "servico" });
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + chave, "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelo, temperature: 0.3, max_tokens: TOKENS[modo], messages: mensagens })
    });
    if (r.status === 401) return res.status(502).json({ erro: "chave_invalida" });
    if (r.status === 429) return res.status(429).json({ erro: "limite" });
    if (!r.ok) return res.status(502).json({ erro: "servico" });
    const j = await r.json(), escolha = j.choices && j.choices[0], resposta = escolha && escolha.message && escolha.message.content;
    // Sem texto: devolve o motivo de parada (por exemplo "length"), que ajuda a diagnosticar
    if (!resposta) return res.status(502).json({ erro: "servico", motivo: (escolha && escolha.finish_reason) || null });
    return res.status(200).json({ texto: String(resposta).trim().slice(0, 6000), modelo });
  } catch (e) {
    if (e.status === 401) return res.status(502).json({ erro: "chave_invalida" });
    return res.status(502).json({ erro: "servico" });
  }
};
