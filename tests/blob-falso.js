// @vercel/blob em memória para os testes: get/put/del com ETag, ifMatch e "já existe".
// instalar() substitui o pacote no cache do require, então api/sync.js passa a usar este.
const arquivos = {};
let n = 0;
class BlobPreconditionFailedError extends Error {}
const blobFalso = {
  BlobPreconditionFailedError,
  arquivos,
  async get(p) {
    const a = arquivos[p];
    return a ? { statusCode: 200, stream: new Blob([a.txt]).stream(), blob: { etag: a.etag } } : null;
  },
  async put(p, txt, o = {}) {
    const a = arquivos[p];
    if (o.ifMatch && (!a || a.etag !== o.ifMatch)) throw new BlobPreconditionFailedError("precondition failed");
    if (a && !o.ifMatch && !o.allowOverwrite) throw new Error("This blob already exists");
    const etag = `"e${++n}"`;
    arquivos[p] = { txt: String(txt), etag };
    return { etag };
  },
  async del(p) { delete arquivos[p]; }
};
function instalar() {
  const id = require.resolve("@vercel/blob");
  require.cache[id] = { id, filename: id, loaded: true, exports: blobFalso };
  return blobFalso;
}
// Chama uma função da Vercel (req, res) e devolve algo com a cara de uma resposta do fetch
function chamar(fn, { method = "POST", origin = "https://genfin-rose.vercel.app", body } = {}) {
  return new Promise(resolve => {
    const res = { headers: {}, statusCode: 200,
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      status(c) { this.statusCode = c; return this; },
      json(o) { resolve({ ok: this.statusCode < 400, status: this.statusCode, headers: this.headers, body: o, json: async () => o }); return this; },
      end() { resolve({ ok: true, status: this.statusCode, headers: this.headers, body: null, json: async () => ({}) }); return this; } };
    fn({ method, headers: { origin }, body }, res);
  });
}
module.exports = { instalar, chamar };
