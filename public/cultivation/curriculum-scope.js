// 教材範圍選擇器；年級 → 科目 → 全學年章節，保持原有 focusedUnits 儲存格式。
(function(){
'use strict';
const files={國文:'國文/chinese.json',英文:'英文/english.json',數學:'數學/math.json',生物:'生物理化/science.json',物理:'生物理化/science.json',化學:'生物理化/science.json',地球科學:'生物理化/science.json',歷史:'歷史/history.json',地理:'地理/geogrophy.json',公民:'公民/civics.json',資訊科技:'高中專屬'};
const grades=['國小一年級','國小二年級','國小三年級','國小四年級','國小五年級','國小六年級','國中一年級','國中二年級','國中三年級','高中一年級','高中二年級','高中三年級'];
const highCore=new Set(['數學','數學A','數學B','數學甲','數學乙','物理','化學','生物','地球科學']);
const highSubjectList=g=>{
 const math=g==='高中一年級'?['數學']:g==='高中二年級'?['數學A','數學B']:['數學甲','數學乙'];
 return ['國文','英文',...math,'物理','化學','生物','地球科學','歷史','地理','公民','資訊科技'];
};
const elementarySubjectList=g=>{
 const lower=/^國小[一二]年級$/.test(g);
 return lower?['國語','數學','生活','健康與體育','本土語文']:
 ['國語','英文','數學','自然科學','社會','藝術','綜合活動','健康與體育','本土語文'];
};
const elementaryFile=s=>s==='數學'?'math.json':['國語','生活','社會','自然科學'].includes(s)?'core.json':'other.json';
const subjectOptions=g=>g.startsWith('國小')?elementarySubjectList(g):g.startsWith('高中')?highSubjectList(g):Object.keys(files).filter(k=>k!=='資訊科技');
const sourcePath=(sub,g)=>g.startsWith('國小')?'elementary_school_unit_name/'+elementaryFile(sub)
 :g.startsWith('高中')?'high_school_unit_name/'+(highCore.has(sub)?'core.json':'humanities.json')
 :'middle_school_unit_name/'+files[sub];
const el=id=>document.getElementById(id), memo=new Map();
const AUTO_TERM='全學年',AUTO_EDITION='自動整合';
let grade='國中一年級',subject='數學',term=AUTO_TERM,edition=AUTO_EDITION,units=[],serial=0;
const draft=new Set();
function updateDraft(){const n=el('cs-draft-count');if(n)n.textContent=String(draft.size);window.dispatchEvent(new CustomEvent('curriculum:scope-draft-change',{detail:{count:draft.size}}));}
function choices(id,options,selected,placeholder){const node=el(id);node.replaceChildren();const blank=document.createElement('option');blank.value='';blank.textContent=placeholder;node.append(blank);options.forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=v;node.append(o);});node.value=options.includes(selected)?selected:(options[0]||'');node.disabled=!options.length;return node.value;}
function status(s){el('cs-message').textContent=s;el('solo-unit-hint').textContent=s;}
function init(){const parent=el('solo-unit-selectors-container');if(!parent)return false;if(el('cs-scope'))return true;
const css=document.createElement('style');css.textContent='.cs-scope{display:grid;gap:9px;color:#e4d2af;font-size:12px}.cs-fields{display:grid;grid-template-columns:1fr 1fr;gap:8px}.cs-scope select,.cs-scope input:not([type=checkbox]){width:100%;min-width:0;min-height:38px;padding:7px;border:1px solid #76613d;border-radius:8px;background:#15120e;color:#eee0c0}.cs-scope button{padding:7px 10px;border:1px solid #8a7046;border-radius:8px;background:#2e2415;color:#f0d69e}.cs-scope button:disabled{opacity:.4}.cs-units{max-height:360px;overflow:auto;display:grid;gap:7px}.cs-unit{padding:9px;border:1px solid #695535;border-radius:9px}.cs-unit summary{display:flex;align-items:center;gap:8px;cursor:pointer}.cs-unit summary b{flex:1}.cs-card-term{flex:0 0 auto;padding:2px 6px;border:1px solid rgba(201,164,83,.42);border-radius:999px;color:#d9bd7e;font-size:9px;font-weight:800}.cs-unit label{display:flex;gap:8px;padding:6px 0;font-size:11px}.cs-unit input{flex:0 0 16px;accent-color:#c9a453}.cs-note{font-size:10px;color:#b8a987;line-height:1.6}@media(max-width:450px){.cs-fields{grid-template-columns:1fr}.cs-units{max-height:280px}}';document.head.append(css);
parent.innerHTML='<div class="cs-scope" id="cs-scope"><p class="cs-note">選擇年級與科目後，直接顯示合併上下學期的章節與考點。版本不再另外選擇；有 108 課綱複習整理時會優先採用。</p><div class="cs-fields"><label>年級<select id="cs-grade"></select></label><label>科目<select id="cs-subject"></select></label><select id="cs-term" hidden aria-hidden="true"></select><select id="cs-edition" hidden aria-hidden="true"></select></div><label class="cs-search-field">搜尋章名或考點<input id="cs-search" placeholder="例如：方程式" maxlength="60"></label><div class="cs-tools"><span class="cs-tools-caption">全學年課程章節 <span id="cs-draft-count">0</span> 項待加入</span><div class="cs-tools-actions"><button type="button" id="cs-all">全選目前章節</button><button type="button" id="cs-clear">清除勾選</button></div></div><div id="cs-units" class="cs-units"></div><button type="button" id="cs-add">加入勾選的單元</button><div class="cs-unit cs-custom-panel"><b>自訂複習範圍</b><input id="cs-custom" maxlength="90" placeholder="輸入任何科目的課程重點"><button type="button" id="cs-add-custom">加入自訂主題</button></div><p id="cs-message" role="status" class="cs-note"></p><p class="cs-note">上下學期已合併；章節旁仍會標示上／下學期，方便辨識原本冊次。</p></div>';
choices('cs-grade',grades,grade,'選年級');subject=choices('cs-subject',subjectOptions(grade),subject,'選科目');
el('cs-grade').onchange=e=>{grade=e.target.value;subject=subjectOptions(grade).includes(subject)?subject:subjectOptions(grade)[0];term=AUTO_TERM;edition=AUTO_EDITION;void render();};
el('cs-subject').onchange=e=>{subject=e.target.value;term=AUTO_TERM;edition=AUTO_EDITION;void render();};
el('cs-search').oninput=()=>display();
el('cs-all').onclick=()=>{el('cs-units').querySelectorAll('.cs-chapter').forEach(c=>draft.add('c:'+c.dataset.i));display();};
el('cs-clear').onclick=()=>{draft.clear();display();};
el('cs-add').onclick=addChecked;el('cs-add-custom').onclick=addCustom;return true;}
async function load(){const file=sourcePath(subject,grade);if(!memo.has(file))memo.set(file,fetch('/'+file.split('/').map(encodeURIComponent).join('/')).then(r=>{if(!r.ok)throw Error(r.status);return r.json();}).catch(e=>{memo.delete(file);throw e;}));return memo.get(file);}
function display(){const host=el('cs-units');if(!host)return;host.replaceChildren();const q=el('cs-search').value.trim().toLowerCase();let count=0;
units.forEach((u,i)=>{if(q&&!(u.term+' '+u.unit+' '+u.details.join(' ')).toLowerCase().includes(q))return;count++;const group=document.createElement('details');group.className='cs-unit';group.open=units.length<5||!!q;const summary=document.createElement('summary');
const number=document.createElement('span');number.className='cs-card-number';number.textContent=String(i+1).padStart(2,'0');
const c=document.createElement('input');c.type='checkbox';c.className='cs-chapter';c.dataset.i=i;c.checked=draft.has('c:'+i);c.setAttribute('aria-label','選取整章：'+u.term+' '+u.unit);
c.addEventListener('click',e=>e.stopPropagation());c.addEventListener('change',()=>{const k='c:'+i;c.checked?draft.add(k):draft.delete(k);updateDraft();});
const termBadge=document.createElement('span');termBadge.className='cs-card-term';termBadge.textContent=u.term==='第一學期'?'上學期':u.term==='第二學期'?'下學期':u.term;
const label=document.createElement('b');label.textContent=u.unit;summary.append(number,c,termBadge,label);group.append(summary);
const hint=document.createElement('small');hint.className='cs-card-count';hint.textContent=u.details.length?u.details.length+' 個考點 · 點開可個別選取':'勾選此章節';group.append(hint);
u.details.forEach((t,j)=>{const row=document.createElement('label'),box=document.createElement('input');box.type='checkbox';box.className='cs-topic';box.dataset.i=i;box.dataset.j=j;box.checked=draft.has('t:'+i+':'+j);box.addEventListener('change',()=>{const k='t:'+i+':'+j;box.checked?draft.add(k):draft.delete(k);updateDraft();});
const name=document.createElement('span');name.textContent=t;row.append(box,name);group.append(row);});host.append(group);});
el('cs-add').disabled=!count;updateDraft();if(!count)status('此範圍無單元，請改用自訂主題。');}
function normalizeUnitList(list,semesterName){
 const source=Array.isArray(list)?list:[];
 return source.map(u=>typeof u==='string'?{unit:u,details:[],term:semesterName}:{unit:u.unit||u.name||u.title||'',details:Array.isArray(u.details||u.sub_topics)?u.details||u.sub_topics:[],term:semesterName}).filter(u=>u.unit);
}
function scienceSemesterFilter(list,semesterName){
 if(!grade.startsWith('國中')||files[subject]!=='生物理化/science.json')return list;
 const stage=grades.indexOf(grade)-6,first=semesterName==='第一學期';
 let allowed=[];
 if(stage===0&&subject==='生物')allowed=list.map((_,i)=>i);
 if(stage===1&&subject==='物理')allowed=first?[0,2,3,4]:[5];
 if(stage===1&&subject==='化學')allowed=first?[1,5]:[0,1,2,3,4];
 if(stage===2&&subject==='物理')allowed=first?[0,1,2]:[0,1];
 if(stage===2&&subject==='地球科學')allowed=first?[3,4]:[2,3];
 return list.filter((_,i)=>allowed.includes(i));
}
function semesterUnits(semester,semesterName){
 if(!semester||typeof semester!=='object')return[];
 if(Array.isArray(semester['108課綱複習版']))return normalizeUnitList(semester['108課綱複習版'],semesterName);
 if(Array.isArray(semester['核心語法'])){
  const grammar=semester['核心語法'].map(s=>({unit:'核心語法：'+s,details:[s],term:semesterName}));
  const seen=new Set(),themes=[];
  Object.values(semester['各版本情境主題']||{}).forEach(list=>(Array.isArray(list)?list:[]).forEach(s=>{const key=String(s).trim();if(!key||seen.has(key))return;seen.add(key);themes.push({unit:'情境主題：'+key,details:[key],term:semesterName});}));
  return [...grammar,...themes];
 }
 const versions=Object.keys(semester).filter(k=>Array.isArray(semester[k]));
 const preferred=versions.includes('翰林版')?'翰林版':versions[0];
 return scienceSemesterFilter(normalizeUnitList(semester[preferred]||[],semesterName),semesterName);
}
function mergeYearUnits(yearData){
 const semesterNames=['第一學期','第二學期',...Object.keys(yearData||{}).filter(k=>!['第一學期','第二學期'].includes(k))];
 return semesterNames.flatMap(name=>semesterUnits(yearData?.[name],name));
}
async function render(){if(!init())return;const n=++serial;draft.clear();el('cs-grade').value=grade;subject=choices('cs-subject',subjectOptions(grade),subject,'選科目');term=choices('cs-term',[AUTO_TERM],AUTO_TERM,'全學年');edition=choices('cs-edition',[AUTO_EDITION],AUTO_EDITION,'自動整合');units=[];el('cs-units').replaceChildren();
if(!grade.startsWith('國中')&&!grade.startsWith('高中')&&!grade.startsWith('國小')){display();status('這個年級目前請使用自訂複習範圍。');return;}
status('正在載入全學年章節…');try{const data=await load();if(n!==serial)return;
let yearData;
if(grade.startsWith('高中')||grade.startsWith('國小')){
 yearData=data.subjects?.[subject]?.[grade]||{};
}else{
 const course=Object.values(data)[0],base=course[subject]||course['自然科學']||{};
 const year=['七','八','九'][grades.indexOf(grade)-6],key=Object.keys(base).find(k=>k.startsWith(year+'年級'));
 yearData=base[key]||{};
}
units=mergeYearUnits(yearData).filter(u=>u.unit);display();
if(units.length)status('已合併第一、第二學期；直接勾選章節或展開選取考點，再加入清單。');
window.dispatchEvent(new CustomEvent('curriculum:options-ready',{detail:{grade,subject,term:AUTO_TERM,edition:AUTO_EDITION,available:units.length}}));
}catch(e){if(n!==serial)return;display();status('單元資料讀取失敗，可以先使用自訂主題。');window.dispatchEvent(new CustomEvent('curriculum:options-ready',{detail:{grade,subject,term:AUTO_TERM,edition:AUTO_EDITION,available:0,error:true}}));console.error('[Curriculum]',e);}}
function addList(items){const existing=Array.isArray(window.soloSelectedUnits)?window.soloSelectedUnits:[],keys=new Set(existing.map(u=>JSON.stringify([u.path,u.detail,u.sub_topics])));let added=0;
for(const item of items){const k=JSON.stringify([item.path,item.detail,item.sub_topics]);if(keys.has(k))continue;if(existing.length>=24)break;existing.push(item);keys.add(k);added++;}
window.soloSelectedUnits=existing;window.renderSelectedUnitsList();status(added?'已加入 '+added+' 個範圍，請按「儲存出題範圍」。':'已存在，或達 24 個上限。');}
function addChecked(){const groups=[...draft].filter(k=>k.startsWith('c:')).map(k=>+k.slice(2)).sort((a,b)=>a-b),chosen=new Set(groups);
const parts=[...draft].filter(k=>k.startsWith('t:')).map(k=>k.slice(2).split(':').map(Number));
const year=['七','八','九'][grades.indexOf(grade)-6];
const canonicalSubject=/^數學(?:A|B|甲|乙)$/.test(subject)?'數學':subject==='國語'?'國文':subject;
const path=(grade.startsWith('高中')||grade.startsWith('國小'))?[canonicalSubject,grade,AUTO_TERM,subject].join('/')
 :[subject,year+'年級全學年'].join('/');
const detailFor=u=>(u.term?u.term+' · ':'')+u.unit;
const result=groups.map(i=>({path,detail:detailFor(units[i]),sub_topics:units[i].details.slice(0,8)}));
parts.forEach(([i,j])=>{if(chosen.has(i)||!units[i]?.details[j])return;const u=units[i];result.push({path,detail:(detailFor(u)+'－'+u.details[j]).slice(0,100),sub_topics:[u.details[j]]});});
if(!result.length)return status('請先勾選章節或考點。');
addList(result);draft.clear();display();}
function addCustom(){const value=el('cs-custom').value.trim();if(!value)return status('請先輸入主題。');addList([{path:(/^數學(?:A|B|甲|乙)$/.test(subject)?'數學':subject==='國語'?'國文':subject)+'/'+grade+'/自訂/'+subject,detail:value,sub_topics:[]}]);el('cs-custom').value='';}
function showList(){const host=el('solo-selected-units-list');if(!host)return;host.replaceChildren();const items=window.soloSelectedUnits||[];const p=document.createElement('p');p.className='cs-note';p.textContent='已選 '+items.length+' / 24 項';host.append(p);items.forEach((u,i)=>{const row=document.createElement('div');row.className='cs-unit';row.style.display='flex';row.style.gap='8px';const label=document.createElement('span');label.style.flex='1';label.style.overflowWrap='anywhere';label.textContent=u.path+' · '+(u.detail||'全部');const del=document.createElement('button');del.type='button';del.textContent='移除';del.onclick=()=>{window.soloSelectedUnits.splice(i,1);showList();};row.append(label,del);host.append(row);});}
window.renderSoloUnitSelectors=async()=>{const x=el('set-level')?.value;if(!el('cs-scope')){if(grades.includes(x))grade=x;else if(x==='國小中年級')grade='國小三年級';else if(x==='國小高年級')grade='國小五年級';else if(x==='高中職')grade='高中一年級';}await render();};
window.addCurrentUnitToSelection=addChecked;window.renderSelectedUnitsList=showList;
window.removeSelectedUnit=i=>{window.soloSelectedUnits.splice(i,1);showList();};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>void render(),{once:true});else void render();
})();