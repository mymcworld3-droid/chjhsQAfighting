/* U09/U10/U11: one presentation adapter for authoritative native UI state.
 * Never requests data, changes completion, reads messages, or owns scrolling. */
(function(root){
  'use strict';
  const badgeSelector='.alliance-chat-badge,#friend-request-badge,.quest-tab-dot,.sect-action-dot,.home-wireframe-alert';
  const progressSelector='[data-qy-progress],#progress-bar,#xiuxian-progress';
  const selector=progressSelector+',[data-qy-state],'+badgeSelector;
  const labels={loading:'正在載入',syncing:'正在同步',preparing:'正在準備',empty:'目前沒有資料',error:'操作未完成',retry:'可重試'};
  const attr=(node,key,value)=>{if(node.getAttribute(key)!==String(value))node.setAttribute(key,String(value));};
  function syncProgress(node){
    // The two home meters already have a live inline width from their owners.
    // Only mirror it into the accessible track; never alter the displayed width.
    if(node.id==='progress-bar'||node.id==='xiuxian-progress'){
      const track=node.parentElement,match=String(node.style?.width||'').match(/^(\d+(?:\.\d+)?)%$/);
      if(!track||!match)return;
      attr(track,'data-qy-progress','linear');
      attr(track,'role','progressbar');
      attr(track,'aria-label',node.id==='xiuxian-progress'?'境界修行進度':'等級進度');
      attr(track,'aria-valuemin',0);attr(track,'aria-valuemax',100);
      attr(track,'aria-valuenow',Math.min(100,Math.max(0,Number(match[1]))));
      return;
    }
    // Domain-specific segments and fills keep their original widths/colors.
    if(!node.hasAttribute('aria-label')||!node.hasAttribute('aria-valuenow'))return;
    attr(node,'role','progressbar');
  }
  function syncState(node){
    const state=node.getAttribute('data-qy-state');
    if(!Object.hasOwn(labels,state))return;
    if(!node.hasAttribute('role'))attr(node,'role','status');
    if(!node.hasAttribute('aria-live'))attr(node,'aria-live','polite');
    if(!node.textContent.trim()&&!node.hasAttribute('aria-label'))attr(node,'aria-label',labels[state]);
  }
  function syncBadge(node){
    // Only recognize numeric text which the original badge owner already wrote.
    const counted=/^(?:[1-9]\d*|99\+)$/.test(String(node.textContent||'').trim());
    attr(node,'data-qy-badge',counted?'count':'dot');
  }
  function decorate(node){
    if(!node?.matches)return;
    if(node.matches(progressSelector))syncProgress(node);
    if(node.matches('[data-qy-state]'))syncState(node);
    if(node.matches(badgeSelector))syncBadge(node);
  }
  function scan(scope){
    if(!scope)return;
    if(scope.matches?.(selector))decorate(scope);
    for(const node of scope.querySelectorAll?.(selector)||[])decorate(node);
  }
  let ready=false;
  function init(){
    const doc=root.document;if(ready||!doc?.body)return;
    ready=true;scan(doc.body);
    if(typeof root.MutationObserver!=='function')return;
    const observer=new root.MutationObserver(records=>{
      for(const record of records){
        if(record.type==='attributes')decorate(record.target);
        else if(record.type==='characterData')decorate(record.target.parentElement);
        else {decorate(record.target);for(const node of record.addedNodes)if(node.nodeType===1)scan(node);}
      }
    });
    observer.observe(doc.body,{subtree:true,childList:true,characterData:true,attributes:true,
      attributeFilter:['aria-valuenow','aria-valuemax','aria-valuemin','data-qy-state','data-qy-progress']});
    for(const id of ['progress-bar','xiuxian-progress']){
      const fill=doc.getElementById(id);
      if(fill)observer.observe(fill,{attributes:true,attributeFilter:['style']});
    }
  }
  if(typeof module==='object'&&module.exports)module.exports={syncProgress,syncState,syncBadge,decorate,scan};
  if(root.document){
    if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',init,{once:true});
    else init();
  }
})(globalThis);
