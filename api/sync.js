// Sincronização entre aparelhos. O app cifra a carteira antes de enviar (AES-GCM, com a chave derivada do
// código de sincronização, que nunca sai do aparelho); aqui só ficam blocos cifrados, num Blob privado.
// Do código também saem o id (escolhe o arquivo) e o token (o hash dele autoriza ler, gravar e apagar).
// A ETag do Blob serve de versão: quem grava diz qual versão viu, e uma gravação concorrente vira conflito.
const crypto = require("crypto");
const { put, get, del, BlobPreconditionFailedError } = require("@vercel/blob");

// "null" é o carteira.html aberto direto do disco (file://). Liberar não expõe nada: não há cookies, e a
// sincronização exige o token que só sai do código; o resumo só aceita o formato da carteira.
const ORIGENS = ["https://genfin-rose.vercel.app", "https://localhost", "http://localhost", "capacitor://localhost", "null"];
const TAMANHO_MAX = 4 * 1024 * 1024;   // dados cifrados em base64
const hash = t => crypto.createHash("sha256").update(String(t)).digest("hex");
const caminho = id => `sync/${id}.json`;

async function ler(id) {
  const r = await get(caminho(id), { access: "private", useCache: false });
  if (!r || r.statusCode !== 200) return null;
  return { doc: JSON.parse(await new Response(r.stream).text()), etag: r.blob.etag };
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

  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = null; } }
  if (!b || !/^[a-f0-9]{32}$/.test(b.id || "") || !/^[A-Za-z0-9_-]{43}$/.test(b.token || "")) return res.status(400).json({ erro: "dados" });

  try {
    const atual = await ler(b.id);
    if (atual && atual.doc.tokenHash !== hash(b.token)) return res.status(403).json({ erro: "token" });

    if (b.acao === "ler") {
      if (!atual) return res.status(404).json({ erro: "nao_existe" });
      return res.status(200).json({ etag: atual.etag, atualizado: atual.doc.atualizado, iv: atual.doc.iv, dados: atual.doc.dados });
    }
    if (b.acao === "apagar") {
      if (atual) await del(caminho(b.id));
      return res.status(200).json({ ok: true });
    }
    if (b.acao !== "gravar") return res.status(400).json({ erro: "acao" });

    const iv = String(b.iv || ""), dados = String(b.dados || "");
    if (!/^[A-Za-z0-9+/=]{16,24}$/.test(iv) || !/^[A-Za-z0-9+/=]+$/.test(dados) || dados.length > TAMANHO_MAX) return res.status(400).json({ erro: "dados" });
    if (atual && b.etag !== atual.etag) return res.status(409).json({ erro: "conflito", etag: atual.etag, atualizado: atual.doc.atualizado });

    const doc = { tokenHash: hash(b.token), atualizado: Number(b.atualizado) || Date.now(), iv, dados };
    const r = await put(caminho(b.id), JSON.stringify(doc), {
      access: "private", contentType: "application/json", addRandomSuffix: false,
      ...(atual ? { ifMatch: atual.etag } : { allowOverwrite: false })
    });
    return res.status(200).json({ etag: r.etag, atualizado: doc.atualizado });
  } catch (e) {
    // Outro aparelho gravou entre a leitura e a gravação (ou criou o arquivo ao mesmo tempo)
    if (e instanceof BlobPreconditionFailedError || /already exists/i.test(String(e && e.message))) return res.status(409).json({ erro: "conflito" });
    return res.status(502).json({ erro: "servico" });
  }
};
