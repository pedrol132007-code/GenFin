// Limite de chamadas por IP, guardado na memória da instância (a Vercel reaproveita a instância entre pedidos).
// Não é uma barreira perfeita (instâncias novas começam zeradas), mas impede que alguém que ache o endereço
// no repositório público gaste a cota gratuita do Groq ou do Blob num laço. O uso normal do app fica bem abaixo.
const contagens = new Map();

// Devolve 0 se pode seguir, ou quantos segundos esperar. Sem IP (só nos testes locais), não limita.
function esperar(req, nome, max, janelaS) {
  const h = req.headers || {};
  const ip = String(h["x-forwarded-for"] || h["x-real-ip"] || "").split(",")[0].trim();
  if (!ip) return 0;
  const agora = Date.now(), chave = nome + "|" + ip;
  let c = contagens.get(chave);
  if (!c || c.fim <= agora) {
    if (contagens.size > 5000) for (const [k, v] of contagens) if (v.fim <= agora) contagens.delete(k);
    c = { n: 0, fim: agora + janelaS * 1000 };
    contagens.set(chave, c);
  }
  c.n++;
  return c.n > max ? Math.ceil((c.fim - agora) / 1000) : 0;
}

// Responde 429 no mesmo formato do limite do Groq ({erro: "limite", esperar_s}), que o app já sabe mostrar
function barrar(req, res, nome, max, janelaS) {
  const s = esperar(req, nome, max, janelaS);
  if (!s) return false;
  res.setHeader("Retry-After", String(s));
  res.status(429).json({ erro: "limite", esperar_s: s });
  return true;
}

module.exports = { esperar, barrar };
