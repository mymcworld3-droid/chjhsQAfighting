'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {fakeDb}=require('./helpers/inventory-db.cjs');const F=require('../simple-forge-api.cjs').__test;const pool=require('../public/cultivation/soulbound-pool.js');
test('refinery displays owned weapon and completes the real transaction from its button',async()=>{
 const item=pool.ITEMS[0],user={uid:'u1',stats:{gold:100},forgeFragments:1000,artifactSystem:{inventory:{[item.id]:2},equipped:{'本命法寶':item.id}},materialSystem:{inventory:{'raid-refine-key-ii':10}}};
 const db=fakeDb(user), local=structuredClone(user),styles=new Map(),listeners={},storage=new Map();let selectedTab=false;
 const buttons={};const makeButton=key=>buttons[key]||(buttons[key]={dataset:{sfItem:item.id},addEventListener(_event,fn){this.handler=fn;}});
 const content={_html:'',set innerHTML(value){this._html=value;for(const key of Object.keys(buttons))delete buttons[key];},get innerHTML(){return this._html;},querySelectorAll(q){return q==='[data-sf-item]'&&this._html.includes('data-sf-item=')?[makeButton('item')]:[];},querySelector(q){const keys={'[data-sf-upgrade]':'upgrade','[data-sf-refund]':'refund','[data-sf-resume]':'resume'};const name=keys[q];return name&&this._html.includes('data-sf-'+name)?makeButton(name):null;}};
 const tab={dataset:{trainingTab:'refinery'},classList:{toggle(_name,yes){selectedTab=yes;}},setAttribute(){}};
 const page={querySelector(q){return q==='#training-tab-content'?content:null;},querySelectorAll(){return [tab];}};
 const document={head:{append(node){styles.set(node.id,node);}},createElement(){return {};},getElementById(id){return id==='page-training'?page:styles.get(id)||null;},querySelector(q){return q.includes('[data-training-tab=')?(selectedTab?tab:null):q.includes('#training-tab-content')?content:null;}};
 const authUser={uid:'u1',getIdToken:async()=> 'token'},catalog=[item];
 const window={getCurrentUserData:()=>local,dispatchEvent(){},addEventListener(name,fn){listeners[name]=fn;}};
 const fetch=async (_url,opts)=>{try{const data=opts.method==='GET'?await F.view(db,'u1'):await F.transaction(db,'u1',JSON.parse(opts.body).action,JSON.parse(opts.body));return{ok:true,json:async()=>({ok:true,...data})};}catch(e){return{ok:false,status:e.status||500,json:async()=>({error:e.message})};}};
 const context={document,window,fetch,getApp:()=>({}),getAuth:()=>({currentUser:authUser}),ARTIFACT_CATALOG:catalog,replaceArtifactCatalog(items){catalog.splice(0,catalog.length,...items);},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},crypto:require('node:crypto'),CustomEvent:class{constructor(name,opts){this.name=name;this.detail=opts?.detail;}},console};
 let source=fs.readFileSync('public/cultivation/simple-forge.js','utf8').replace(/^import .*;\n/gm,'');vm.runInNewContext(source,context);
 await window.openCultivationRefinery();assert.match(content.innerHTML,/法器升階/);assert.match(content.innerHTML,/逐風飛劍/);makeButton('item').handler();assert.match(content.innerHTML,/相同法器：2 \/ 2/);await makeButton('upgrade').handler();assert.match(content.innerHTML,/升階完成/);assert.equal(local.artifactSystem.inventory[item.id],undefined);assert.equal(Object.keys(local.artifactSystem.inventory).length,1);assert.equal(storage.size,0);assert.equal(catalog.length,2);
});
