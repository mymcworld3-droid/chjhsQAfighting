'use strict';
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs'),path=require('node:path');
const {D1Store}=require('../../d1-store.cjs');
function setup(){
  const sql=new DatabaseSync(':memory:');
  for(const file of fs.readdirSync(path.join(__dirname,'../../cloudflare/d1/migrations')).sort())sql.exec(fs.readFileSync(path.join(__dirname,'../../cloudflare/d1/migrations',file),'utf8'));
  const gateway=async statements=>{
    sql.exec('BEGIN');
    try {const rows=statements.map(({sql:query,params=[]})=>({success:true,results:sql.prepare(query).all(...params)}));sql.exec('COMMIT');return rows;}
    catch(e){sql.exec('ROLLBACK');if(/CHECK constraint/.test(e.message))e.code='aborted';throw e;}
  };
  return {sql,gateway,db:new D1Store('A',{gateway,pollMs:50}),secondary:new D1Store('BD',{gateway,pollMs:50})};
}
module.exports={setup};
