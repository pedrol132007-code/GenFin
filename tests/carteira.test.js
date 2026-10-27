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

console.log(falhas? falhas+" falha(s)" : "todos passaram");
return falhas;
`;
const fn = new Function(...Object.keys(ambiente), `"use strict";\n${js}\nreturn (async()=>{${testes}})();`);
fn(...Object.values(ambiente)).then(f=>{ if(f) process.exitCode = 1; }).catch(e=>{ console.error("ERRO:", e); process.exit(1); });
