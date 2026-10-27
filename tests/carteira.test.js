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
const mem = {};
const ambiente = {
  document:{ querySelector:q, querySelectorAll:()=>[], addEventListener(){},
    createElement:()=>{ const a={ click(){ globalThis.__baixados.push({nome:a.download, href:a.href}); }, remove(){} }; return a; },
    body:{ appendChild(){} } },
  window:{ addEventListener(){}, scrollTo(){}, scrollY:0 },
  localStorage:{ getItem:k=>mem[k]??null, setItem:(k,v)=>{mem[k]=v;}, removeItem:k=>{delete mem[k];} },
  location:{hash:""}, fakeEl, mem,
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

console.log(falhas? falhas+" falha(s)" : "todos passaram");
return falhas;
`;
const fn = new Function(...Object.keys(ambiente), `"use strict";\n${js}\nreturn (async()=>{${testes}})();`);
fn(...Object.values(ambiente)).then(f=>{ if(f) process.exitCode = 1; }).catch(e=>{ console.error("ERRO:", e); process.exit(1); });
