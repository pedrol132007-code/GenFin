// Monta www/, a pasta que vai dentro do app Android (Capacitor): carteira.html vira index.html
// e a fonte é baixada para dentro do app, para ele abrir igual sem internet.
// Uso: npm run www   (o GitHub Actions roda antes de compilar o APK)
const fs = require("fs"), path = require("path");
const RAIZ = path.join(__dirname, ".."), WWW = path.join(RAIZ, "www");
const UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"};

(async () => {
  fs.rmSync(WWW, {recursive: true, force: true});
  fs.mkdirSync(WWW, {recursive: true});
  fs.cpSync(path.join(RAIZ, "icons"), path.join(WWW, "icons"), {recursive: true});
  let html = fs.readFileSync(path.join(RAIZ, "carteira.html"), "utf8");

  const link = html.match(/<link href="(https:\/\/fonts\.googleapis\.com\/css2\?[^"]+)" rel="stylesheet">/);
  if (!link) throw new Error("Não achei o link da fonte no carteira.html.");
  try {
    let css = await (await fetch(link[1].replace(/&amp;/g, "&"), {headers: UA})).text();
    const urls = [...new Set(css.match(/https:\/\/fonts\.gstatic\.com\/[^)]+/g) || [])];
    if (!urls.length) throw new Error("resposta sem arquivos de fonte");
    fs.mkdirSync(path.join(WWW, "fontes"));
    for (const [i, url] of urls.entries()) {
      const r = await fetch(url, {headers: UA});
      if (!r.ok) throw new Error(`fonte ${r.status}`);
      fs.writeFileSync(path.join(WWW, "fontes", `bricolage-${i}.woff2`), Buffer.from(await r.arrayBuffer()));
      css = css.split(url).join(`bricolage-${i}.woff2`);
    }
    fs.writeFileSync(path.join(WWW, "fontes", "fontes.css"), css);
    html = html
      .replace(/<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">\n?/, "")
      .replace(/<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin>\n?/, "")
      .replace(link[0], '<link href="fontes/fontes.css" rel="stylesheet">');
    console.log(`Fonte embutida: ${urls.length} arquivo(s).`);
  } catch (e) {
    // Sem a fonte embutida o app continua funcionando, com a fonte do Google quando houver internet
    console.warn("Aviso: fonte não embutida (" + e.message + "); o app usa a do Google quando tiver internet.");
  }
  fs.writeFileSync(path.join(WWW, "index.html"), html);
  console.log("www/ pronta.");
})().catch(e => { console.error(e.message); process.exit(1); });
