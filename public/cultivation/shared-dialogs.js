/* U04/U05/U06. The caller owns the operation; confirmation only returns a boolean. */
(function(root){
  'use strict';
  function createPresentation(host){
    let active=null;
    const allowed=options=>{try{return options.isCurrent?.()!==false;}catch{return false;}};
    function confirmAction(message,options={}){
      if(active||!allowed(options))return Promise.resolve(false);
      const doc=host.document;
      const dialog=doc?.createElement('dialog');
      if(!dialog||typeof dialog.showModal!=='function'){
        try{return Promise.resolve(!!host.confirm?.(String(message))&&allowed(options));}catch{return Promise.resolve(false);}
      }
      const trigger=doc.activeElement;
      const danger=options.kind==='danger';
      dialog.className='qy-confirm-dialog';
      dialog.dataset.kind=danger?'danger':'normal';
      dialog.setAttribute('aria-labelledby','qy-confirm-title');
      dialog.setAttribute('aria-describedby','qy-confirm-message');
      dialog.setAttribute('role','alertdialog');
      dialog.innerHTML='<header><h2 id="qy-confirm-title"></h2></header><p id="qy-confirm-message"></p><footer><button type="button" data-qy-cancel>取消</button><button type="button" data-qy-accept></button></footer>';
      dialog.querySelector('h2').textContent=String(options.title||'確認操作');
      dialog.querySelector('p').textContent=String(message??'');
      const cancel=dialog.querySelector('[data-qy-cancel]'),accept=dialog.querySelector('[data-qy-accept]');
      accept.textContent=String(options.confirmLabel||'繼續');
      return new Promise(resolve=>{
        let settled=false;
        function finish(result){
          if(settled)return;
          settled=true;
          const confirmed=result===true&&allowed(options);
          if(dialog.open)dialog.close();
          dialog.remove();
          active=null;
          if(trigger?.isConnected)trigger.focus?.({preventScroll:true});
          resolve(confirmed);
        }
        active={finish};
        cancel.addEventListener('click',()=>finish(false));
        accept.addEventListener('click',()=>finish(true));
        dialog.addEventListener('cancel',event=>{event.preventDefault();finish(false);});
        dialog.addEventListener('close',()=>finish(false));
        try{doc.body.appendChild(dialog);dialog.showModal();cancel.focus({preventScroll:true});}
        catch{finish(false);}
      });
    }
    // Small informational receipts only. Never use for confirmations or actions requiring acknowledgement.
    function notify(message,{kind='info'}={}){
      const doc=host.document;if(!doc?.body)return false;
      const text=String(message??'').trim();if(!text)return false;
      let region=doc.getElementById('qy-notice-region');
      if(!region){
        region=doc.createElement('div');region.id='qy-notice-region';
        region.setAttribute('aria-live','polite');region.setAttribute('aria-relevant','additions');
        doc.body.appendChild(region);
      }
      const node=doc.createElement('div');node.className='qy-notice';node.dataset.kind=['success','warning','error'].includes(kind)?kind:'info';
      node.setAttribute('role','status');node.textContent=text;
      region.appendChild(node);
      while(region.children.length>3)region.firstElementChild.remove();
      host.setTimeout(()=>node.remove(),4000);
      return true;
    }
    return Object.freeze({confirmAction,notify,cancelPending:()=>active?.finish(false)});
  }
  const api=createPresentation(root);
  if(typeof module==='object'&&module.exports)module.exports={createPresentation};
  if(root.document){
    root.QADialogs=api;
    root.addEventListener?.('xiuxian:user-data-ready',()=>api.cancelPending());
    // Retain the current toast owner when present; only supply the missing convenience entry point.
    if(typeof root.showToast!=='function')root.showToast=(message)=>api.notify(message);
  }
})(globalThis);
