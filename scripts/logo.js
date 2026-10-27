// Gera o logo do GenFin: o ícone com a faixa de alocação (5 classes, com fresta entre elas) e o nome ao lado.
// Escreve docs/logo/*.svg e atualiza o logo e o favicon embutidos no carteira.html.
// Uso: npm install && npm run logo
const fs = require("fs"), path = require("path"), os = require("os");
const opentype = require("opentype.js");

const RAIZ = path.join(__dirname, "..");
const SAIDA = path.join(RAIZ, "docs", "logo");
const APP = path.join(RAIZ, "carteira.html");

// Cores das classes (ações, ETFs, FIIs, renda fixa, cripto) e da tinta do app, nos dois temas
const CLARO  = ["#2B5C8F","#6A4C9C","#B98323","#3B7D5C","#D0662A"];
const TINTA = "#16232B", TINTA_ESCURO = "#E6ECE8";
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
// Ícone: quadrado arredondado preenchido pela faixa de alocação, com o G vazado por cima.
// Desenhado em (0,0) com lado 100; o G é centrado no quadrado.
// semLetra / soLetra separam as camadas do ícone adaptativo do Android (fundo e frente)
function desenhoIcone(font, id, {raio=0.23, margem=0.2, fundo=null, semLetra=false, soLetra=false}={}){
  const {d, bb} = caminho(font, "G");
  const lado = (bb.y2-bb.y1)/(1-2*margem), x0 = (bb.x1+bb.x2)/2-lado/2, y0 = (bb.y1+bb.y2)/2-lado/2;
  const k = 100/lado; let acc = 0; const cortes = [0.24,0.18,0.2,0.22].map(p => acc += 100*p);
  const letra = `<path d="${d}" fill="#FFFFFF" transform="scale(${f(k)}) translate(${f(-x0)} ${f(-y0)})"/>`;
  if(soLetra) return letra;
  return `<clipPath id="${id}"><rect width="100" height="100" rx="${f(100*raio)}"/></clipPath>`+
    (fundo ? `<rect width="100" height="100" fill="${fundo}"/>` : "")+
    `<g clip-path="url(#${id})">${faixas(0, 100, 0, 100, CLARO, cortes)}</g>`+
    (semLetra ? "" : letra);
}
function icone(font, opcoes){
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512" role="img" aria-label="GenFin"><title>GenFin</title>${desenhoIcone(font, "gi", opcoes)}</svg>`;
}
// Ícone "maskable" do app instalado: quadrado cheio (o sistema recorta), o G dentro da área segura central
// e fundo opaco nas frestas, porque o sistema pinta transparência de preto
const MASKABLE = {raio:0, margem:0.27, fundo:"#EEF2EF"};
// Ícone adaptativo do Android, em duas camadas. O @capacitor/assets já recua cada imagem para a área visível
// (inset de 16,7%), então elas são desenhadas como a parte que aparece, igual ao maskable
const ANDROID_FUNDO = {raio:0, fundo:"#EEF2EF", semLetra:true}, ANDROID_FRENTE = {margem:0.27, soLetra:true};
// Logo completo: o ícone colorido e, ao lado, o nome numa cor só. A cor fica toda no ícone.
function marca(font, corTexto, {id="gm"}={}){
  const {d, bb} = caminho(font, "GenFin");
  const alt = bb.y2-bb.y1, lado = alt*1.18, vao = lado*0.3;
  const iy = (bb.y1+bb.y2)/2 - lado/2, ix = bb.x1 - vao - lado;
  const box = [ix, iy, bb.x2-ix, lado].map(f).join(" ");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" role="img" aria-label="GenFin"><title>GenFin</title>`+
    `<g transform="translate(${f(ix)} ${f(iy)}) scale(${f(lado/100)})">${desenhoIcone(font, id)}</g>`+
    `<path d="${d}" fill="${corTexto}"/></svg>`;
}

(async ()=>{
  const buf = await fonte();
  const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset+buf.byteLength));
  fs.mkdirSync(SAIDA, {recursive:true});
  const ico = icone(font);
  fs.writeFileSync(path.join(SAIDA, "genfin.svg"), marca(font, TINTA)+"\n");
  fs.writeFileSync(path.join(SAIDA, "genfin-escuro.svg"), marca(font, TINTA_ESCURO)+"\n");
  fs.writeFileSync(path.join(SAIDA, "icone.svg"), ico+"\n");
  fs.writeFileSync(path.join(SAIDA, "icone-maskable.svg"), icone(font, MASKABLE)+"\n");
  fs.writeFileSync(path.join(SAIDA, "icone-android-fundo.svg"), icone(font, ANDROID_FUNDO)+"\n");
  fs.writeFileSync(path.join(SAIDA, "icone-android-frente.svg"), icone(font, ANDROID_FRENTE)+"\n");

  let h = fs.readFileSync(APP, "utf8");
  const logoApp = marca(font, "var(--ink)", {id:"gm-app"}).replace("<svg ", '<svg class="logo" ');
  const favicon = `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(ico.replace(/ width="512" height="512"/,""))}">`;
  const antes = h;
  h = h.replace(/<h1 class="marca">[\s\S]*?<\/svg><\/h1>/, `<h1 class="marca">${logoApp}</h1>`);
  h = h.replace(/<link rel="icon"[^>]*>/, favicon);
  if(!h.includes(logoApp) || !h.includes(favicon)) throw new Error("Não achei o logo ou o favicon no carteira.html.");
  if(h!==antes) fs.writeFileSync(APP, h);
  console.log("Logo gerado em docs/logo" + (h!==antes ? " e atualizado no carteira.html" : "; carteira.html já estava em dia"));
})().catch(e=>{ console.error(e.message); process.exit(1); });
