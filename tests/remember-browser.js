"use strict";
const fs=require("node:fs"),vm=require("node:vm"),path=require("node:path"),assert=require("node:assert/strict");
const code=fs.readFileSync(path.join(__dirname,"../github-page/connection.js"),"utf8");
class Storage { constructor(map=new Map()){this.map=map;} getItem(k){return this.map.get(k)??null;} setItem(k,v){this.map.set(k,String(v));} removeItem(k){this.map.delete(k);} }
const localStorage=new Storage();
const apiBase="https://tp.example.onrender.com";
localStorage.setItem("tp-v28-server",apiBase);
let active=new Set(), seq=0, logoutCount=0;
let lastToken="", requests=[];
const state={cycle:{number:1,startDate:"2026-10-26"},tasks:[]};
async function serverFetch(url,options={}){
  const u=new URL(url),p=u.pathname,b=options.body?JSON.parse(options.body):{};
  requests.push({p,body:b});
  let status=200,result;
  if(p==="/auth/login") {
    if (b.password!=="test-password") {status=401;result={message:"密碼不正確"};}
    else {
      lastToken=`access${++seq}`;
      result={token:lastToken,expiresIn:43200};
      if(b.remember){const t=`${"a".repeat(42)}${seq%10}`;active.add(t);Object.assign(result,{rememberToken:t,rememberExpiresAt:Date.now()+2592000000});}
    }
  } else if(p==="/auth/refresh") {
    if(!active.has(b.rememberToken)){status=401;result={message:"invalid device"};}
    else {
      active.delete(b.rememberToken);
      const t=`${"b".repeat(42)}${++seq%10}`;active.add(t);lastToken=`access${seq}`;
      result={token:lastToken,expiresIn:43200,rememberToken:t,rememberExpiresAt:Date.now()+2592000000};
    }
  } else if(p==="/auth/logout") {active.delete(b.rememberToken);logoutCount++;result={ok:true};}
  else if(p==="/api/state") {status=options.headers.Authorization===`Bearer ${lastToken}`?200:401;result=status===200?{revision:1,state}:{message:"請先登入"};}
  else if(p==="/cycles") result=[];
  else throw Error("Unexpected endpoint: "+p);
  return {ok:status<400,status,async json(){return result;}};
}
function browser(){
  const elements=new Map();
  function ui(id){
    if(!elements.has(id)){
      const e={hidden:false,value:"",checked:false,disabled:false,textContent:"",classList:{toggle(){},add(){},remove(){}},onclick:null,onsubmit:null,
        querySelector(){return {disabled:false};},matches(){return false;}};
      if(id==="weekFootprintLayer") e.hidden=true;
      elements.set(id,e);
    }
    return elements.get(id);
  }
  const sessionStorage=new Storage();
  const location={search:"", reload(){location.didReload=true;},didReload:false};
  const window={ TPDomain:{ publicState:x=>x, validate(){},empty:()=>state }, TP_CONFIG:{API_BASE_URL:""}, addEventListener(){} };
  const context={window,document:{getElementById:ui,querySelector:sel=>sel===".app-shell"?{inert:false}:null,activeElement:null,hidden:false},
    localStorage,sessionStorage,location,fetch:serverFetch,URLSearchParams,navigator:{onLine:true},URL,JSON,Promise,Date,
    AbortSignal,crypto:require("node:crypto").webcrypto,Symbol,Set,Map,Object,Number,Array,Error,
    setInterval(){},setTimeout(){return 1;},clearTimeout(){},console};
  vm.createContext(context);
  vm.runInContext(code,context);
  const adapter={get:()=>state,replace(next){assert.equal(next,state);},onCycleTheme(){}};
  return {tp:window.TPConnection,ui,sessionStorage,location,adapter};
}
(async()=>{
  const a=browser(); await a.tp.start(a.adapter);
  assert.equal(a.ui("connectionForm").hidden,false);
  a.ui("rememberDevice").checked=true;
  a.ui("webPassword").value="test-password";
  await a.ui("connectionForm").onsubmit({preventDefault(){}});
  assert.equal(a.ui("connectionGate").hidden,true);
  assert(localStorage.getItem("tp-v29-remember"));
  assert(a.sessionStorage.getItem("tp-v28-session"));
  assert.equal(localStorage.getItem("tp-v28-session"),null);
  const b=browser();await b.tp.start(b.adapter);
  assert.equal(b.ui("connectionGate").hidden,true);
  assert(requests.some(x=>x.p==="/auth/refresh"));
  assert.equal(b.ui("autoLoginLoading").hidden,true);
  await b.ui("logoutDevice").onclick();
  assert.equal(logoutCount,1);
  assert.equal(active.size,0);
  assert.equal(localStorage.getItem("tp-v29-remember"),null);
  assert.equal(b.location.didReload,true);
  const c=browser(); await c.tp.start(c.adapter);
  assert.equal(c.ui("connectionGate").hidden,false);
  console.log("PASS browser: remember opt-in, automatic login after reopening, refresh rotation, logout + no auto-login");
})().catch(e=>{console.error(e);process.exitCode=1;});
