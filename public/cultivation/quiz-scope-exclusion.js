import {authenticatedMainFetch,getMainUser} from './data/project-repository.js';

const $ = id => document.getElementById(id);
const text = value => String(value || '').trim();
const button = (label, primary = false) => {
  const node = document.createElement('button');
  node.type = 'button';
  node.textContent = label;
  node.className = primary ? 'btn-cyber-primary px-4 py-3 rounded-lg' : 'btn-cyber-ghost px-4 py-3 rounded-lg';
  return node;
};
let dialog = null;
function close() {
  if (!dialog) return;
  dialog.close?.();
  dialog.remove();
  dialog = null;
}
function hasSelectedScope(quiz) {
  return !!quiz?.adaptive?.scope?.path && !!getMainUser()?.uid;
}
window.syncQuizScopeExclusionButton = quiz => {
  const control = $('btn-quiz-scope-exclusion');
  if (!control) return;
  // The main study flow can replace an ungraded question without impacting
  // battle authority. Battle question exclusion still applies server-side.
  const ordinary = !quiz?.mode || quiz.mode === 'solo';
  control.hidden = !ordinary || !hasSelectedScope(quiz);
  control.disabled = !ordinary || !hasSelectedScope(quiz);
};
async function request(payload) {
  const response = await authenticatedMainFetch('/api/quiz/scope-exclusions', {
    method:'POST',body:JSON.stringify(payload)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw Error(result.error || '排除規則無法儲存，請稍後重試');
  return result;
}
window.openQuizScopeExclusion = async () => {
  const quiz = window.currentActiveQuiz, unit = quiz?.adaptive?.scope;
  const uid = getMainUser()?.uid;
  if (!unit?.path || !uid) {
    window.showToast?.('請先在專注練習選擇章節並開啟題目');
    return;
  }
  if (dialog) return;
  const root = document.createElement('dialog');
  root.id = 'quiz-scope-exclusion-dialog';
  root.setAttribute('aria-labelledby','quiz-scope-exclusion-title');
  root.style.cssText = 'width:min(540px,calc(100vw - 24px));max-height:85dvh;overflow:auto;z-index:22000;border:1px solid #8c784f;border-radius:16px;background:#131a22;color:#f0e5cd;padding:20px;box-sizing:border-box';
  const style = $('quiz-scope-exclusion-style') || document.createElement('style');
  if (!style.id) {
    style.id = 'quiz-scope-exclusion-style';
    style.textContent = '#quiz-scope-exclusion-dialog::backdrop{background:#02070bdd}#quiz-scope-exclusion-dialog textarea{width:100%;box-sizing:border-box;background:#0b121a;border:1px solid #77684b;border-radius:8px;color:#fff;padding:10px;min-height:96px;font:inherit}#quiz-scope-exclusion-dialog p{line-height:1.65}#quiz-scope-exclusion-dialog .scope-exclusion-row{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;padding:8px 0;border-bottom:1px solid #fff2}#quiz-scope-exclusion-dialog button{min-height:42px}';
    document.head.appendChild(style);
  }
  const heading = document.createElement('h3');
  heading.id='quiz-scope-exclusion-title';heading.textContent='此題超過學習範圍';
  heading.style.cssText='font-size:19px;font-weight:bold;margin:0 0 10px';
  const description = document.createElement('p');
  description.textContent='描述要在目前章節停止出現的考法；其他同章節題目仍會保留。更換已儲存的學習範圍後，這些限制會解除。';
  const chapter=document.createElement('p');
  chapter.style.cssText='font-size:12px;color:#d7bd87';
  chapter.textContent='目前章節：'+text(unit.detail||unit.path).slice(0,120);
  const question=document.createElement('p');
  question.textContent='本題：'+text(quiz.data?.q).slice(0,220);
  question.style.cssText='font-size:12px;color:#b6c7dc';
  const label=document.createElement('label');
  label.textContent='不要再出哪一種類型？';
  label.htmlFor='quiz-scope-exclusion-text';
  const input=document.createElement('textarea');
  input.id='quiz-scope-exclusion-text';input.maxLength=160;
  input.placeholder='例如：此範圍不要再出三維向量內積的計算；二維向量內積仍可出題。';
  const status=document.createElement('p');
  status.setAttribute('role','status');status.style.fontSize='12px';
  const actions=document.createElement('div');
  actions.style.cssText='display:flex;gap:10px;flex-wrap:wrap;margin-top:14px';
  const save=button('儲存禁出規則',true), cancel=button('關閉');
  actions.append(save,cancel);
  const existing=document.createElement('section');
  const existingTitle=document.createElement('h4');
  existingTitle.textContent='目前章節已排除的考法';
  existingTitle.style.cssText='font-size:13px;font-weight:bold;margin:18px 0 4px';
  const existingRows=document.createElement('div');
  existing.append(existingTitle,existingRows);
  root.append(heading,description,chapter,question,label,input,status,actions,existing);
  document.body.appendChild(root);
  dialog=root;
  const owner=uid, origin=quiz;
  const alive=()=>dialog===root && getMainUser()?.uid===owner;
  cancel.onclick=close;
  root.addEventListener('cancel',event=>{event.preventDefault();close()});
  function renderRules(rules) {
    existingRows.replaceChildren();
    if (!rules?.length) {
      const empty=document.createElement('p');
      empty.textContent='目前尚未排除此章節的考法。';
      empty.style.color='#aeb8c8';existingRows.append(empty);return;
    }
    for (const rule of rules) {
      const row=document.createElement('div');
      row.className='scope-exclusion-row';
      const content=document.createElement('span');content.textContent=rule.text;
      const remove=button('取消排除');
      remove.style.fontSize='12px';
      remove.onclick=async()=>{
        remove.disabled=true;
        try {
          const result=await request({action:'remove',unit,id:rule.id});
          if(!alive())return;
          status.textContent='已取消這項排除規則。';
          renderRules(result.rules);
          window.dispatchEvent(new CustomEvent('qa:scope-exclusions-updated',{detail:{state:result.state,quiz:origin,changed:true}}));
        }catch(error){if(alive())status.textContent=error.message;}
        finally{if(remove.isConnected)remove.disabled=false;}
      };
      row.append(content,remove);existingRows.append(row);
    }
  }
  save.onclick=async()=>{
    const exclusion=text(input.value);
    if (exclusion.length<4) {
      status.textContent='請具體描述禁止出現的考法，至少 4 個字。';
      input.focus();return;
    }
    if(!alive() || window.currentActiveQuiz!==origin){
      status.textContent='題目或登入帳號已變更，請關閉後重開。';return;
    }
    save.disabled=true;status.textContent='正在儲存這項範圍限制…';
    try {
      const result=await request({action:'add',unit,text:exclusion});
      if(!alive())return;
      renderRules(result.rules);input.value='';
      status.textContent='已儲存。下次生成或取用本章節題目時會套用這項限制；目前這一題不會算作錯題。';
      window.dispatchEvent(new CustomEvent('qa:scope-exclusions-updated',{detail:{state:result.state,quiz:origin,changed:true}}));
    }catch(error){if(alive())status.textContent=error.message;}
    finally{if(save.isConnected)save.disabled=false;}
  };
  root.showModal?.();
  input.focus();
  try {
    const result=await request({action:'list',unit});
    if(alive())renderRules(result.rules);
  }catch(error){if(alive())status.textContent='現有規則讀取失敗：'+error.message;}
};
