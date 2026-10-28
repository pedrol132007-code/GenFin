// Resumo da carteira com IA, do lado do servidor (função da Vercel), para não precisar colar a chave em cada aparelho.
// A chave do Groq fica na variável de ambiente GROQ_API_KEY do projeto na Vercel; nada é guardado aqui.
// Só aceita os dados que o app monta em dadosParaIA() (percentuais, códigos e leituras sem valores em reais)
// e usa uma instrução fixa: não serve como IA genérica para quem descobrir o endereço.

const ORIGENS = ["https://genfin-rose.vercel.app", "https://localhost", "http://localhost", "capacitor://localhost"];
const TAMANHO_MAX = 20000;
const INSTRUCAO = "Você ajuda uma pessoa física no Brasil a entender a própria carteira de investimentos. Responda em português do Brasil, em no máximo 6 tópicos curtos, cada um começando com \"- \". Explique o que os números mostram (concentração, distância das metas, desempenho contra o CDI e o Ibovespa, proventos, pontos de imposto de renda) e o que vale a pessoa verificar. Não recomende comprar ou vender ativos específicos, não faça previsão de preços e não invente dados que não estejam na mensagem. Os dados vêm só em percentuais, sem valores em reais.";

const texto = (v, n = 120) => String(v ?? "").slice(0, n);
const numero = v => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
// Monta de novo só os campos esperados, com tamanhos limitados: o que chegar fora disso é descartado
function limpar(d) {
  if (!d || typeof d !== "object" || !Array.isArray(d.classes) || !Array.isArray(d.posicoes) || !Array.isArray(d.leituras)) return null;
  return {
    data: texto(d.data, 10),
    classes: d.classes.slice(0, 10).map(c => ({ classe: texto(c.classe, 30), carteira_pct: numero(c.carteira_pct), meta_pct: numero(c.meta_pct) })),
    posicoes: d.posicoes.slice(0, 15).map(p => ({ ativo: texto(p.ativo, 40), classe: texto(p.classe, 30), peso_pct: numero(p.peso_pct), resultado_pct: numero(p.resultado_pct) })),
    resultado_sobre_aportado_pct: numero(d.resultado_sobre_aportado_pct),
    contra_cdi_pct: numero(d.contra_cdi_pct),
    contra_ibovespa_pct: numero(d.contra_ibovespa_pct),
    desde: texto(d.desde, 10),
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
  const dados = limpar(corpo);
  const json = dados && JSON.stringify(dados);
  if (!dados || json.length > TAMANHO_MAX) return res.status(400).json({ erro: "dados" });
  if (/R\$/.test(json)) return res.status(400).json({ erro: "valores_em_reais" });   // o app nunca manda valores em reais

  try {
    const modelo = await escolherModelo(chave);
    if (!modelo) return res.status(502).json({ erro: "servico" });
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + chave, "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelo, temperature: 0.3, max_tokens: 900,
        messages: [{ role: "system", content: INSTRUCAO }, { role: "user", content: "Dados da carteira:\n" + json }] })
    });
    if (r.status === 401) return res.status(502).json({ erro: "chave_invalida" });
    if (r.status === 429) return res.status(429).json({ erro: "limite" });
    if (!r.ok) return res.status(502).json({ erro: "servico" });
    const j = await r.json(), resposta = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if (!resposta) return res.status(502).json({ erro: "servico" });
    return res.status(200).json({ texto: String(resposta).trim().slice(0, 6000), modelo });
  } catch (e) {
    if (e.status === 401) return res.status(502).json({ erro: "chave_invalida" });
    return res.status(502).json({ erro: "servico" });
  }
};
