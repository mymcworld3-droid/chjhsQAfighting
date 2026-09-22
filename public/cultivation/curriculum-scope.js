// 教材範圍選擇器；保持原有 focusedUnits 儲存格式。
(function(){
'use strict';
const files={國文:'國文/chinese.json',英文:'英文/english.json',數學:'數學/math.json',生物:'生物理化/science.json',物理:'生物理化/science.json',化學:'生物理化/science.json',地球科學:'生物理化/science.json',歷史:'歷史/history.json',地理:'地理/geogrophy.json',公民:'公民/civics.json'};
const grades=['國小一年級','國小二年級','國小三年級','國小四年級','國小五年級','國小六年級','國中一年級','國中二年級','國中三年級','高中一年級','高中二年級','高中三年級'];
const el=id=>document.getElementById(id), memo=new Map();
let grade='國中一年級',subject='數學',term='',edition='',units=[],serial=0;
function choices(id,options,selected,placeholder){const node=el(id);node.replaceChildren();const blank=document.createElement('option');blank.value='';blank.textContent=placeholder;node.append(blank);options.forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=v;node.append(o);});node.value=options.includes(selected)?selected:(options[0]||'');node.disabled=!options.length;return node.value;}
function status(s){el('cs-message').textContent=s;el('solo-unit-hint').textContent=s;}
function init(){const parent=el('solo-unit-selectors-container');if(!parent)return false;if(el('cs-scope'))return true;
const css=document.createElement('style');css.textContent='.cs-scope{display:grid;gap:9px;color:#e4d2af;font-size:12px}.cs-fields{display:grid;grid-template-columns:1fr 1fr;gap:8px}.cs-scope select,.cs-scope input:not([type=checkbox]){width:100%;min-width:0;min-height:38px;padding:7px;border:1px solid #76613d;border-radius:8px;background:#15120e;color:#eee0c0}.cs-scope button{padding:7px 10px;border:1px solid #8a7046;border-radius:8px;background:#2e2415;color:#f0d69e}.cs-scope button:disabled{opacity:.4}.cs-units{max-height:360px;overflow:auto;display:grid;gap:7px}.cs-unit{padding:9px;border:1px solid #695535;border-radius:9px}.cs-unit summary{display:flex;gap:8px;cursor:pointer}.cs-unit summary b{flex:1}.cs-unit label{display:flex;gap:8px;padding:6px 0;font-size:11px}.cs-unit input{flex:0 0 16px;accent-color:#c9a453}.cs-note{font-size:10px;color:#b8a987;line-height:1.6}@media(max-width:450px){.cs-fields{grid-template-columns:1fr}.cs-units{max-height:280px}}';document.head.append(css);
parent.innerHTML='<div class="cs-scope" id="cs-scope"><p class="cs-note">選擇年級、科目、學期、版本，可跨章節勾選並複習。內建單元為整理資料，正式名稱請以當學年度課本核對。</p><div class="cs-fields"><label>年級<select id="cs-grade"></select></label><label>科目<select id="cs-subject"></select></label><label>學期／冊次<select id="cs-term"></select></label><label>版本<select id="cs-edition"></select></label></div><label>搜尋章名或考點<input id="cs-search" placeholder="例如：方程式" maxlength="60"></label><div><button type="button" id="cs-all">勾選全部章節</button> <button type="button" id="cs-clear">取消勾選</button></div><div id="cs-units" class="cs-units"></div><button type="button" id="cs-add">加入勾選的單元</button><div class="cs-unit"><b>自訂複習範圍</b><input id="cs-custom" maxlength="90" placeholder="輸入任何科目的課程重點"><button type="button" id="cs-add-custom">加入自訂主題</button></div><p id="cs-message" role="status" class="cs-note"></p><p class="cs-note">國小與高中暫以自訂主題為主，避免誤用國中教材。</p></div>';
choices('cs-grade',grades,grade,'選年級');choices('cs-subject',Object.keys(files),subject,'選科目');
el('cs-grade').onchange=e=>{grade=e.target.value;term='';edition='';void render();};
el('cs-subject').onchange=e=>{subject=e.target.value;term='';edition='';void render();};
el('cs-term').onchange=e=>{term=e.target.value;edition='';void render();};
el('cs-edition').onchange=e=>{edition=e.target.value;void render();};
el('cs-search').oninput=()=>display();
el('cs-all').onclick=()=>el('cs-units').querySelectorAll('.cs-chapter').forEach(c=>c.checked=true);
el('cs-clear').onclick=()=>el('cs-units').querySelectorAll('[type=checkbox]').forEach(c=>c.checked=false);
el('cs-add').onclick=addChecked;el('cs-add-custom').onclick=addCustom;return true;}
async function load(){const file=files[subject];if(!memo.has(file))memo.set(file,fetch('/middle_school_unit_name/'+file.split('/').map(encodeURIComponent).join('/')).then(r=>{if(!r.ok)throw Error(r.status);return r.json();}).catch(e=>{memo.delete(file);throw e;}));return memo.get(file);}
function display(){const host=el('cs-units');if(!host)return;host.replaceChildren();const q=el('cs-search').value.trim().toLowerCase();let count=0;
units.forEach((u,i)=>{if(q&&!(u.unit+' '+u.details.join(' ')).toLowerCase().includes(q))return;count++;const group=document.createElement('details');group.className='cs-unit';group.open=units.length<5||!!q;const summary=document.createElement('summary');const c=document.createElement('input');c.type='checkbox';c.className='cs-chapter';c.dataset.i=i;c.addEventListener('click',e=>e.stopPropagation());const label=document.createElement('b');label.textContent=u.unit;summary.append(c,label);group.append(summary);
u.details.forEach((t,j)=>{const row=document.createElement('label'),box=document.createElement('input');box.type='checkbox';box.className='cs-topic';box.dataset.i=i;box.dataset.j=j;const name=document.createElement('span');name.textContent=t;row.append(box,name);group.append(row);});host.append(group);});
el('cs-add').disabled=!count;if(!count)status('此範圍無單元，請改用自訂主題。');}
async function render(){if(!init())return;const n=++serial;el('cs-grade').value=grade;el('cs-subject').value=subject;units=[];el('cs-units').replaceChildren();
choices('cs-term',[],'','讀取中');choices('cs-edition',[],'','讀取中');
if(!grade.startsWith('國中')){display();status('這個年級目前請使用自訂複習範圍。');return;}
status('正在載入…');try{const data=await load();if(n!==serial)return;
const course=Object.values(data)[0],base=course[subject]||course['自然科學']||{};
const year=['七','八','九'][grades.indexOf(grade)-6],key=Object.keys(base).find(k=>k.startsWith(year+'年級')),yearData=base[key]||{};
term=choices('cs-term',Object.keys(yearData),term,'尚無學期資料');
const semester=yearData[term]||{};
const versions=semester['各版本情境主題']?Object.keys(semester['各版本情境主題']):Object.keys(semester).filter(k=>Array.isArray(semester[k]));
edition=choices('cs-edition',versions,edition,'尚無版本資料');
const contents=semester[edition];
if(Array.isArray(contents))units=contents.map(u=>typeof u==='string'?{unit:u,details:[]}:{unit:u.unit||u.name||u.title||'',details:Array.isArray(u.details||u.sub_topics)?u.details||u.sub_topics:[]});
else units=[...(semester['核心語法']||[]).map(s=>({unit:'核心語法：'+s,details:[s]})),...(semester['各版本情境主題']?.[edition]||[]).map(s=>({unit:'情境主題：'+s,details:[s]}))];
// 科學共用同一資料檔，依實際年級／學期／科別限縮，不能將生物章節當物理出題。
if(files[subject]==='生物理化/science.json'){
const stage=grades.indexOf(grade)-6,first=term==='第一學期';
let allowed=[];
if(stage===0&&subject==='生物')allowed=units.map((_,i)=>i);
if(stage===1&&subject==='物理')allowed=first?[0,2,3,4]:[5];
if(stage===1&&subject==='化學')allowed=first?[1,5]:[0,1,2,3,4];
if(stage===2&&subject==='物理')allowed=first?[0,1,2]:[0,1];
if(stage===2&&subject==='地球科學')allowed=first?[3,4]:[2,3];
units=units.filter((_,i)=>allowed.includes(i));
}
units=units.filter(u=>u.unit);display();if(units.length)status('勾選整章或展開選取考點，再加入清單。');
}catch(e){if(n!==serial)return;display();status('單元資料讀取失敗，可以先使用自訂主題。');console.error('[Curriculum]',e);}}
function addList(items){const existing=Array.isArray(window.soloSelectedUnits)?window.soloSelectedUnits:[],keys=new Set(existing.map(u=>JSON.stringify([u.path,u.detail,u.sub_topics])));let added=0;
for(const item of items){const k=JSON.stringify([item.path,item.detail,item.sub_topics]);if(keys.has(k))continue;if(existing.length>=24)break;existing.push(item);keys.add(k);added++;}
window.soloSelectedUnits=existing;window.renderSelectedUnitsList();status(added?'已加入 '+added+' 個範圍，請按「儲存出題範圍」。':'已存在，或達 24 個上限。');}
function addChecked(){const groups=[...el('cs-units').querySelectorAll('.cs-chapter:checked')].map(c=>+c.dataset.i),chosen=new Set(groups),parts=[...el('cs-units').querySelectorAll('.cs-topic:checked')];const year=['七','八','九'][grades.indexOf(grade)-6],path=[subject,year+(term==='第一學期'?'上':term==='第二學期'?'下':'年級全學年'),edition].join('/');
const result=groups.map(i=>({path,detail:units[i].unit,sub_topics:units[i].details.slice(0,8)}));parts.forEach(c=>{const i=+c.dataset.i,j=+c.dataset.j;if(chosen.has(i))return;const u=units[i];result.push({path,detail:(u.unit+'－'+u.details[j]).slice(0,100),sub_topics:[u.details[j]]});});if(!result.length)return status('請先勾選章節或考點。');addList(result);}
function addCustom(){const value=el('cs-custom').value.trim();if(!value)return status('請先輸入主題。');addList([{path:subject+'/'+grade+'/自訂',detail:value,sub_topics:[]}]);el('cs-custom').value='';}
function showList(){const host=el('solo-selected-units-list');if(!host)return;host.replaceChildren();const items=window.soloSelectedUnits||[];const p=document.createElement('p');p.className='cs-note';p.textContent='已選 '+items.length+' / 24 項';host.append(p);items.forEach((u,i)=>{const row=document.createElement('div');row.className='cs-unit';row.style.display='flex';row.style.gap='8px';const label=document.createElement('span');label.style.flex='1';label.style.overflowWrap='anywhere';label.textContent=u.path+' · '+(u.detail||'全部');const del=document.createElement('button');del.type='button';del.textContent='移除';del.onclick=()=>{window.soloSelectedUnits.splice(i,1);showList();};row.append(label,del);host.append(row);});}
window.renderSoloUnitSelectors=async()=>{const x=el('set-level')?.value;if(!el('cs-scope')&&grades.includes(x))grade=x;await render();};
window.addCurrentUnitToSelection=addChecked;window.renderSelectedUnitsList=showList;
window.removeSelectedUnit=i=>{window.soloSelectedUnits.splice(i,1);showList();};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>void render(),{once:true});else void render();
})();