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
  document:{ querySelector:q, querySelectorAll:()=>[], addEventListener(){} },
  window:{ addEventListener(){}, scrollTo(){}, scrollY:0 },
  localStorage:{ getItem:k=>mem[k]??null, setItem:(k,v)=>{mem[k]=v;} },
  location:{hash:""}, fakeEl
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

console.log(falhas? falhas+" falha(s)" : "todos passaram");
return falhas;
`;
const fn = new Function(...Object.keys(ambiente), `"use strict";\n${js}\nreturn (async()=>{${testes}})();`);
fn(...Object.values(ambiente)).then(f=>{ if(f) process.exitCode = 1; }).catch(e=>{ console.error("ERRO:", e); process.exit(1); });
