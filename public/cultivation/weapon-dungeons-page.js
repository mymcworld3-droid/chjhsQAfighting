import {authenticatedMainFetch,getMainUser} from './data/project-repository.js';
let dialog=null,data=null,loading=false,serial=0,trigger=null;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function ensure(){
  if(dialog)return;
  if(!document.getElementById('weapon-dungeons-style')){const link=document.createElement('link');link.id='weapon-dungeons-style';link.rel='stylesheet';link.href='/styles/weapon-dungeons.css';document.head.append(link);}
  dialog=document.createElement('dialog');dialog.id='weapon-dungeons-dialog';dialog.setAttribute('aria-labelledby','weapon-dungeons-title');
  document.body.append(dialog);
  dialog.addEventListener('click',event=>{
    if(event.target.closest('[data-wd-close]')){dialog.close();return;}
    if(event.target===dialog){const b=dialog.getBoundingClientRect();if(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom)dialog.close();return;}
    const button=event.target.closest('[data-wd-difficulty]');
    if(!button||loading||button.disabled||!data)return;
    void enter(Number(button.dataset.wdDifficulty));
  });
  dialog.addEventListener('close',()=>{if(loading){serial++;loading=false;}trigger?.focus?.({preventScroll:true});});
  window.addEventListener('xiuxian:user-data-ready',()=>{serial++;data=null;loading=false;if(dialog.open)dialog.close();});
}
function paint(message=''){
  dialog.innerHTML=`<header><div><small>單人 · 武器副本</small><h2 id="weapon-dungeons-title">尖峰石域</h2></div><button type="button" data-wd-close aria-label="關閉武器副本">×</button></header>
    <div class="wd-body"><div class="wd-tickets"><strong>副本券 ${data?data.tickets+' / 5':'同步中'}</strong><span>每日補發 3 張 · 最多持有 5 張（臺灣時間）</span></div>
    <p>重甲靈獸盤踞的石域。靈獸傷害高、每回合最多移動一格；預攻擊會追蹤你的站位，退出射程可避開，成功擊退則會打斷蓄勢。</p>
    <div class="wd-bonus">圖騰攻擊傷害 +15%</div>
    <p>清除守衛後，最深處的領主才會甦醒。沿用問道試煉的答題充能與回合戰鬥。</p>
    <div class="wd-difficulties" role="group" aria-label="選擇副本難度">${(data?.difficulties||[]).map(d=>{
      const resume=data.active?.difficulty===d.index;
      const disabled=loading||d.locked||!resume&&(data.tickets<1||!!data.active);
      return `<button type="button" data-wd-difficulty="${d.index}" ${disabled?'disabled':''}>
        <strong>${esc(d.name)}</strong><span>${resume?'繼續挑戰 · 不耗券':d.locked?'通過前一難度解鎖':data.clears[d.index]?'已通關 · 再次挑戰':'開始挑戰'}</span>
        <small>30% ${esc(d.name)}武器 · 20% ${esc(d.nextRealm)}武器</small></button>`;
    }).join('')}</div>
    ${data?.active?'<p>已有進行中的挑戰，請先完成或離場，再選擇其他難度。</p>':''}
    <p class="wd-cost">每次新挑戰消耗 1 張券，中途離場或失敗不退券。掉落互斥：30% 當階、20% 下一階、50% 無武器。同款武器保留最高等階並累計各階數量。</p>
    <p class="wd-message" role="status" aria-live="polite">${esc(message)}</p></div>`;
}
async function enter(difficulty){
  const account=getMainUser()?.uid,token=++serial;
  loading=true;paint('正在進入石域…');
  try{
    const battle=await import('./tactical-combat.js');
    if(serial!==token||getMainUser()?.uid!==account)return;
    const selected=data.difficulties.find(d=>d.index===difficulty);
    if(!selected||selected.locked)throw Error('請先通過前一個難度');
    loading=false;dialog.close();
    await battle.openTacticalCombat('weapon-dungeon',{dungeonId:'peak-stone',difficulty});
  }catch(error){if(serial===token&&getMainUser()?.uid===account){loading=false;paint(error.message||'副本暫時無法開啟');if(!dialog.open)dialog.showModal();}}
  finally{if(serial===token)loading=false;}
}
export async function openWeaponDungeons(){
  const account=getMainUser()?.uid;
  if(!account){window.showToast?.('請先登入後挑戰武器副本');return;}
  ensure();trigger=document.activeElement;data=null;loading=true;paint('正在同步副本券與難度…');
  if(!dialog.open)dialog.showModal();
  const token=++serial;
  try{
    const response=await authenticatedMainFetch('/api/tactical/weapon-dungeons');
    const result=await response.json();
    if(serial!==token||getMainUser()?.uid!==account)return;
    if(!response.ok||!result.ok)throw Error(result.error||'副本資料同步失敗');
    data=result.state;loading=false;paint();
  }catch(error){if(serial===token){loading=false;paint(error.message||'副本資料同步失敗');}}
}
function mount(){
  const target=document.querySelector('#page-gameplay .gameplay-entries');
  if(!target||document.getElementById('gameplay-weapon-dungeon-entry'))return;
  const button=document.createElement('button');button.type='button';button.id='gameplay-weapon-dungeon-entry';button.className='gameplay-dungeon-entry';
  button.innerHTML='<i class="fa-solid fa-mountain" aria-hidden="true"></i><span><strong>武器副本</strong><small>單人挑戰 · 尖峰石域</small></span><i class="fa-solid fa-chevron-right" aria-hidden="true"></i>';
  button.addEventListener('click',()=>void openWeaponDungeons());target.append(button);
}
window.openWeaponDungeons=openWeaponDungeons;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
export const featureReady=Promise.resolve();
