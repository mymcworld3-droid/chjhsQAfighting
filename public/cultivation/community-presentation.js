/* V2 S01-S03/S05-S06: inert views; invitations, chat and teacher permissions
 * remain owned by their existing controllers. User text is always escaped. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.QACommunityPresentation=api;})(globalThis,()=>{
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const states=Object.freeze({draft:['草稿','neutral'],published:['進行中','active'],active:['進行中','active'],closed:['已結束','neutral'],submitted:['已繳交','success'],'in-progress':['作答中','active'],pending:['待處理','pending'],approved:['已核准','success'],accepted:['已接受','success'],declined:['已拒絕','neutral'],expired:['已失效','neutral'],complete:['已完成','success'],incomplete:['尚未完成','pending'],locked:['未解鎖','neutral'],ready:['可挑戰','active']});
  const statusLabel=value=>states[value]?.[0]||'未開始';
  function statusMarkup(value,label){const row=states[value]||['未開始','neutral'];return '<span class="qy-state-badge" data-qy-status="'+row[1]+'">'+esc(label||row[0])+'</span>';}
  function metricMarkup(label,value,{detail=''}={}){return '<div class="cc-metric qy-data-metric" data-qy-metric><span>'+esc(label)+'</span><strong>'+esc(value??'—')+'</strong>'+(detail?'<small>'+esc(detail)+'</small>':'')+'</div>';}
  function identityMarkup({name,realm}={}){return '<span class="qy-player-identity"><strong>'+esc(name||'修士')+'</strong>'+(realm?'<small class="qy-realm-badge" data-qy-realm-kind="character">'+esc(realm)+'</small>':'')+'</span>';}
  function messageTime(time){const date=new Date(Number(time));return Number(time)>0&&Number.isFinite(date.getTime())?date.toLocaleTimeString('zh-TW',{timeZone:'Asia/Taipei',hour:'2-digit',minute:'2-digit'}):'';}
  function decorateIdentity(node){if(node)node.setAttribute('data-qy-player','');}
  function decorateMessage(node,{mine=false,time}={}){
    if(!node)return;node.setAttribute('data-qy-message',mine?'self':'peer');
    const stamp=node.querySelector?.('time');
    const date=new Date(Number(time));
    if(stamp&&Number(time)>0&&Number.isFinite(date.getTime()))stamp.dateTime=date.toISOString();
  }
  function invitationHeader(name,status='pending'){return '<div class="qy-invitation-header">'+identityMarkup({name})+statusMarkup(status)+'</div>';}
  return Object.freeze({statusLabel,statusMarkup,metricMarkup,identityMarkup,decorateIdentity,decorateMessage,messageTime,invitationHeader});
});
