/* U03/U07/U08: decorate the existing native controls, never replace them.
 * Owners retain click/submit handlers, validation, selected/disabled state and focus.
 * Only known active UI controls opt in; no question options, artwork or combat wheel. */
(function(root){
  'use strict';
  const buttons=Object.freeze([
    ['filter','button:is(.store-tab,.manual-library-filter,.cc-filters button,.cc-learning-filters button,[data-action="account-filter"])'],
    ['tab','button:is(.quest-tabs button,.ui-social-tabs button,.cc-class-tabs button,.cc-workspace-tabs button,.ss-tabs button)[role="tab"]'],
    ['danger','button:is(.cc-danger,.dt-delete,#delete-account-btn,#admin-btn-del,[onclick="triggerGlobalReload()"],[data-td-action="remove"],[data-td-action="unpublish"])'],
    ['icon','button:is(#alliance-chat-send,#alliance-chat-close,#quest-close)'],
    ['primary','button:is(.dv-primary,.quest-claim,.cc-primary,.dt-generate,.dt-play,.dt-next,.dt-modal-submit,.dm-action:not(.dm-action-secondary):not(.dm-start),.tc-dialog .tc-primary,#dongfu-scope-save,#admin-btn-save,#game-issue-dialog button[type="submit"],#page-settings .btn-cyber-primary,#btn-next-step)'],
    ['secondary','button:is(.dv-button:not(.dv-word):not(.dv-listen),.quest-action,#quest-refresh,.cc-shell button[data-action],.cc-shell button[data-td-action],.dt-repair,.dt-back,.dt-modal-actions .dt-modal-cancel,.dm-action-secondary,.tc-dialog .tc-secondary,.tc-dialog .tc-ghost,#cs-all,#cs-clear,#game-issue-dialog button[data-close],#page-settings .btn-cyber-ghost,#page-store .btn-cyber-ghost,#page-admin .btn-cyber-ghost)']
  ]);
  const field=':is(input:not([type]),input[type="text"],input[type="search"],input[type="email"],input[type="password"],input[type="number"],input[type="tel"],input[type="url"],input[type="date"],input[type="datetime-local"],input[type="time"],textarea,select)';
  const fieldScope=':is(#page-settings,#page-admin,#page-daily-vocabulary,#section-classes,#page-teacher-dongtian,.cc-shell,#scope-studio,#cs-scope,.dt-modal-card,.dt-create,.dt-enter-code,#game-issue-dialog,#custom-alert-modal,#report-modal,#page-social,#tactical-combat,#page-quiz)';
  const fields=fieldScope+' '+field+',#alliance-chat-input';
  const excluded='[data-qy-nav-action],.nav-btn,.dv-choice,.dv-word,.dv-listen,.cc-options button,[data-action="answer"],.tc-options button,.dm-option,.dt-option,.quiz-rich-option,#options-container button,.manual-native-card,[data-wd-difficulty],.dm-start';
  const candidates='button,input,textarea,select';
  function roleFor(node){
    if(!node?.matches||node.matches(excluded))return null;
    if(node.matches('button')){
      for(const [role,selector] of buttons)if(node.matches(selector))return role;
      return null;
    }
    return node.matches(fields)?'field':null;
  }
  function decorate(node){
    const role=roleFor(node),old=node.getAttribute?.('data-qy-control');
    if(role){if(old!==role)node.setAttribute('data-qy-control',role);}
    else if(old!==null&&old!==undefined)node.removeAttribute('data-qy-control');
    // Store uses class-based filter state; mirror it only, never write the filter.
    if(role==='filter'&&node.matches('.store-tab')){
      const pressed=String(node.classList.contains('active')||node.classList.contains('active-tab'));
      if(node.getAttribute('aria-pressed')!==pressed)node.setAttribute('aria-pressed',pressed);
    }
    return role;
  }
  function scan(scope){
    if(!scope)return;
    if(scope.matches?.(candidates))decorate(scope);
    for(const node of scope.querySelectorAll?.(candidates)||[])decorate(node);
  }
  let initialized=false;
  function init(){
    const doc=root.document;
    if(initialized||!doc?.body)return;
    initialized=true;scan(doc.body);
    if(typeof root.MutationObserver!=='function')return;
    new root.MutationObserver(records=>{
      for(const record of records){
        if(record.type==='attributes'){
          if(record.target.matches?.(candidates))decorate(record.target);
        }else for(const node of record.addedNodes)if(node.nodeType===1)scan(node);
      }
    }).observe(doc.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','type','role']});
  }
  if(typeof module==='object'&&module.exports)module.exports={roleFor,decorate,scan};
  if(root.document){
    if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',init,{once:true});
    else init();
  }
})(globalThis);
