/* Subject-neutral, data-only question visuals. No eval, HTML or external resources. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.QAQuestionVisualEngine=api;})(globalThis,function factory(){
'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fail=m=>{throw new Error('Invalid question visual: '+m)};
const num=v=>{if(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>1e12)fail('number');return v};
const label=v=>{if(typeof v!=='string'||v.length>180||/[\u0000-\u001f]/.test(v))fail('label');return v};
const arr=(v,min,max)=>{if(!Array.isArray(v)||v.length<min||v.length>max)fail('array length');return v};
const pair=v=>arr(v,2,2).map(num);
const range=v=>{const [a,b]=pair(v);if(b-a<1e-9||b-a>1e12)fail('range');return [a,b]};
const colors=['#609ac8','#d4a354','#79ad91','#bc91c9','#d47e79','#a7b8c8'];
const ink=v=>{if(v===undefined)return colors[0];if(!Number.isInteger(v)||v<0||v>=colors.length)fail('color');return colors[v]};
const ops={'+':(a,b)=>a+b,'-':(a,b)=>a-b,'*':(a,b)=>a*b,'/':(a,b)=>a/b,'^':(a,b)=>a**b,min:Math.min,max:Math.max,sin:Math.sin,cos:Math.cos,tan:Math.tan,asin:Math.asin,acos:Math.acos,atan:Math.atan,exp:Math.exp,ln:Math.log,log10:Math.log10,sqrt:Math.sqrt,abs:Math.abs,neg:a=>-a,floor:Math.floor,ceil:Math.ceil};
const unary=new Set(['sin','cos','tan','asin','acos','atan','exp','ln','log10','sqrt','abs','neg','floor','ceil']);
function compile(expr, variable='x'){
 let count=0;
 function visit(e,d){
  if(++count>96||d>16)fail('expression complexity');
  if(typeof e==='number'){const n=num(e);return ()=>n}
  if(e===variable)return x=>x;
  if(e==='pi')return ()=>Math.PI;
  if(e==='e')return ()=>Math.E;
  if(!Array.isArray(e)||!Object.hasOwn(ops,e[0])||e.length!==(unary.has(e[0])?2:3))fail('expression operator');
  const f=ops[e[0]],args=e.slice(1).map(a=>visit(a,d+1));return x=>f(...args.map(g=>g(x)));
 }
 return visit(expr,0);
}
function render(spec){
 if(!spec||typeof spec!=='object'||Array.isArray(spec))fail('object');
 if(JSON.stringify(spec).length>24000)fail('size');
 if(spec.type==='table'){
  const head=arr(spec.headers,1,12).map(label), rows=arr(spec.rows,1,80);
  const cell=v=>typeof v==='number'?esc(num(v)):esc(label(v));
  const body=rows.map(r=>'<tr>'+arr(r,head.length,head.length).map(v=>'<td>'+cell(v)+'</td>').join('')+'</tr>').join('');
  return '<span class="qy-visual qy-visual-table" style="display:block;max-width:100%;overflow-x:auto"><table style="border-collapse:collapse"><caption>'+esc(label(spec.title??''))+'</caption><thead><tr>'+head.map(v=>'<th scope="col">'+esc(v)+'</th>').join('')+'</tr></thead><tbody>'+body+'</tbody></table></span>';
 }
 if(spec.type!=='plot')fail('type');
 const [xmin,xmax]=range(spec.x),[ymin,ymax]=range(spec.y);
 const W=640,H=400,L=82,R=602,T=38,B=334;
 const X=x=>L+(x-xmin)/(xmax-xmin)*(R-L),Y=y=>B-(y-ymin)/(ymax-ymin)*(B-T);
 const cap=n=>Math.max(-1e5,Math.min(1e5,n));
 const f=n=>{if(!Number.isFinite(n))fail('coordinate overflow');return String(Math.round(cap(n)*100)/100)};
 const P=p=>{const [x,y]=pair(p);return [f(X(x)),f(Y(y))]};
 const text=(x,y,s,anchor='middle')=>'<text x="'+f(x)+'" y="'+f(y)+'" text-anchor="'+anchor+'" fill="currentColor" font-size="16">'+esc(label(s))+'</text>';
 const line=(a,b,c,d,extra='')=>'<line x1="'+f(a)+'" y1="'+f(b)+'" x2="'+f(c)+'" y2="'+f(d)+'" '+extra+'/>';
 let grid='',body='',labels='';
 if(spec.axes!==false){
  const ticks=spec.ticks===undefined?5:spec.ticks;if(!Number.isInteger(ticks)||ticks<2||ticks>10)fail('ticks');
  for(let i=0;i<=ticks;i++){
   const x=xmin+(xmax-xmin)*i/ticks,y=ymin+(ymax-ymin)*i/ticks;
   grid+=line(X(x),T,X(x),B,'stroke="currentColor" opacity=".16"')+line(L,Y(y),R,Y(y),'stroke="currentColor" opacity=".16"');
   labels+=text(X(x),B+23,String(Number(x.toPrecision(4))))+text(L-9,Y(y)+5,String(Number(y.toPrecision(4))),'end');
  }
  grid+='<rect x="'+L+'" y="'+T+'" width="'+(R-L)+'" height="'+(B-T)+'" fill="none" stroke="currentColor"/>';
  if(xmin<0&&xmax>0)grid+=line(X(0),T,X(0),B,'stroke="currentColor" opacity=".65"');
  if(ymin<0&&ymax>0)grid+=line(L,Y(0),R,Y(0),'stroke="currentColor" opacity=".65"');
  labels+=text((L+R)/2,385,spec.xLabel??'')+text(L,23,spec.yLabel??'','start');
 }
 const layers=arr(spec.layers,1,40);let budget=0;
 for(const o of layers){
  if(!o||typeof o!=='object')fail('layer');
  const c=ink(o.color),dash=o.dashed===true?' stroke-dasharray="7 5"':'',style=' stroke="'+c+'" stroke-width="2.5"'+dash+' fill="none" stroke-linejoin="round"';
  if(o.type==='function'||o.type==='parametric'){
   const [a,b]=range(o.domain??spec.x),n=o.samples??240;
   if(!Number.isInteger(n)||n<16||n>800||(budget+=n)>6400)fail('sample budget');
   const fx=o.type==='function'?(x=>x):compile(o.xExpr,'t'),fy=compile(o.expr??o.yExpr,o.type==='function'?'x':'t');
   let d='',prev=null;
   for(let i=0;i<=n;i++){
    const t=a+(b-a)*i/n,x=fx(t),y=fy(t);
    if(!Number.isFinite(x)||!Number.isFinite(y)||Math.abs(x)>1e12||Math.abs(y)>1e12){prev=null;continue}
    const px=X(x),py=Y(y);
    const connected=prev&&Math.abs(px-prev[0])<W*1.5&&Math.abs(py-prev[1])<H*1.5;
    d+=(connected?'L':'M')+f(px)+' '+f(py)+' ';prev=[px,py];
   }
   if(!d)fail('no finite samples');body+='<path d="'+d.trim()+'"'+style+'/>';
  }else if(['polyline','polygon','scatter','bars'].includes(o.type)){
   const pts=arr(o.points,o.type==='polygon'?3:o.type==='polyline'?2:1,400);
   if((budget+=pts.length)>6400)fail('point budget');
   if(o.type==='scatter')body+=pts.map(p=>{const [x,y]=P(p);return '<circle cx="'+x+'" cy="'+y+'" r="4" fill="'+c+'"/>'}).join('');
   else if(o.type==='bars'){
    const width=num(o.width??(xmax-xmin)/30),base=num(o.base??0);if(width<=0)fail('bar width');
    body+=pts.map(p=>{const [x,y]=pair(p);return '<rect x="'+f(X(x-width/2))+'" y="'+f(Math.min(Y(base),Y(y)))+'" width="'+f(width/(xmax-xmin)*(R-L))+'" height="'+f(Math.abs(Y(y)-Y(base)))+'" fill="'+c+'" fill-opacity=".75"/>'}).join('');
   }else body+='<'+o.type+' points="'+pts.map(p=>P(p).join(',')).join(' ')+'"'+style+(o.type==='polygon'?' fill-opacity=".2"':'')+'/>';
  }else if(o.type==='segment'||o.type==='arrow'){
   const [x1,y1]=P(o.from).map(Number),[x2,y2]=P(o.to).map(Number);body+=line(x1,y1,x2,y2,'stroke="'+c+'" stroke-width="2.5"'+dash);
   if(o.type==='arrow'){const a=Math.atan2(y2-y1,x2-x1);body+='<path d="M'+f(x2-12*Math.cos(a-.45))+' '+f(y2-12*Math.sin(a-.45))+' L'+f(x2)+' '+f(y2)+' L'+f(x2-12*Math.cos(a+.45))+' '+f(y2-12*Math.sin(a+.45))+'"'+style+'/>'}
  }else if(o.type==='ellipse'){
   const [x,y]=P(o.center),[rx,ry]=pair(o.radii);if(rx<=0||ry<=0)fail('radius');body+='<ellipse cx="'+x+'" cy="'+y+'" rx="'+f(rx/(xmax-xmin)*(R-L))+'" ry="'+f(ry/(ymax-ymin)*(B-T))+'"'+style+'/>';
  }else if(o.type==='text'){const [x,y]=P(o.at).map(Number);body+=text(x,y,o.text)}
  else fail('layer type');
 }
 // Nested viewport clips graphical primitives without global IDs or cross-question collisions.
 return '<span class="qy-visual" style="display:block;width:100%;max-width:640px;margin:8px auto"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400" role="img" aria-label="'+esc(label(spec.title??'題目圖形'))+'" style="display:block;width:100%;height:auto;color:inherit"><title>'+esc(label(spec.title??'題目圖形'))+'</title>'+grid+'<svg x="'+L+'" y="'+T+'" width="'+(R-L)+'" height="'+(B-T)+'" viewBox="'+L+' '+T+' '+(R-L)+' '+(B-T)+'" overflow="hidden">'+body+'</svg>'+labels+'</svg></span>';
}
function inspect(spec){try{render(spec);return {valid:true}}catch(e){return {valid:false,reason:String(e.message)}}}
return Object.freeze({compile,render,inspect});
});
