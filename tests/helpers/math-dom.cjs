'use strict';
// Minimal tree fixture for math recovery tests. Build elements explicitly; its
// innerHTML setter accepts escaped text only, not a general HTML document.
const escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function documentFixture(){
 const doc={};
 class Node {
  constructor(tag,value=null){this.nodeType=tag?1:3;this.tagName=tag?.toUpperCase();this.nodeValue=value;this.childNodes=[];this.parentNode=null;this.ownerDocument=doc;this.className='';this.style={};this.attributes={};}
  get parentElement(){return this.parentNode?.nodeType===1?this.parentNode:null;}
  get isConnected(){return this===doc.body||!!this.parentNode?.isConnected;}
  get children(){return this.childNodes.filter(n=>n.nodeType===1);}
  get textContent(){return this.nodeType===3?this.nodeValue:this.childNodes.map(n=>n.textContent).join('');}
  set textContent(value){if(this.nodeType===3)this.nodeValue=String(value);else this.replaceChildren(doc.createTextNode(String(value)));}
  get innerHTML(){return this.childNodes.map(n=>n.nodeType===3?escape(n.nodeValue):`<${n.tagName.toLowerCase()}${n.className?' class="'+n.className+'"':''}>${n.innerHTML}</${n.tagName.toLowerCase()}>`).join('');}
  set innerHTML(value){if(/<[a-z/]/i.test(value))throw Error('Build fixture elements explicitly');this.textContent=String(value).replace(/&(amp|lt|gt|quot|#39);/g,(_,s)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[s]));}
  appendChild(child){child.remove();child.parentNode=this;this.childNodes.push(child);return child;}
  replaceChildren(...nodes){for(const child of this.childNodes)child.parentNode=null;this.childNodes=[];nodes.forEach(n=>this.appendChild(n));}
  remove(){if(this.parentNode){const list=this.parentNode.childNodes;list.splice(list.indexOf(this),1);this.parentNode=null;}}
  replaceWith(node){const parent=this.parentNode,index=parent.childNodes.indexOf(this);this.remove();node.remove();parent.childNodes.splice(index,0,node);node.parentNode=parent;}
  contains(node){return node===this||this.childNodes.some(child=>child.contains(node));}
  setAttribute(name,value){this.attributes[name]=String(value);}
  matches(selector){return selector.split(',').some(part=>{const s=part.trim();return s.startsWith('.')?this.className.split(/\s+/).includes(s.slice(1)):s.startsWith('[')?Object.hasOwn(this.attributes,s.slice(1,-1)):this.tagName?.toLowerCase()===s;});}
  closest(selector){return this.matches(selector)?this:this.parentElement?.closest(selector)||null;}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  querySelectorAll(selector){return this.childNodes.flatMap(child=>[...(child.nodeType===1&&child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
  click(){if(!this.disabled)this.onclick?.();}
 }
 doc.createElement=tag=>new Node(tag);
 doc.createTextNode=value=>new Node(null,String(value));
 doc.createTreeWalker=root=>{const nodes=[];function visit(node){for(const child of node.childNodes){if(child.nodeType===3)nodes.push(child);visit(child);}}visit(root);let i=0;return {currentNode:null,nextNode(){this.currentNode=nodes[i++];return !!this.currentNode;}};};
 doc.body=doc.createElement('body');
 return doc;
}
module.exports={documentFixture};
