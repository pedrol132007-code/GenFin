// Testes da lógica do carteira.html no Node, com um DOM falso mínimo.
// Uso: npm test   (ou: node tests/carteira.test.js [caminho/do/arquivo.html])
const fs = require("fs");
const html = fs.readFileSync(process.argv[2] || require("path").join(__dirname, "..", "carteira.html"), "utf8");
let js = html.match(/<script>([\s\S]*?)<\/script>/)[1];
js = js.split("/* ---------- Início ---------- */")[0];

const cache = {};
function fakeEl(){ return { textContent:"", innerHTML:"", className:"", value:"", hidden:false,
  classList:{add(){},remove(){},toggle(){},contains(){return false}}, addEventListener(){}, dispatchEvent(){},
  querySelector:s=>q(s), querySelectorAll:()=>[], setAttribute(){}, elements:{namedItem:()=>fakeEl()},
  options:[{},{}], focus(){}, showModal(){}, close(){} }; }
function q(s){ return cache[s] || (cache[s]=fakeEl()); }
// Monta um .xlsx mínimo (zip com sharedStrings e uma planilha) para testar o importador da B3.
// Textos vão em sharedStrings, exceto os que começam com "!" (inlineStr); "compactar: false" grava sem compressão.
const zlib = require("zlib");
function criarXLSX(linhas, {compactar=true}={}){
  const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const strings = [], idx = s => { let i = strings.indexOf(s); if(i<0){ i = strings.length; strings.push(s); } return i; };
  const letra = n => String.fromCharCode(65+n);
  const rows = linhas.map((l,r)=>`<row r="${r+1}">${l.map((v,c)=>{
    const ref = letra(c)+(r+1);
    if(typeof v==="number") return `<c r="${ref}"><v>${v}</v></c>`;
    if(String(v).startsWith("!")) return `<c r="${ref}" t="inlineStr"><is><t>${esc(String(v).slice(1))}</t></is></c>`;
    return `<c r="${ref}" t="s"><v>${idx(String(v))}</v></c>`;
  }).join("")}</row>`).join("");
  const arquivos = {
    "xl/worksheets/sheet1.xml": `<?xml version="1.0"?><worksheet><sheetData>${rows}</sheetData></worksheet>`,
    "xl/sharedStrings.xml": `<?xml version="1.0"?><sst>${strings.map(s=>`<si><t>${esc(s)}</t></si>`).join("")}</sst>`
  };
  const partes = [], central = []; let off = 0;
  for(const [nome, txt] of Object.entries(arquivos)){
    const cru = Buffer.from(txt), dados = compactar ? zlib.deflateRawSync(cru) : cru, n = Buffer.from(nome), crc = zlib.crc32(cru);
    const loc = Buffer.alloc(30); loc.writeUInt32LE(0x04034b50,0); loc.writeUInt16LE(compactar?8:0,8); loc.writeUInt32LE(crc,14); loc.writeUInt32LE(dados.length,18); loc.writeUInt32LE(cru.length,22); loc.writeUInt16LE(n.length,26);
    const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50,0); cen.writeUInt16LE(compactar?8:0,10); cen.writeUInt32LE(crc,16); cen.writeUInt32LE(dados.length,20); cen.writeUInt32LE(cru.length,24); cen.writeUInt16LE(n.length,28); cen.writeUInt32LE(off,42);
    partes.push(loc, n, dados); central.push(cen, n); off += 30 + n.length + dados.length;
  }
  const dir = Buffer.concat(central), fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50,0); fim.writeUInt16LE(Object.keys(arquivos).length,8); fim.writeUInt16LE(Object.keys(arquivos).length,10); fim.writeUInt32LE(dir.length,12); fim.writeUInt32LE(off,16);
  const b = Buffer.concat([...partes, dir, fim]);
  return b.buffer.slice(b.byteOffset, b.byteOffset+b.length);
}
// A função real de sincronização (api/sync.js) com um Blob em memória, para testar dois aparelhos de ponta a ponta
const blobSync = require("./blob-falso.js"), blobMem = blobSync.instalar(), funcaoSync = require("../api/sync.js");
const servidorSync = op => blobSync.chamar(funcaoSync, { method: op.method || "POST", body: JSON.parse(op.body) });
const mem = {};
const ambiente = {
  document:{ querySelector:q, querySelectorAll:()=>[], addEventListener(){},
    createElement:()=>{ const a={ click(){ globalThis.__baixados.push({nome:a.download, href:a.href}); }, remove(){} }; return a; },
    body:{ appendChild(){} } },
  window:{ addEventListener(){}, scrollTo(){}, scrollY:0 },
  localStorage:{ getItem:k=>mem[k]??null, setItem:(k,v)=>{mem[k]=v;}, removeItem:k=>{delete mem[k];} },
  location:{hash:""}, fakeEl, mem, criarXLSX, servidorSync, blobMem,
  // fetch simulado: cada teste troca globalThis.__fetch
  fetch:(...a)=>globalThis.__fetch(...a)
};
const testes = `
let falhas=0; const ok=(c,m)=>{ if(!c){falhas++; console.log("FALHOU:",m);} else console.log("ok:",m); };
renderTudo = ()=>{};
const form = v => ({ elements:{ namedItem:n=>({value:v[n]??""}) } });
const add = v => addTx(form(Object.assign({taxas:""},v)));
const msg = ()=>$("#tx-msg").textContent;

// 1. venda que passa do saldo na data
add({classe:"acao",tipo:"compra",data:"2025-01-10",ticker:"PETR4",qtd:"100",preco:"30"});
add({classe:"acao",tipo:"venda",data:"2025-01-05",ticker:"PETR4",qtd:"10",preco:"31"});
ok(S.txs.length===1 && /tinha 0/.test(msg()), "bloqueia venda antes da compra: "+msg());
add({classe:"acao",tipo:"venda",data:"2025-03-01",ticker:"PETR4",qtd:"80",preco:"35"});
ok(S.txs.length===2, "aceita venda válida");
// 2. venda retroativa que quebra uma venda posterior
add({classe:"acao",tipo:"venda",data:"2025-02-01",ticker:"PETR4",qtd:"50",preco:"33"});
ok(S.txs.length===2 && /ficaria sem saldo/.test(msg()), "bloqueia venda retroativa que deixa a posterior sem saldo: "+msg());
add({classe:"acao",tipo:"venda",data:"2025-02-01",ticker:"PETR4",qtd:"20",preco:"33"});
ok(S.txs.length===3, "aceita venda retroativa que cabe");
// 3. excluir compra com venda depois
const compra = S.txs.find(t=>t.tipo==="compra");
let avisos=[]; const t0=toast; toast = m=>avisos.push(m);
delTx(compra.id);
ok(S.txs.length===3 && /Não dá para excluir/.test(avisos[0]||""), "bloqueia excluir compra com venda depois: "+avisos[0]);
delTx(S.txs.find(t=>t.data==="2025-03-01").id);
ok(S.txs.length===2, "exclui venda normalmente");
// 4. renda fixa: resgate sem saldo e resgate retroativo
add({classe:"rf",tipo:"compra",data:"2025-05-01",ticker:"CDB X",valor:"1000"});
add({classe:"rf",tipo:"venda",data:"2025-04-01",ticker:"CDB X",valor:"500"});
ok(S.txs.length===3 && /Não havia saldo/.test(msg()) && !S.precos["CDB X"], "bloqueia resgate retroativo sem mexer na cotação: "+msg());
add({classe:"rf",tipo:"venda",data:"2025-06-01",ticker:"CDB X",valor:"400"});
ok(S.txs.length===4 && Math.abs(S.precos["CDB X"].v-600)<0.01, "resgate parcial atualiza valor do título");
// 5. dados antigos já inconsistentes não travam a exclusão
S.txs.push({id:"x",criado:1,data:"2024-01-01",tipo:"venda",classe:"acao",ticker:"VALE3",qtd:5,preco:10,taxas:0});
ok(vendaSemSaldo(S.txs).tx.id==="x", "detecta venda órfã existente");
delTx("x"); ok(!S.txs.some(t=>t.id==="x"), "permite excluir a venda órfã");

// 6. sincronização: local mais novo sobe; conta mais nova desce
const banco = {};
const fakeDb = { collection:()=>({ doc:n=>({ get:async()=>({exists:n in banco, data:()=>banco[n]}), set:async d=>{banco[n]=JSON.parse(JSON.stringify(d));} }) }) };
window.claude = { use: async k => k==="db"?fakeDb : {id:async()=>"u1"} };
const remoto = { ativos:{}, precos:{}, metas:S.metas, txs:[], provs:[{id:"p",data:"2025-01-01",ticker:"PETR4",tipo:"dividendo",valor:1}], hist:[], atualizado:1000 };
TODOS_DOCS.forEach(n=>banco[n]=JSON.parse(JSON.stringify(DOCS[n](remoto))));
const nLocal = S.txs.length; S.atualizado = 5000;
await conectar(); await fila;
ok(S.txs.length===nLocal && banco.lancamentos.itens.length===nLocal && banco.carteira.atualizado===5000, "local mais novo sobe para a conta");
base=null; banco.proventos = {itens:[], atualizado:9000}; banco.lancamentos={itens:[], atualizado:9000};
await conectar();
ok(S.txs.length===0 && S.atualizado===9000, "conta mais nova sobrescreve o local");
base=null; Object.keys(banco).forEach(k=>delete banco[k]); S = vazio(); delete S.atualizado;
add({classe:"acao",tipo:"compra",data:"2025-01-10",ticker:"ITSA4",qtd:"10",preco:"10"});
await conectar(); await fila;
ok(banco.lancamentos && banco.lancamentos.itens.length===1, "conta vazia recebe o local");
base=null;

// 7. IR 2026: dividendo acima de 50 mil no mês
S = vazio(); S.atualizado=1;
add({classe:"acao",tipo:"compra",data:"2026-01-10",ticker:"BBAS3",qtd:"100000",preco:"20"});
S.provs.push({id:"d1",data:"2026-03-10",ticker:"BBAS3",tipo:"dividendo",valor:30000},{id:"d2",data:"2026-03-25",ticker:"BBAS3",tipo:"dividendo",valor:25000},{id:"d3",data:"2026-04-10",ticker:"BBAS3",tipo:"dividendo",valor:40000});
anoIR="2026"; const el=fakeEl(); rIR(el);
ok(/acima de R\\$ 50 mil no mês: BBAS3 em mar\\/26\\./.test(el.innerHTML), "avisa dividendo acima de 50 mil só em mar/26");
ok(/isentos até R\\$ 50 mil/.test(el.innerHTML), "rótulo novo em 2026");
anoIR="2025"; S.txs.push({id:"c",criado:0,data:"2025-01-01",tipo:"compra",classe:"acao",ticker:"BBAS3",qtd:1,preco:1,taxas:0});
const el2=fakeEl(); rIR(el2); ok(!/Lei 15.270/.test(el2.innerHTML) && /rendimentos isentos/.test(el2.innerHTML), "2025 mantém texto antigo");

// 8. cotações automáticas
const resp = (status, corpo) => Promise.resolve({ ok: status<400, status, json: async()=>corpo });
const B3P = { PETR4:53.25, ITSA4:10.5, HGLG11:160.4 };
let chamadas = [];
const mercado = url => {
  chamadas.push(url);
  if(url.includes("mercadobitcoin")){
    const pedidos = decodeURIComponent(url.split("symbols=")[1]).split(",");
    return resp(200, pedidos.filter(s=>s==="BTC-BRL").map(s=>({pair:s, last:"430325.00000000"})));
  }
  const sim = decodeURIComponent(url.split("/quote/")[1].split("?")[0]);
  if(!url.includes("token=chave-boa")) return resp(401, {error:true, code:"INVALID_TOKEN"});
  return B3P[sim] ? resp(200, {results:[{symbol:sim, regularMarketPrice:B3P[sim]}]}) : resp(404, {error:true, message:"Não encontramos"});
};
let avisos2 = []; toast = m=>avisos2.push(m);
abaAtual = "ir";
S = vazio(); S.atualizado = 1;
[["acao","PETR4",100,30],["acao","ITSA4F",37,9],["fii","HGLG11",10,150],["acao","XPTO3",5,10],["cripto","BTC",0.01,300000],["cripto","FAKECOIN",3,1]].forEach(([classe,ticker,qtd,preco])=>
  add({classe, tipo:"compra", data:"2026-01-05", ticker, qtd:String(qtd).replace(".",","), preco:String(preco)}));
add({classe:"rf",tipo:"compra",data:"2026-01-05",ticker:"CDB Y",valor:"1000"});
ok(S.txs.length===7, "monta carteira para cotações");

globalThis.__fetch = mercado; chamadas = [];
await atualizarCotacoes({auto:true});
ok(chamadas.length===1 && chamadas[0].includes("mercadobitcoin") && S.precos.BTC.v===430325, "sem chave busca só cripto, sem chamar a brapi");
ok(ultimaBusca.falhas.includes("FAKECOIN") && !S.precos.FAKECOIN, "cripto inexistente fica sem cotação");

mem[LS_CHAVE] = "chave-ruim"; chamadas = []; avisos2 = [];
await atualizarCotacoes({auto:true});
ok(ultimaBusca.erro==="chave" && !S.precos.PETR4 && /recusou a chave/.test(avisos2[0]||""), "chave recusada avisa mesmo na busca automática: "+avisos2[0]);
ok(chamadas.filter(u=>u.includes("brapi")).length<=4, "para de consultar a brapi depois da chave recusada");

mem[LS_CHAVE] = "chave-boa"; chamadas = []; avisos2 = [];
const histAntes = S.hist.length; S.hist = [];
await atualizarCotacoes();
ok(S.precos.PETR4.v===53.25 && S.precos.HGLG11.v===160.4 && S.precos.PETR4.em===hojeISO(), "atualiza ações e FIIs com a data de hoje");
ok(S.precos.ITSA4F.v===10.5 && chamadas.some(u=>u.includes("/quote/ITSA4?")), "fracionário usa a cotação do lote");
ok(ultimaBusca.falhas.join()==="FAKECOIN,XPTO3" || ultimaBusca.falhas.sort().join()==="FAKECOIN,XPTO3", "lista o que ficou sem cotação: "+ultimaBusca.falhas.join());
ok(!("CDB Y" in S.precos) && !chamadas.some(u=>u.includes("CDB")), "renda fixa não é consultada");
ok(S.hist.length===1 && mem[LS_BUSCA], "registra o patrimônio do dia e a hora da busca");
ok(/4 cotações atualizadas\\. Sem cotação: /.test(avisos2[0]||""), "resumo da busca manual: "+avisos2[0]);

ok(!JSON.stringify(S).includes("chave-boa") && !JSON.stringify(DOCS.carteira(S)).includes("chave-boa"), "a chave não vai para o backup nem para a conta");
mem[LS_BUSCA] = String(Date.now()); ok(!precisaBuscar(), "não busca de novo antes de 30 minutos");
mem[LS_BUSCA] = String(Date.now()-31*60*1000); ok(precisaBuscar(), "busca de novo depois de 30 minutos");

globalThis.__fetch = ()=>Promise.reject(new TypeError("Failed to fetch")); avisos2 = [];
const antes = JSON.stringify(S.precos);
await atualizarCotacoes({auto:true});
ok(ultimaBusca.erro==="rede" && JSON.stringify(S.precos)===antes && avisos2.length===0, "sem rede não muda nada e não incomoda na busca automática");
await atualizarCotacoes();
ok(/Não foi possível acessar/.test(avisos2[0]||""), "sem rede avisa na busca manual");

const elA = fakeEl(); rAtivos(elA);
ok(/Atualizar cotações/.test(elA.innerHTML) && /Chave da brapi configurada/.test(elA.innerHTML) && /Última busca hoje às/.test(elA.innerHTML), "aba Ativos mostra botão, chave e última busca");

entrarDemo(); chamadas = []; globalThis.__fetch = mercado;
await atualizarCotacoes(); ok(chamadas.length===0, "modo exemplo não consulta cotações"); sairDemo();

// busca começa na carteira real e o modo exemplo abre no meio dela
let soltar; globalThis.__fetch = url => new Promise(r=>{ soltar = ()=>r(mercado(url)); });
delete S.precos.BTC; mem[LS_CHAVE] = "";
const busca = atualizarCotacoes(); entrarDemo(); soltar(); await busca;
ok(S.precos.BTC.v===345000 && realGuardado.precos.BTC && realGuardado.precos.BTC.v===430325, "cotação que chega no modo exemplo vai para a carteira real");
sairDemo();

// 9. backup fora do claude.ai baixa o arquivo; CSV no padrão brasileiro
delete window.claude;   // a seção de sincronização deixou um claude falso
globalThis.__baixados = []; let blobs = [];
const criarURL = URL.createObjectURL; URL.createObjectURL = b => { blobs.push(b); return "blob:teste"; };
await baixar("lancamentos-teste.csv", csvLanc());
const bytes = new Uint8Array(await blobs[0].arrayBuffer()), csvTxt = await blobs[0].text();   // text() descarta o BOM
ok(__baixados.length===1 && __baixados[0].nome==="lancamentos-teste.csv" && /Arquivo baixado/.test($("#backup-msg").textContent), "fora do claude.ai o backup é baixado direto");
ok(bytes[0]===0xEF && bytes[1]===0xBB && bytes[2]===0xBF && /;0,01;300000;/.test(csvTxt) && csvTxt.split("\\n")[0]==="data;classe;ativo;operacao;quantidade;preco;taxas;valor", "CSV com BOM, ponto e vírgula e vírgula decimal");
window.claude = { use: async ()=>{ throw new Error("sem downloads"); } };
__baixados = []; await baixar("x.json", "{}");
ok(__baixados.length===0 && $("#backup-area").value==="{}", "no claude.ai sem serviço de downloads, mostra a caixa de texto");
delete window.claude; URL.createObjectURL = criarURL;

// 10. edição de lançamentos
S = vazio(); S.atualizado = 1; editando = null;
add({classe:"acao",tipo:"compra",data:"2025-01-10",ticker:"PETR4",qtd:"100",preco:"30"});
add({classe:"acao",tipo:"venda",data:"2025-03-01",ticker:"PETR4",qtd:"80",preco:"35"});
const compraP = S.txs[0], vendaP = S.txs[1];
const editar = (tx, v) => { editarTx(tx.id); salvarEdicao(form(Object.assign({classe:tx.classe, tipo:tx.tipo, data:tx.data, ticker:tx.ticker, qtd:String(tx.qtd||""), preco:String(tx.preco||""), taxas:"", valor:String(tx.valor||"")}, v))); };

editar(compraP, {qtd:"50"});
ok(S.txs[0].qtd===100 && /Com essa alteração, a venda de PETR4 em 01\\/03\\/2025 ficaria sem saldo/.test(msg()), "não deixa a compra ficar menor que a venda posterior: "+msg());
ok(editando===compraP.id, "edição recusada continua aberta");
editar(compraP, {qtd:"120", preco:"31"});
const c1 = S.txs.find(t=>t.id===compraP.id);
ok(c1.qtd===120 && c1.preco===31 && c1.criado===compraP.criado && S.txs.length===2 && editando===null, "salva a alteração mantendo id e ordem de criação");
ok(Math.abs(calcular().lista.find(p=>p.ticker==="PETR4").pm-31)<1e-9 && /atualizado/.test(msg()), "preço médio recalculado depois da edição");
editar(vendaP, {qtd:"130"});
ok(S.txs.find(t=>t.id===vendaP.id).qtd===80 && /Você tinha 120 de PETR4/.test(msg()), "venda editada não passa do saldo: "+msg());
editar(vendaP, {data:"2025-01-05"});
ok(S.txs.find(t=>t.id===vendaP.id).data==="2025-03-01" && /Você tinha 0 de PETR4/.test(msg()), "venda não pode ir para antes da compra");

// código corrigido leva cotação e proventos junto
add({classe:"acao",tipo:"compra",data:"2025-02-01",ticker:"ITSA3",qtd:"10",preco:"9"});
const itsa = S.txs.find(t=>t.ticker==="ITSA3");
S.precos.ITSA3 = {v:10, em:"2025-02-02"}; S.provs.push({id:"pv",data:"2025-02-20",ticker:"ITSA3",tipo:"dividendo",valor:5});
editar(itsa, {ticker:"itsa4"});
ok(S.txs.find(t=>t.id===itsa.id).ticker==="ITSA4" && S.precos.ITSA4.v===10 && !S.precos.ITSA3 && S.provs[0].ticker==="ITSA4" && !S.ativos.ITSA3 && S.ativos.ITSA4, "corrigir o código move cotação e proventos");
editar(S.txs.find(t=>t.id===itsa.id), {classe:"fii", ticker:"PETR4"});
ok(S.txs.find(t=>t.id===itsa.id).ticker==="ITSA4" && /PETR4 já está cadastrado como Ações/.test(msg()), "não mistura classes no mesmo código: "+msg());
editar(compraP, {classe:"etf"});
ok(/PETR4 já está cadastrado como Ações/.test(msg()), "não troca a classe se outros lançamentos do código são de outra");

// renda fixa: data e valor; o valor atual do título acompanha a diferença
add({classe:"rf",tipo:"compra",data:"2025-01-02",ticker:"CDB Z",valor:"1000"});
const apl = S.txs.find(t=>t.ticker==="CDB Z"); S.precos["CDB Z"] = {v:1100, em:"2025-06-01"};
add({classe:"rf",tipo:"venda",data:"2025-07-01",ticker:"CDB Z",valor:"550"});
const resg = S.txs.find(t=>t.ticker==="CDB Z" && t.tipo==="venda");
ok(Math.abs(resg.frac-0.5)<1e-9 && Math.abs(S.precos["CDB Z"].v-550)<0.01, "resgate de metade do título");
editar(apl, {valor:"1500"});
ok(S.txs.find(t=>t.id===apl.id).valor===1500 && Math.abs(S.precos["CDB Z"].v-1050)<0.01, "aplicação maior soma a diferença ao valor atual");
editar(resg, {valor:"275"});
const r2 = S.txs.find(t=>t.id===resg.id);
ok(Math.abs(r2.frac-0.25)<1e-9 && Math.abs(S.precos["CDB Z"].v-1325)<0.01, "resgate menor baixa proporção menor e devolve a diferença ao título");
editar(resg, {tipo:"compra"});
ok(S.txs.find(t=>t.id===resg.id).tipo==="venda" && /Na renda fixa dá para mudar a data e o valor/.test(msg()), "renda fixa não troca a operação");
editar(apl, {classe:"acao", qtd:"1", preco:"1"});
ok(/Para trocar entre renda fixa/.test(msg()), "não converte renda fixa em outro tipo");

// estado da edição
editarTx(compraP.id); irPara("resumo"); ok(editando===null, "sair da aba descarta a edição");
editarTx(vendaP.id); delTx(vendaP.id); ok(editando===null && !S.txs.some(t=>t.id===vendaP.id), "excluir o lançamento em edição encerra a edição");
entrarDemo(); editando = S.txs[0].id; const antesDemo = JSON.stringify(S.txs);
salvarEdicao(form({classe:"acao",tipo:"compra",data:"2020-01-01",ticker:"AAAA3",qtd:"1",preco:"1",taxas:"",valor:""}));
ok(JSON.stringify(S.txs)===antesDemo && /modo exemplo/.test(msg()), "modo exemplo não edita"); sairDemo(); editando = null;

// 11. comparação com CDI e Ibovespa
const perto = (a,b,tol=0.01) => Math.abs(a-b) < tol;
// CDI: 1000 no dia 1 rende 1% nos dias 1 e 2; no dia 3 sai 500 e o resto rende 1%
let sim = simularCDI([{data:"2026-01-01",v:1000},{data:"2026-01-03",v:-500}], {"2026-01-01":1,"2026-01-02":1,"2026-01-03":1,"2025-12-31":5});
ok(perto(sim.saldo, (1000*1.01*1.01*1.01 - 500*1.01)), "CDI: aporte rende no dia, retirada sai antes de render, ignora dias antes do início: "+sim.saldo.toFixed(4));
ok(perto(valorEm(sim.pontos)("2026-01-02"), 1020.1) && valorEm(sim.pontos)("2025-12-01")===null, "linha do CDI por data");
// Ibovespa: 1000 a 100 pontos = 10 cotas; 550 a 110 = 5 cotas; vende 330 a 110 = -3 cotas; fecha a 120
let ib = simularIbov([{data:"2026-01-02",v:1000},{data:"2026-01-05",v:550},{data:"2026-01-06",v:-330}], {"2026-01-02":100,"2026-01-05":110,"2026-01-07":120});
ok(perto(ib.saldo, 12*120) && !ib.aproximado, "Ibovespa por cotas, usando o último fechamento antes do dia: "+ib.saldo);
ib = simularIbov([{data:"2025-06-01",v:1000}], {"2026-01-02":100,"2026-01-05":120});
ok(perto(ib.saldo, 1200) && ib.aproximado && ib.desde==="2026-01-02", "aporte antes do histórico vira aproximado na primeira data");

// Um teste anterior deixou um fetch simulado que nunca responde; começa limpo
buscandoIndices = false; delete mem[LS_INDICES];
S = vazio(); S.atualizado = 1; indices = lerIndices();
add({classe:"acao",tipo:"compra",data:"2026-03-02",ticker:"PETR4",qtd:"10",preco:"10",taxas:"1"});
add({classe:"acao",tipo:"venda",data:"2026-03-04",ticker:"PETR4",qtd:"5",preco:"12",taxas:"1"});
S.provs.push({id:"p1",data:"2026-03-05",ticker:"PETR4",tipo:"dividendo",valor:2});
ok(JSON.stringify(fluxosCaixa())===JSON.stringify([{data:"2026-03-02",v:101},{data:"2026-03-04",v:-59},{data:"2026-03-05",v:-2}]), "fluxos: compra com taxas, venda líquida e provento");

// busca: BCB em janelas de 10 anos, brapi do maior intervalo que o plano aceitar
chamadas = [];
globalThis.__fetch = url => {
  chamadas.push(url);
  if(url.includes("bcb.gov.br")) return resp(200, [{data:"02/03/2026",valor:"0.05"},{data:"03/03/2026",valor:"0.05"},{data:"04/03/2026",valor:"0.05"}]);
  if(url.includes("BVSP")){
    if(!url.includes("range=3mo")) return resp(400, {error:true, message:"plano não permite"});
    return resp(200, {results:[{historicalDataPrice:[{date:Date.UTC(2026,2,2,15)/1000, close:130000},{date:Date.UTC(2026,2,6,15)/1000, close:136500}]}]});
  }
  return resp(404, {});
};
mem[LS_CHAVE] = "chave-boa";
await atualizarIndices();
ok(chamadas.filter(u=>u.includes("bcb")).length===1 && chamadas[0].includes("dataInicial=02/03/2026"), "CDI busca desde o primeiro aporte");
ok(chamadas.filter(u=>u.includes("BVSP")).map(u=>u.match(/range=(\\w+)/)[1]).join()==="max,5y,1y,3mo", "Ibovespa tenta do maior intervalo para o menor");
ok(indices.cdi.serie["2026-03-03"]===0.05 && indices.ibov.serie["2026-03-06"]===136500 && JSON.parse(mem[LS_INDICES]).cdi.desde==="2026-03-02", "séries guardadas no navegador");
chamadas = []; await atualizarIndices();
ok(chamadas.length===0, "não busca de novo no mesmo dia");
const cp = comparacao();
ok(cp && cp.desde==="2026-03-02" && cp.cdi && cp.ibov && perto(cp.ibov.saldo, (101-59-2)/130000*136500), "comparação junta CDI e Ibovespa");
const elR = fakeEl(); abaAtual = "ir"; rResumo(elR);
ok(/No CDI/.test(elR.innerHTML) && /No Ibovespa/.test(elR.innerHTML) && /desde 02\\/03\\/2026/.test(elR.innerHTML), "Resumo mostra a comparação");
// sem rede: fica com o que está guardado
indices.cdi.ate = "2000-01-01"; globalThis.__fetch = ()=>Promise.reject(new TypeError("offline"));
await atualizarIndices();
ok(indices.cdi.serie["2026-03-03"]===0.05 && buscandoIndices===false, "sem rede mantém as séries e libera nova busca");
mem[LS_CHAVE] = "";

// 12. análises por regras e resumo com IA
buscandoIndices = false; delete mem[LS_INDICES]; indices = lerIndices(); delete mem[LS_BACKUP];
S = vazio(); S.atualizado = 1;
const hj = hojeISO(), mesAtual = hj.slice(0,7), dAnt = somarDias(mesAtual+"-01", -10), d200 = somarDias(hj, -200);
add({classe:"acao",tipo:"compra",data:d200,ticker:"PETR4",qtd:"1000",preco:"30"});
add({classe:"acao",tipo:"compra",data:d200,ticker:"VALE3",qtd:"300",preco:"70"});
add({classe:"fii",tipo:"compra",data:d200,ticker:"HGLG11",qtd:"50",preco:"160"});
add({classe:"rf",tipo:"compra",data:d200,ticker:"CDB W",valor:"20000"});
add({classe:"acao",tipo:"venda",data:dAnt,ticker:"VALE3",qtd:"300",preco:"80"});           // 24 mil no mês passado: paga IR
add({classe:"acao",tipo:"venda",data:hj,ticker:"PETR4",qtd:"500",preco:"34"});             // 17 mil neste mês: perto do limite
S.precos = { PETR4:{v:34.56,em:hj}, HGLG11:{v:150,em:somarDias(hj,-10)}, "CDB W":{v:21000,em:somarDias(hj,-90)} };
S.metas = {acao:20,etf:0,fii:30,rf:50,cripto:0};
S.provs.push({id:"q1",data:somarDias(hj,-40),ticker:"HGLG11",tipo:"rendimento",valor:400});
const leit = analisar(), achar = r => leit.find(i=>r.test(i.titulo));
ok(achar(/PETR4 é \\d+% da carteira/) && achar(/PETR4 é/).nivel==="atencao", "concentração acima de 20%: "+(achar(/PETR4 é/)||{}).titulo);
ok(achar(/Renda fixa abaixo da meta/) || achar(/Ações acima da meta/), "distância da meta");
ok(achar(/cotação antiga/) && /HGLG11/.test(achar(/cotação antiga/).detalhe) && !/PETR4/.test(achar(/cotação antiga/).detalhe), "cotação antiga só de quem passou de 3 dias");
ok(achar(/valor da renda fixa/) && /CDB W/.test(achar(/valor da renda fixa/).detalhe), "renda fixa sem atualização há mais de 45 dias");
ok(achar(/perto do limite de isenção/) && /faltam R\\$/.test(achar(/perto do limite/).detalhe), "vendas de ações perto dos 20 mil");
ok(achar(/^DARF de R\\$\\s.* vence em/), "DARF do mês passado a vencer: "+(achar(/^DARF/)||{}).titulo);
ok(achar(/Proventos de .* sobre o custo/), "proventos dos últimos 12 meses");
ok(achar(/Nenhum backup/) && achar(/Nenhum backup/).acao.act==="backup", "lembra do backup");
ok(leit.findIndex(i=>i.nivel!=="atencao") > leit.map(i=>i.nivel).lastIndexOf("atencao"), "atenção vem primeiro");
mem[LS_BACKUP] = String(Date.now()); ok(!analisar().some(i=>/backup/i.test(i.titulo)), "backup recente some da lista");

const dIA = dadosParaIA(), jIA = JSON.stringify(dIA), totalAgora = calcular().total;
ok(!/R\\$/.test(jIA) && !jIA.includes(String(Math.round(totalAgora))) && !jIA.includes(brl(totalAgora).replace("R$","").trim()), "dados para a IA sem valores em reais");
ok(dIA.posicoes[0].ativo && typeof dIA.posicoes[0].peso_pct==="number" && dIA.leituras.length>0, "dados para a IA com pesos e leituras");

let corpoIA = null; chamadas = [];
globalThis.__fetch = (url, op={}) => {
  chamadas.push(url);
  if(url.endsWith("/models")) return op.headers.Authorization==="Bearer gsk-boa" ? resp(200, {data:[{id:"whisper-large-v3"},{id:"llama-3.3-70b-versatile"},{id:"openai/gpt-oss-120b"}]}) : resp(401, {});
  if(url.endsWith("/chat/completions")){ corpoIA = JSON.parse(op.body); return resp(200, {choices:[{message:{content:"- **Concentração**: PETR4 pesa muito.\\n- Renda fixa abaixo da meta.\\nTexto final <script>x</script>"}}]}); }
  return resp(404, {});
};
avisos2 = []; mem[LS_GROQ] = "gsk-ruim"; await gerarResumoIA();
ok(/recusou a chave/.test(avisos2[0]||"") && !mem[LS_IA] && gerandoIA===false, "chave do Groq recusada avisa e libera");
mem[LS_GROQ] = "gsk-boa"; await gerarResumoIA();
ok(corpoIA && corpoIA.model==="openai/gpt-oss-120b", "escolhe o maior modelo de texto disponível: "+(corpoIA&&corpoIA.model));
ok(corpoIA && !/R\\$/.test(JSON.stringify(corpoIA)) && /Não recomende comprar ou vender/.test(corpoIA.messages[0].content), "requisição para o Groq sem reais e com a instrução de não recomendar");
const guardado = JSON.parse(mem[LS_IA]||"{}");
ok(guardado.modelo==="openai/gpt-oss-120b" && /PETR4/.test(guardado.texto), "guarda o último resumo");
const html = textoIA(guardado.texto);
ok(/<ul><li>Concentração: PETR4 pesa muito\\.<\\/li><li>Renda fixa abaixo da meta\\.<\\/li><\\/ul><p>Texto final &lt;script&gt;x&lt;\\/script&gt;<\\/p>/.test(html), "texto da IA vira lista e é escapado: "+html);
const elA2 = fakeEl(); rAnalises(elA2);
ok(/Atenção/.test(elA2.innerHTML) && /Gerar de novo/.test(elA2.innerHTML) && /O que vai para a IA/.test(elA2.innerHTML), "aba Análises mostra leituras, IA e o que é enviado");
ok(!JSON.stringify(S).includes("gsk-boa"), "a chave do Groq não vai para o backup");
mem[LS_GROQ] = "";

// 13. importar extrato da B3
S = vazio(); S.atualizado = 1;
const serie13 = (Date.UTC(2026,1,13) - Date.UTC(1899,11,30)) / 864e5;   // 13/02/2026 como número de série do Excel
const negociacao = [
  ["Data do Negócio","Tipo de Movimentação","Mercado","Prazo/Vencimento","Instituição","Código de Negociação","Quantidade","Preço","Valor"],
  ["05/02/2026","Compra","Mercado à Vista","-","XP INVESTIMENTOS CCTVM S/A & CIA","PETR4",100,38.5,3850],
  ["05/02/2026","Compra","Mercado à Vista","-","XP","PETR4",50,38.8,1940],
  ["06/02/2026","Compra","!Mercado Fracionário","-","XP","ITSA4F",7,10.2,71.4],
  ["10/02/2026","Compra","Mercado à Vista","-","XP","HGLG11",10,160,1600],
  ["11/02/2026","Compra","Mercado à Vista","-","XP","BOVA11",5,120,600],
  ["11/02/2026","Compra","Mercado à Vista","-","XP","TAEE11",10,35,350],
  ["12/02/2026","Venda","Opção de Compra","03/2026","XP","PETRB40",100,1.2,120],
  [serie13,"Venda","Mercado à Vista","-","XP","PETR4",20,40,800],
  ["","","","","","","","",""]
];
for(const compactar of [true, false]){
  const lin = await lerXLSX(criarXLSX(negociacao, {compactar}));
  ok(lin.length===10 && lin[1][4]==="XP INVESTIMENTOS CCTVM S/A & CIA" && lin[3][2]==="Mercado Fracionário" && lin[8][0]===serie13, "lê o .xlsx "+(compactar?"comprimido":"sem compressão")+", textos compartilhados, inline e entidades");
}
const rN = interpretarB3(await lerXLSX(criarXLSX(negociacao)));
const petr = rN.negs.find(n=>n.ticker==="PETR4" && n.tipo==="compra");
ok(rN.tipo==="negociacao" && petr.qtd===150 && perto(petr.preco, 38.6), "junta os negócios do mesmo dia pelo preço médio");
ok(rN.negs.some(n=>n.ticker==="ITSA4" && n.qtd===7) && !rN.negs.some(n=>n.ticker==="ITSA4F"), "fracionário entra como o papel do lote");
ok(rN.ign.opcoes===1 && !rN.negs.some(n=>n.ticker==="PETRB40"), "opções ficam de fora");
ok(rN.negs.some(n=>n.ticker==="PETR4" && n.tipo==="venda" && n.data==="2026-02-13"), "data como número de série do Excel");
let imp = prepararImportacao(rN);
ok(imp.novos.join()==="BOVA11,HGLG11,ITSA4,PETR4,TAEE11" && imp.classes.BOVA11==="etf" && imp.classes.HGLG11==="fii" && imp.classes.TAEE11==="acao" && imp.classes.PETR4==="acao", "sugere a classe: ETF conhecido, unit, FII e ação");
imp.classes.HGLG11 = "fii";
let rA = aplicarImportacao(imp);
ok(rA.negs===6 && !rA.inconsistente && S.txs.every(t=>t.taxas===0) && S.ativos.BOVA11.classe==="etf" && calcular().lista.find(p=>p.ticker==="PETR4").qtd===130, "importa compras e vendas com taxas zeradas");
imp = prepararImportacao(interpretarB3(await lerXLSX(criarXLSX(negociacao))));
ok(imp.negs.length===0 && imp.duplicados===6 && imp.novos.length===0, "importar de novo não duplica");

const movimentacao = [
  ["Entrada/Saída","Data","Movimentação","Produto","Instituição","Quantidade","Preço unitário","Valor da Operação"],
  ["Credito","20/03/2026","Dividendo","PETR4 - PETROLEO BRASILEIRO S.A. PETROBRAS","XP",150,0.5,75],
  ["Credito","25/03/2026","Juros Sobre Capital Próprio","PETR4 - PETROBRAS","XP",150,0.3,"38,25"],
  ["Credito","15/03/2026","Rendimento","HGLG11 - CGHG LOGISTICA","XP",10,1.1,11],
  ["Credito","15/03/2026","Rendimento","MXRF11 - MAXI RENDA","XP",10,0.1,1],
  ["Credito","05/02/2026","Transferência - Liquidação","PETR4 - PETROBRAS","XP",100,38.5,3850],
  ["Credito","01/04/2026","Desdobro","ITSA4 - ITAUSA","XP",7,"-","-"],
  ["Debito","20/03/2026","Dividendo","PETR4 - PETROBRAS","XP",150,0.5,75]
];
const rM = interpretarB3(await lerXLSX(criarXLSX(movimentacao)));
ok(rM.tipo==="movimentacao" && rM.provs.length===4 && rM.ign.liquidacoes===1 && rM.ign.eventos.length===1 && /Desdobro de ITSA4 em 01\\/04\\/2026/.test(rM.ign.eventos[0]), "movimentação: proventos, liquidação e evento separados");
ok(rM.provs.some(p=>p.tipo==="jcp" && perto(p.valor,38.25)) && rM.provs.some(p=>p.tipo==="rendimento" && p.ticker==="HGLG11"), "JCP com vírgula decimal e rendimento de FII");
imp = prepararImportacao(rM);
ok(imp.provs.length===3 && imp.semAtivo.join()==="MXRF11", "provento sem compra registrada fica de fora");
rA = aplicarImportacao(imp);
ok(rA.provs===3 && S.provs.filter(p=>p.ticker==="PETR4").length===2, "importa os proventos");
ok(prepararImportacao(rM).provs.length===0, "proventos não duplicam");

const csv = "﻿Data do Negócio;Tipo de Movimentação;Mercado;Prazo/Vencimento;Instituição;Código de Negociação;Quantidade;Preço;Valor\\r\\n02/03/2026;Compra;Mercado à Vista;-;\\"Banco \\"\\"X\\"\\"; S.A.\\";VALE3;10;\\"62,50\\";\\"625,00\\"\\r\\n";
const lCSV = lerCSV(csv);
ok(lCSV.length===2 && lCSV[1][4]==='Banco "X"; S.A.' && interpretarB3(lCSV).negs[0].preco===62.5, "CSV com ponto e vírgula, aspas e vírgula decimal");
let erroArq = ""; try{ await lerXLSX(new TextEncoder().encode("isto não é zip").buffer); }catch(e){ erroArq = e.message; }
ok(/não é uma planilha Excel/.test(erroArq), "arquivo que não é xlsx dá mensagem clara");
erroArq = ""; try{ interpretarB3([["a","b"],["1","2"]]); }catch(e){ erroArq = e.message; }
ok(/Não reconheci o arquivo/.test(erroArq), "planilha que não é da B3 dá mensagem clara");

importacao = null; $("#imp-res").innerHTML = "";
await lerArquivoB3({name:"negociacao.xlsx", arrayBuffer: async()=>criarXLSX([negociacao[0], ["03/03/2026","Compra","Mercado à Vista","-","XP","KNRI11",3,150,450]])});
ok(importacao && importacao.novos.join()==="KNRI11" && /1<\\/strong> compra ou venda nova/.test($("#imp-res").innerHTML) && /select class="imp-classe" data-t="KNRI11"/.test($("#imp-res").innerHTML), "prévia mostra o que entra e pede a classe dos novos");
entrarDemo(); await lerArquivoB3({name:"x.xlsx", arrayBuffer: async()=>criarXLSX(negociacao)});
ok(/modo exemplo/.test($("#imp-res").innerHTML), "modo exemplo não importa"); sairDemo();

// 14. app Android (Capacitor): backup vai para a folha de compartilhar
let gravado = null, compartilhado = null;
window.Capacitor = { isNativePlatform: ()=>true, Plugins: {
  Filesystem: { writeFile: async o => { gravado = o; return {uri:"file:///cache/"+o.path}; } },
  Share: { share: async o => { compartilhado = o; } } } };
__baixados = [];
await baixar("lancamentos-x.csv", "a;b");
ok(gravado && gravado.directory==="CACHE" && gravado.data.charCodeAt(0)===0xFEFF && compartilhado.files[0]==="file:///cache/lancamentos-x.csv" && __baixados.length===0, "no app, o backup é gravado e compartilhado em vez de baixado");
ok(/Escolha onde guardar/.test($("#backup-msg").textContent), "mensagem do backup no app");
window.Capacitor.Plugins.Share.share = async ()=>{ throw new Error("Share canceled"); };
await baixar("x.json", "{}");
ok(/cancelado/.test($("#backup-msg").textContent), "cancelar o compartilhamento não mostra erro");
delete window.Capacitor;

// resumo com IA sem chave própria: vai pela função do GenFin na Vercel
mem[LS_GROQ] = ""; delete mem[LS_IA]; iaSemServidor = false; avisos2 = []; let pedidoServ = null;
globalThis.__fetch = (url, op={}) => { pedidoServ = {url, corpo: JSON.parse(op.body||"null")}; return resp(503, {erro:"sem_chave"}); };
await gerarResumoIA();
ok(pedidoServ && pedidoServ.url==="https://genfin-rose.vercel.app/api/resumo" && pedidoServ.corpo.modo==="resumo" && Array.isArray(pedidoServ.corpo.dados.leituras) && !/R\\$/.test(JSON.stringify(pedidoServ.corpo)), "sem chave, chama a função do GenFin com os dados sem reais: "+(pedidoServ&&pedidoServ.url));
ok(iaSemServidor && /ainda não foi configurada/.test(avisos2[0]||"") && !mem[LS_IA] && gerandoIA===false, "servidor sem chave: avisa e oferece a chave própria");
globalThis.__fetch = () => resp(200, {texto:"- Tudo certo por aqui.", modelo:"openai/gpt-oss-120b"});
await gerarResumoIA();
ok(JSON.parse(mem[LS_IA]||"{}").texto==="- Tudo certo por aqui.", "resumo pelo servidor é guardado");
globalThis.__fetch = () => resp(429, {erro:"limite"}); avisos2 = [];
await gerarResumoIA(); ok(/limite/.test(avisos2[0]||""), "limite do servidor avisa");

// a chave da brapi pode ser configurada antes do primeiro lançamento
{ const guardaS = S; S = vazio(); mem[LS_CHAVE] = ""; const elV = fakeEl(); rAtivos(elV);
  ok(/Nenhuma posição aberta/.test(elV.innerHTML) && /Configurar a chave da brapi/.test(elV.innerHTML) && /<details class="chave" open>/.test(elV.innerHTML), "carteira vazia já mostra a configuração da chave da brapi");
  S = guardaS; }

// números no jeito brasileiro: ponto como milhar quando o formato é de milhar
ok([["78.000",78000],["1.234.567",1234567],["62.000,00",62000],["38.50",38.5],["0.005",0.005],["38,50",38.5],["R$ 45.000",45000]].every(([s,v])=>parseNum(s)===v), "ponto de milhar sem vírgula é milhar; decimal com ponto continua decimal");

// 15. inventário
S = vazio(); S.atualizado = 1; editandoBem = null;
const formBem = v => ({ elements:{ namedItem:n => n==="declarar" ? {checked:!!v.declarar} : {value: v[n]??""} } });
const bemMsg = () => $("#bem-msg").textContent;
salvarBem(formBem({nome:"", categoria:"veiculo", valor:"10"}));
ok(!S.bens.length && /Informe o nome/.test(bemMsg()), "bem sem nome é recusado");
salvarBem(formBem({nome:"Carro", categoria:"veiculo", valor:"x"}));
ok(!S.bens.length && /vale hoje/.test(bemMsg()), "bem sem valor é recusado");
salvarBem(formBem({nome:"  Carro   prata ", categoria:"veiculo", valor:"62.000,00", custo:"78.000", compra:"2024-03-10", divida:"21.000", obs:"placa ABC1D23", declarar:true}));
const carro = S.bens[0];
ok(carro && carro.nome==="Carro prata" && carro.valor===62000 && carro.custo===78000 && carro.divida===21000 && carro.declarar && carro.valorEm===hojeISO(), "adiciona o bem com os campos");
salvarBem(formBem({nome:"Dinheiro guardado", categoria:"dinheiro", valor:"1500"}));
ok(S.bens[1].custo===null && S.bens[1].divida===0 && !S.bens[1].declarar, "campos opcionais vazios");
add({classe:"acao",tipo:"compra",data:"2026-01-05",ticker:"PETR4",qtd:"100",preco:"30"});
let tb = totaisBens();
ok(tb.valor===63500 && tb.dividas===21000 && tb.liquido===42500 && patrimonioTotal()===calcular().total+42500, "totais: bens, dívidas e patrimônio total");
carro.valorEm = "2020-01-01"; editandoBem = carro.id;
salvarBem(formBem({nome:"Carro prata", categoria:"veiculo", valor:"62.000", custo:"78000", compra:"2024-03-10", divida:"18.000", obs:"", declarar:true}));
ok(S.bens.length===2 && carro.divida===18000 && carro.valorEm==="2020-01-01" && editandoBem===null && /atualizado/.test(bemMsg()), "editar sem mudar o valor mantém a data do valor");
ok(analisar().some(i=>/Atualize o valor de 1 bem/.test(i.titulo)), "análise avisa valor de bem com mais de um ano");
atualizarValorBem({dataset:{id:carro.id}, value:"58.500,00"});
ok(carro.valor===58500 && carro.valorEm===hojeISO() && !analisar().some(i=>/Atualize o valor/.test(i.titulo)), "atualizar o valor na lista renova a data");
const elInv = fakeEl(); rInventario(elInv);
ok(/Patrimônio total/.test(elInv.innerHTML) && /Carro prata/.test(elInv.innerHTML) && /placa|valbem/.test(elInv.innerHTML), "aba Inventário mostra totais e bens");
anoIR = "2026"; const elIRb = fakeEl(); rIR(elIRb);
ok(/Outros bens do inventário/.test(elIRb.innerHTML) && /Carro prata/.test(elIRb.innerHTML) && /veículo automotor/.test(elIRb.innerHTML) && !/Dinheiro guardado/.test(elIRb.innerHTML), "IR lista só os bens marcados para declarar");
ok(JSON.stringify(DOCS.bens(S).itens.map(b=>b.nome))==='["Carro prata","Dinheiro guardado"]' && TODOS_DOCS.includes("bens"), "bens vão para a conta e para o backup");
const recarregado = vazio(); aplicarDocs(recarregado, {bens: DOCS.bens(S)}); ok(recarregado.bens.length===2, "bens voltam da conta");
excluirBem(S.bens[1].id); ok(S.bens.length===1, "exclui o bem");
const elRes = fakeEl(); abaAtual="ir"; rResumo(elRes);
ok(/Investimentos hoje/.test(elRes.innerHTML) && /patrimônio total é/.test(elRes.innerHTML), "Resumo mostra o patrimônio total quando há bens");

// 20. Desdobramento e grupamento
{
  S = vazio(); S.atualizado = 1; avisos2 = [];
  const campos = v => Object.entries(v).forEach(([k,x])=>{ $("#"+k).value = x; });
  add({classe:"acao",tipo:"compra",data:"2026-01-05",ticker:"ITSA4",qtd:"100",preco:"10"});
  add({classe:"acao",tipo:"compra",data:"2026-03-05",ticker:"ITSA4",qtd:"15",preco:"6"});
  S.precos.ITSA4 = {v:12, em:"2026-01-20"};   // cotação de antes do desdobramento
  abrirOp("evento", "ITSA4");
  ok(op && op.modo==="evento" && !op.buscando, "folha do evento abre sem buscar cotação");
  campos({"op-de":"1", "op-para":"2", "op-data":"2026-02-01"}); atualizarOp();
  const prev = () => $("#op-previa").innerHTML;
  ok(!$("#op-ok").disabled && /100 ações passam a ser 200/.test(prev()) && /de R\\$\\s10,00 para R\\$\\s5,00/.test(prev()) && !/fração/.test(prev()), "prévia do desdobramento: quantidade e preço médio na data");
  confirmarOp();
  let p = calcular().lista.find(x=>x.ticker==="ITSA4");
  ok(p.qtd===215 && Math.abs(p.custo-1090)<1e-6 && S.precos.ITSA4.v===6, "desdobramento dobra a quantidade, mantém o custo e corrige a cotação antiga");
  ok(/Desdobramento de ITSA4 registrado: agora são 215/.test(avisos2.pop()||""), "aviso do desdobramento");
  add({classe:"acao",tipo:"venda",data:"2026-04-01",ticker:"ITSA4",qtd:"210",preco:"7"});
  ok(calcular().lista.find(x=>x.ticker==="ITSA4").qtd===5, "venda depois do desdobramento usa a quantidade nova");
  const ev = S.txs.find(t=>t.tipo==="desdobro"); delTx(ev.id);
  ok(S.txs.includes(ev), "não exclui o desdobramento se a venda depois ficaria sem saldo");
  ok(fluxosCaixa().every(x=>Number.isFinite(x.v)) && fluxosCaixa().length===3, "desdobramento não entra no fluxo de dinheiro (comparação com CDI)");

  S = vazio(); S.atualizado = 1;
  add({classe:"fii",tipo:"compra",data:"2026-01-05",ticker:"MXRF11",qtd:"105",preco:"10"});
  abrirOp("evento", "MXRF11"); op.ev = "grupamento";
  campos({"op-de":"1", "op-para":"2", "op-data":"2026-02-01"}); atualizarOp();
  ok($("#op-ok").disabled, "grupamento com a proporção ao contrário fica bloqueado");
  campos({"op-de":"10", "op-para":"1"}); atualizarOp();
  ok(/105 cotas passam a ser 10/.test(prev()) && /fração de 0,5/.test(prev()) && /de R\\$\\s10,00 para R\\$\\s100,00/.test(prev()), "grupamento: fração vai a leilão e o preço médio sobe");
  confirmarOp();
  p = calcular().lista.find(x=>x.ticker==="MXRF11");
  ok(p.qtd===10 && Math.abs(p.custo-1000)<1e-6 && vendaSemSaldo(S.txs)===null, "grupamento: quantidade inteira e sai o custo da fração");
  campos({"op-de":"1", "op-para":"2", "op-data":"2025-12-01"}); abrirOp("evento", "MXRF11"); campos({"op-de":"1", "op-para":"2", "op-data":"2025-12-01"}); atualizarOp();
  ok($("#op-ok").disabled && /não tinha MXRF11/.test(prev()), "evento antes da primeira compra fica bloqueado");
  op = null;
  const elL = fakeEl(); rLancamentos(elL);
  const linhaG = elL.innerHTML.split("<tr>").find(l=>l.includes("Grupamento 10:1")) || "";
  ok(linhaG && /data-act="del-tx"/.test(linhaG) && !/edit-tx/.test(linhaG), "lançamentos mostram o grupamento, só com Excluir");
  ok(/grupamento;10:1/.test(csvLanc()), "CSV traz o grupamento com a proporção");
  const elA = fakeEl(); abertoAtivo = "MXRF11"; rAtivos(elA); abertoAtivo = null;
  ok(/data-act="op-evento" data-t="MXRF11"/.test(elA.innerHTML), "detalhes do ativo têm o botão de desdobramento");
}

// 19. Notícias: manchetes dos ativos, cache, contador e tela
{
  S = vazio(); S.atualizado = 1; delete mem[LS_NOTICIAS]; delete mem[LS_NOT_VISTO]; buscandoNoticias = false; filtroNoticias = "todos";
  add({classe:"acao",tipo:"compra",data:"2026-01-05",ticker:"PETR4",qtd:"100",preco:"30"});
  add({classe:"cripto",tipo:"compra",data:"2026-01-05",ticker:"BTC",qtd:"0,1",preco:"300000"});
  add({classe:"rf",tipo:"compra",data:"2026-01-05",ticker:"CDB N",valor:"1000"});
  const agoraIso = new Date().toISOString(), antes = new Date(Date.now()-3*3600e3).toISOString();
  let buscas = [];
  globalThis.__fetch = url => { buscas.push(decodeURIComponent(url.split("q=")[1]||"")); return resp(200, {itens: url.includes("Bitcoin") ?
    [{titulo:"Bitcoin sobe", fonte:"Portal", link:"https://news.google.com/rss/articles/X1", data:antes}]
    : [{titulo:"Petrobras anuncia JCP", fonte:"ISTOÉ", link:"https://news.google.com/rss/articles/P1", data:agoraIso}, {titulo:"Bitcoin sobe", fonte:"Outro", link:"https://news.google.com/rss/articles/P2", data:antes}]}); };
  await carregarNoticias();
  ok(buscas.sort().join("|")==="Bitcoin|PETR4" && !buscas.some(b=>/CDB/.test(b)), "busca as notícias dos ativos de renda variável (cripto pelo nome)");
  const feed = feedNoticias();
  ok(feed.length===2 && feed[0].titulo==="Petrobras anuncia JCP" && feed[0].ticker==="PETR4" && feed[1].titulo==="Bitcoin sobe", "feed junta, tira repetidas e ordena das mais novas");
  ok(noticiasNovas()===2 && $("#cont-noticias").textContent==="2" && $("#cont-noticias").hidden===false, "contador mostra as notícias novas");
  buscas = []; await carregarNoticias();
  ok(buscas.length===0, "não busca de novo antes de 30 minutos");
  abaAtual = "noticias"; const elN = fakeEl(); rNoticias(elN);
  ok(/Petrobras anuncia JCP/.test(elN.innerHTML) && elN.innerHTML.includes('href="https://news.google.com/rss/articles/P1"') && /data-act="filtro-noticias" data-k="BTC"/.test(elN.innerHTML) && noticiasNovas()===0, "aba Notícias mostra o feed com link do Google e filtro, e marca como vistas");
  filtroNoticias = "BTC"; const elN2 = fakeEl(); rNoticias(elN2);
  ok(/Bitcoin sobe/.test(elN2.innerHTML) && !/Petrobras anuncia JCP/.test(elN2.innerHTML), "filtro por ativo");
  filtroNoticias = "todos"; abaAtual = "ir";
  ok(/class="lista-noticias"/.test(htmlNoticiasResumo()) && (htmlNoticiasResumo().match(/class="noticia"/g)||[]).length===2, "bloco do Resumo com as manchetes mais novas");
  ok(tempoRelativo(antes)==="há 3 h" && tempoRelativo(agoraIso)==="agora", "tempo relativo das notícias");
  entrarDemo(); buscas = []; await carregarNoticias(); ok(buscas.length===0, "modo exemplo não busca notícias"); sairDemo();
}

// 18. IA no Resumo: manchete do dia, conversa e sugestões
{
  S = vazio(); S.atualizado = 1; mem[LS_GROQ] = ""; delete mem[LS_MANCHETE]; delete mem[LS_CONVERSA]; conversa = []; mancheteTentada = null;
  add({classe:"acao",tipo:"compra",data:"2026-01-05",ticker:"PETR4",qtd:"100",preco:"30"});
  add({classe:"fii",tipo:"compra",data:"2026-01-05",ticker:"HGLG11",qtd:"5",preco:"150"});
  S.hist = [{d:"2026-08-31", v:3600, c:3750}, {d:"2026-09-30", v:3900, c:3750}];
  S.provs.push({id:"pm", data:hojeISO().slice(0,7)+"-10", ticker:"HGLG11", tipo:"rendimento", valor:7.5});
  const d18 = dadosParaIA();
  ok(d18.evolucao.length===2 && d18.evolucao[1].resultado_pct===4 && d18.proventos_por_mes.length===12 && d18.proventos_por_mes[11].pct_do_custo===0.2 && typeof d18.ir.darf_a_pagar==="boolean" && !/R\\$/.test(JSON.stringify(d18)), "dados da IA com evolução, proventos por mês e imposto, sem reais");
  S.metas = {acao:30,etf:0,fii:70,rf:0,cripto:0};
  ok(dadosParaIA().classes.find(c=>c.classe==="Ações").diferenca_meta_pp === Math.round((dadosParaIA().classes.find(c=>c.classe==="Ações").carteira_pct-30)*10)/10, "diferença até a meta vai calculada para a IA");
  S.metas = {acao:0,etf:0,fii:0,rf:0,cripto:0};
  ok(sugestoesIA().some(q=>/Por que PETR4 pesa tanto/.test(q)) && sugestoesIA().length<=4, "sugestões saem das leituras da carteira: "+sugestoesIA().join(" | "));

  let pedidos18 = [];
  globalThis.__fetch = (url, op={}) => { const b = JSON.parse(op.body||"{}"); pedidos18.push(b); return resp(200, {texto: b.modo==="manchete" ? "Carteira concentrada em PETR4." : "- Resposta "+pedidos18.length, modelo:"openai/gpt-oss-120b"}); };
  await atualizarManchete();
  const man = JSON.parse(mem[LS_MANCHETE]||"{}");
  ok(pedidos18.length===1 && pedidos18[0].modo==="manchete" && man.texto==="Carteira concentrada em PETR4." && man.hash===hashCarteiraIA(), "manchete gerada e guardada com a versão da carteira");
  await atualizarManchete();
  ok(pedidos18.length===1, "carteira igual no mesmo dia: não pede de novo");
  add({classe:"acao",tipo:"compra",data:"2026-02-05",ticker:"VALE3",qtd:"10",preco:"60"});
  await atualizarManchete();
  ok(pedidos18.length===2, "carteira mudou: gera manchete nova");
  globalThis.__fetch = () => Promise.reject(new TypeError("offline"));
  add({classe:"acao",tipo:"compra",data:"2026-02-06",ticker:"VALE3",qtd:"1",preco:"60"});
  await atualizarManchete(); await atualizarManchete();
  ok(JSON.parse(mem[LS_MANCHETE]).texto==="Carteira concentrada em PETR4." && gerandoManchete===false, "sem internet mantém a última manchete e não insiste");
  ok(/Escrita pela IA hoje às/.test(htmlManchete()) && /manchete-atualizar/.test(htmlManchete()), "manchete mostra quando foi escrita e o botão de atualizar");

  globalThis.__fetch = (url, op={}) => { const b = JSON.parse(op.body||"{}"); pedidos18.push(b); return resp(200, {texto:"- Resposta "+pedidos18.length}); };
  pedidos18 = [];
  await perguntarIA("Por que PETR4 pesa tanto na carteira?");
  await perguntarIA("E se eu aportar em FIIs?");
  ok(conversa.length===2 && conversa[1].r==="- Resposta 2" && pedidos18[1].modo==="pergunta" && pedidos18[1].historico.length===1 && pedidos18[1].historico[0].p==="Por que PETR4 pesa tanto na carteira?", "conversa manda a pergunta com o histórico das trocas anteriores");
  ok(JSON.parse(mem[LS_CONVERSA]).length===2, "conversa fica guardada no aparelho");
  renderConversa();
  ok(/class="msg eu">E se eu aportar em FIIs\?/.test($("#ia-mensagens").innerHTML) && /Resposta 2/.test($("#ia-mensagens").innerHTML), "folha mostra as perguntas e as respostas");
  globalThis.__fetch = () => resp(429, {erro:"limite"});
  await perguntarIA("Mais uma?");
  ok(/limite/.test(conversa[2].erro||"") && JSON.parse(mem[LS_CONVERSA]).length===2, "erro aparece na conversa e não é guardado");
  await perguntarIA("   "); ok(conversa.length===3, "pergunta vazia é ignorada");
  const elR18 = fakeEl(); abaAtual = "ir"; rResumo(elR18);
  ok(/id="manchete-ia"/.test(elR18.innerHTML) && /id="f-perguntar"/.test(elR18.innerHTML) && (elR18.innerHTML.match(/class="ia-mini"/g)||[]).length>=3, "Resumo tem a manchete, a caixa de pergunta e os botões ✦");
  conversa = []; gravarConversa();
}

// 17. Ativos: compra e venda rápida pela folha do + e do −
{
  S = vazio(); S.atualizado = 1; mem[LS_CHAVE] = "chave-boa"; delete mem[LS_ULT_CLASSE];
  add({classe:"acao",tipo:"compra",data:"2026-01-05",ticker:"PETR4",qtd:"100",preco:"30"});
  S.precos.PETR4 = {v:31, em:"2026-01-10"};   // cotação velha: a folha busca a de agora
  const campos = v => Object.entries(v).forEach(([k,x])=>{ $("#"+k).value = x; });
  globalThis.__fetch = url => url.includes("brapi") ? resp(200, {results:[{regularMarketPrice:35.5}]}) : resp(404, {});
  avisos2 = [];
  abrirOp("compra", "PETR4");
  ok(op && op.modo==="compra" && op.classe==="acao" && op.buscando, "folha abre na compra e busca a cotação de agora");
  await new Promise(r=>setTimeout(r,0)); await new Promise(r=>setTimeout(r,0));
  ok(op.preco===35.5 && S.precos.PETR4.v===35.5 && S.precos.PETR4.ts, "cotação de agora entra no preço e fica guardada no ativo");
  campos({"op-qtd":"10", "op-preco":"35,50", "op-taxas":"", "op-data":""});
  atualizarOp();
  ok($("#op-ok").innerHTML==="Comprar 10 PETR4" && !$("#op-ok").disabled && /Total R\\$\\s355,00/.test($("#op-previa").innerHTML) && /Preço médio vai de R\\$\\s30,00 para R\\$\\s30,50/.test($("#op-previa").innerHTML), "prévia da compra: total e novo preço médio");
  confirmarOp();
  ok(S.txs.length===2 && S.txs[1].qtd===10 && S.txs[1].preco===35.5 && S.txs[1].data===hojeISO() && /Compra de 10 PETR4 registrada/.test(avisos2.pop()||""), "confirmar registra a compra com a data de hoje");

  abrirOp("venda", "PETR4"); op.buscando = false;
  campos({"op-qtd":"200", "op-preco":"40", "op-taxas":""}); atualizarOp();
  ok($("#op-ok").disabled && /Você tem 110/.test($("#op-previa").innerHTML), "venda acima do que tem fica bloqueada");
  campos({"op-qtd":"50", "op-preco":"40", "op-taxas":"5"}); atualizarOp();
  ok($("#op-ok").innerHTML==="Vender 50 PETR4" && /Você recebe R\\$\\s1\\.995,00/.test($("#op-previa").innerHTML) && /isentos/.test($("#op-previa").innerHTML), "prévia da venda: valor recebido, resultado e limite de isenção");
  confirmarOp();
  ok(calcular().lista.find(p=>p.ticker==="PETR4").qtd===60 && /Venda de 50 PETR4/.test(avisos2.pop()||""), "confirmar registra a venda");

  // novo ativo: código digitado, classe escolhida, primeira compra já guarda a cotação de agora
  abrirOp("novo", ""); op.classe = "fii";
  campos({"op-ticker":"knri11", "op-qtd":"3", "op-preco":"", "op-taxas":""});
  await buscarPrecoOp();
  ok(op.preco===35.5 && $("#op-preco").value==="35,5", "novo ativo busca a cotação ao informar o código");
  atualizarOp(); confirmarOp();
  ok(S.ativos.KNRI11 && S.ativos.KNRI11.classe==="fii" && S.precos.KNRI11 && S.precos.KNRI11.v===35.5 && mem[LS_ULT_CLASSE]==="fii", "novo ativo entra com a classe e a cotação de agora");

  // renda fixa: aplicar e resgatar pelo valor
  add({classe:"rf",tipo:"compra",data:"2026-01-02",ticker:"CDB Q",valor:"1000"});
  S.precos["CDB Q"] = {v:1100, em:"2026-06-01"};
  abrirOp("venda", "CDB Q");
  ok(!op.buscando, "renda fixa não busca cotação");
  campos({"op-valor":"550"}); atualizarOp();
  ok($("#op-ok").innerHTML.startsWith("Resgatar R$") && /Resgata 50,0% do título/.test($("#op-previa").innerHTML), "resgate mostra a fração do título");
  confirmarOp();
  ok(Math.abs(S.precos["CDB Q"].v-550)<0.01 && /Resgate de R\\$\\s550,00 em CDB Q/.test(avisos2.pop()||""), "resgate registrado e valor atual ajustado");

  // a lista
  const elAt = fakeEl(); filtroAtivos = "fii"; abertoAtivo = "KNRI11"; rAtivos(elAt);
  ok(/data-act="op-compra" data-t="KNRI11"/.test(elAt.innerHTML) && !/data-t="PETR4"/.test(elAt.innerHTML) && /class="ativo-det"/.test(elAt.innerHTML) && /aria-pressed="true">.*FIIs/.test(elAt.innerHTML), "filtro por classe e detalhes do ativo aberto");
  filtroAtivos = "todos"; abertoAtivo = null;
  entrarDemo(); op = null; abrirOp("compra","AAAA3"); ok(op===null, "modo exemplo não abre a folha"); sairDemo();
  mem[LS_CHAVE] = "";
}

// 16. sincronização entre dois aparelhos (cifrada), passando pela função real api/sync.js
{
  const cod = novoCodigo();
  ok(/^[A-Z2-9]{4}(-[A-Z2-9]{1,4}){6}$/.test(cod) && bytesDoCodigo(cod).length===16 && bytesDoCodigo(cod.toLowerCase().replace(/-/g," ")).every((x,i)=>x===bytesDoCodigo(cod)[i]), "código de sincronização: 128 bits, aceita minúsculas e sem traços: "+cod);
  ok(bytesDoCodigo("ABCD-0000") === null && bytesDoCodigo(cod.slice(0,-1)+"I") === null, "código com caractere fora do alfabeto ou curto é recusado");
  const c1 = await derivarSync(cod), c2 = await derivarSync(cod.toLowerCase());
  ok(c1.id===c2.id && /^[a-f0-9]{32}$/.test(c1.id) && /^[A-Za-z0-9_-]{43}$/.test(c1.token), "mesmo código gera o mesmo id e token");
  const cif = await cifrar(c1.chave, {ola:"mundo", n:[1,2,3]});
  ok(JSON.stringify(await decifrar(c2.chave, cif.iv, cif.dados))==='{"ola":"mundo","n":[1,2,3]}', "cifra e decifra com a chave derivada");
  let erroChave = ""; try{ await decifrar((await derivarSync(novoCodigo())).chave, cif.iv, cif.dados); }catch(e){ erroChave = e.tipo; }
  ok(erroChave==="codigo", "outro código não decifra");

  globalThis.__fetch = (url, op) => url.endsWith("/api/sync") ? servidorSync(op) : Promise.reject(new TypeError("offline"));
  clearTimeout(tSync); delete mem[LS_SYNC];
  // Aparelho A: carteira com um lançamento e um bem, ativa a sincronização
  S = vazio(); S.atualizado = 1;
  add({classe:"acao",tipo:"compra",data:"2026-02-02",ticker:"WEGE3",qtd:"10",preco:"40"});
  S.bens.push({id:"b1", nome:"Moto", categoria:"veiculo", valor:12000, valorEm:hojeISO(), custo:null, divida:0});
  const codA = await ativarSyncNovo();
  const arq = Object.values(blobMem.arquivos)[0];
  ok(codA && lerSync().codigo===codA && lerSync().etag && arq && !/WEGE3|Moto/.test(arq.txt), "ativar sobe a carteira cifrada (a nuvem não tem WEGE3 nem Moto em texto)");
  const aparelhoA = {S: JSON.parse(JSON.stringify(S)), sync: mem[LS_SYNC]};

  // Aparelho B: vazio, entra com o código
  S = vazio(); delete mem[LS_SYNC];
  let rB = await entrarSync("codigo-errado");
  ok(rB.erro==="codigo", "código inválido é recusado");
  rB = await entrarSync(novoCodigo());
  ok(rB.erro==="nao_existe", "código válido sem sincronização dá não existe");
  rB = await entrarSync(codA.toLowerCase());
  ok(rB.ok==="baixado" && S.txs.length===1 && S.txs[0].ticker==="WEGE3" && S.bens[0].nome==="Moto" && lerSync().codigo===codA, "aparelho B baixa a carteira de A");
  // B lança algo e sobe
  await new Promise(r=>setTimeout(r,5));
  add({classe:"acao",tipo:"compra",data:"2026-03-03",ticker:"ITSA4",qtd:"5",preco:"10"});
  clearTimeout(tSync); await enviarSync();
  const aparelhoB = {S: JSON.parse(JSON.stringify(S)), sync: mem[LS_SYNC]};

  // De volta ao A: ao abrir, puxa a versão de B
  S = aparelhoA.S; mem[LS_SYNC] = aparelhoA.sync; avisos2 = [];
  await puxarSync();
  ok(S.txs.length===2 && S.txs.some(t=>t.ticker==="ITSA4") && /outro aparelho/.test(avisos2[0]||""), "aparelho A recebe o lançamento feito em B");
  // Conflito: B grava sem saber da mudança mais nova de A
  await new Promise(r=>setTimeout(r,5));
  S.bens.push({id:"b2", nome:"Notebook", categoria:"eletronico", valor:3000, valorEm:hojeISO(), custo:null, divida:0});
  salvar("bens"); clearTimeout(tSync); await enviarSync();
  const etagDepoisDeA = lerSync().etag;
  S = aparelhoB.S; mem[LS_SYNC] = aparelhoB.sync;            // B ainda tem a ETag antiga
  await enviarSync();                                         // 409 → puxa → a de A é mais nova → aplica
  ok(S.bens.some(b=>b.nome==="Notebook") && lerSync().etag===etagDepoisDeA, "conflito: B recebe a alteração mais nova de A em vez de sobrescrever");

  // Aparelho com dados próprios entrando: pede para escolher
  const local = vazio(); local.atualizado = 5; local.txs = [{id:"z", criado:1, data:"2025-01-01", tipo:"compra", classe:"acao", ticker:"BBAS3", qtd:1, preco:1, taxas:0}];
  S = local; delete mem[LS_SYNC];
  rB = await entrarSync(codA);
  ok(rB.escolher && rB.remoto.lancamentos===2 && rB.remoto.bens===2 && !lerSync().codigo, "aparelho com dados próprios precisa escolher qual carteira vale");
  rB = await entrarSync(codA, {usar:"aqui"});
  ok(rB.ok==="enviado" && S.txs[0].ticker==="BBAS3", "escolher a deste aparelho sobe ela para a nuvem");
  const credA = await derivarSync(codA), lida = await servidorSync({body: JSON.stringify({acao:"ler", id:credA.id, token:credA.token})});
  ok((await decifrar(credA.chave, lida.body.iv, lida.body.dados)).txs[0].ticker==="BBAS3", "a nuvem passa a ter a carteira escolhida");

  renderSync(); const elSync = $("#sync-area");
  ok(elSync.innerHTML.includes(codA) && /Desligar neste aparelho/.test(elSync.innerHTML), "tela mostra o código e as opções com a sincronização ligada");
  await apagarSyncNuvem();
  ok(!Object.keys(blobMem.arquivos).length && !lerSync().codigo, "apagar da nuvem remove o arquivo e desliga");
  entrarDemo(); ok((await entrarSync(codA)).erro==="demo", "modo exemplo não sincroniza"); sairDemo();
  clearTimeout(tSync);
}

console.log(falhas? falhas+" falha(s)" : "todos passaram");
return falhas;
`;
const fn = new Function(...Object.keys(ambiente), `"use strict";\n${js}\nreturn (async()=>{${testes}})();`);
fn(...Object.values(ambiente)).then(f=>{ if(f) process.exitCode = 1; }).catch(e=>{ console.error("ERRO:", e); process.exit(1); });
