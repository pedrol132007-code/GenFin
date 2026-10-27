// Gera o logo do GenFin: o nome recortado pela faixa de alocação (5 classes, com fresta entre elas).
// Escreve docs/logo/*.svg e atualiza o logo e o favicon embutidos no carteira.html.
// Uso: npm install && npm run logo
const fs = require("fs"), path = require("path"), os = require("os");
const opentype = require("opentype.js");

const RAIZ = path.join(__dirname, "..");
const SAIDA = path.join(RAIZ, "docs", "logo");
const APP = path.join(RAIZ, "carteira.html");

const CLARO  = ["#2B5C8F","#6A4C9C","#B98323","#3B7D5C","#D0662A"];
const ESCURO = ["#6E9FD4","#A68BD6","#E0B055","#6DBB92","#F0965A"];
const VARS   = ["var(--c-acao)","var(--c-etf)","var(--c-fii)","var(--c-rf)","var(--c-cripto)"];
const TRACK = -3.5;    // -0.035em, como o número grande do app (unidades: 100 = 1em)
const FRESTA = 3;
const f = n => +n.toFixed(2);

// Instância estática da Bricolage Grotesque (tamanho óptico 96, peso 800), só com as letras usadas.
// Um user agent antigo faz o Google Fonts responder em WOFF, que o opentype.js lê.
async function fonte(){
  const cache = path.join(os.tmpdir(), "genfin-bricolage-800.woff");
  if(fs.existsSync(cache)) return fs.readFileSync(cache);
  const ua = {"User-Agent":"Mozilla/5.0 (Windows NT 6.1) AppleWebKit/534.30 (KHTML, like Gecko) Safari/534.30"};
  const css = await (await fetch("https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@96,800&text=GenFi", {headers:ua})).text();
  const url = (css.match(/url\((https:[^)]+)\)/)||[])[1];
  if(!url) throw new Error("Não foi possível obter a fonte do Google Fonts.");
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  fs.writeFileSync(cache, buf);
  return buf;
}

function caminho(font, txt){
  const glifos = font.stringToGlyphs(txt); let x = 0; const p = new opentype.Path(); const caixas = [];
  glifos.forEach((g,i)=>{
    const q = g.getPath(x, 0, 100); p.extend(q); caixas.push(q.getBoundingBox());
    const k = i<glifos.length-1 ? font.getKerningValue(g, glifos[i+1]) : 0;
    x += (g.advanceWidth + k) * 100 / font.unitsPerEm + TRACK;
  });
  return { d: p.toPathData(2), bb: p.getBoundingBox(), caixas };
}
// Faixas verticais entre os cortes, com uma fresta transparente em cada corte
function faixas(x1, x2, y1, y2, cores, cortes){
  const lim = [x1, ...cortes, x2];
  return cores.map((c,i)=>{
    const a = lim[i] + (i ? FRESTA/2 : 0), b = lim[i+1] - (i<cores.length-1 ? FRESTA/2 : 0);
    return `<rect x="${f(a)}" y="${f(y1)}" width="${f(b-a)}" height="${f(y2-y1)}" fill="${c}"/>`;
  }).join("");
}
function marca(font, cores, {pad=4, id="gf"}={}){
  const {d, bb, caixas} = caminho(font, "GenFin");
  const meio = i => (caixas[i].x1+caixas[i].x2)/2;
  // Os cortes passam pelas curvas do G e do e e pelo arco do n, onde não isolam nenhuma haste
  // (uma haste solta vira uma letra a mais). F e "in" ficam inteiros.
  const cortes = [meio(0), meio(1), meio(2)+6, (caixas[3].x2+caixas[4].x1)/2];
  const box = [bb.x1-pad, bb.y1-pad, bb.x2-bb.x1+2*pad, bb.y2-bb.y1+2*pad].map(f).join(" ");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" role="img" aria-label="GenFin"><title>GenFin</title>`+
    `<clipPath id="${id}"><path d="${d}"/></clipPath><g clip-path="url(#${id})">${faixas(bb.x1-1, bb.x2+1, bb.y1-1, bb.y2+1, cores, cortes)}</g></svg>`;
}
// Ícone: quadrado arredondado preenchido pela faixa de alocação, com o G vazado por cima
function icone(font, {raio=0.23, margem=0.2}={}){
  const {d, bb} = caminho(font, "G");
  const lado = (bb.y2-bb.y1)/(1-2*margem), x0 = (bb.x1+bb.x2)/2-lado/2, y0 = (bb.y1+bb.y2)/2-lado/2;
  let acc = x0; const cortes = [0.24,0.18,0.2,0.22].map(p => acc += lado*p);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${[x0,y0,lado,lado].map(f).join(" ")}" width="512" height="512" role="img" aria-label="GenFin"><title>GenFin</title>`+
    `<clipPath id="gi"><rect x="${f(x0)}" y="${f(y0)}" width="${f(lado)}" height="${f(lado)}" rx="${f(lado*raio)}"/></clipPath>`+
    `<g clip-path="url(#gi)">${faixas(x0, x0+lado, y0, y0+lado, CLARO, cortes)}</g><path d="${d}" fill="#FFFFFF"/></svg>`;
}

(async ()=>{
  const buf = await fonte();
  const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset+buf.byteLength));
  fs.mkdirSync(SAIDA, {recursive:true});
  const ico = icone(font);
  fs.writeFileSync(path.join(SAIDA, "genfin.svg"), marca(font, CLARO)+"\n");
  fs.writeFileSync(path.join(SAIDA, "genfin-escuro.svg"), marca(font, ESCURO)+"\n");
  fs.writeFileSync(path.join(SAIDA, "icone.svg"), ico+"\n");

  let h = fs.readFileSync(APP, "utf8");
  const logoApp = marca(font, VARS, {pad:0, id:"gf-app"}).replace("<svg ", '<svg class="logo" ');
  const favicon = `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(ico.replace(/ width="512" height="512"/,""))}">`;
  const antes = h;
  h = h.replace(/<h1 class="marca">[\s\S]*?<\/svg><\/h1>/, `<h1 class="marca">${logoApp}</h1>`);
  h = h.replace(/<link rel="icon"[^>]*>/, favicon);
  if(!h.includes(logoApp) || !h.includes(favicon)) throw new Error("Não achei o logo ou o favicon no carteira.html.");
  if(h!==antes) fs.writeFileSync(APP, h);
  console.log("Logo gerado em docs/logo" + (h!==antes ? " e atualizado no carteira.html" : "; carteira.html já estava em dia"));
})().catch(e=>{ console.error(e.message); process.exit(1); });
