#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const R=require('../public/cultivation/tactical-rules.js'),Innate=require('../public/cultivation/innate-ability.js');
const root=path.resolve(__dirname,'..'),directory=path.join(root,'docs/balance/tactical-v1'),data=JSON.parse(fs.readFileSync(path.join(directory,'results.json'),'utf8'));
for(const [file,hash]of [['public/cultivation/tactical-rules.js',data.rulesSha256],['scripts/lib/tactical-balance.cjs',data.policySha256]]){
  if(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')!==hash)throw Error('Results are stale: '+file);
}
const main=data.pvp.find(p=>p.accuracy===.7),rows=main.summary.rows,percent=n=>n.toFixed(2)+'%',one=n=>n.toFixed(1)+'%';
const find=(id,accuracy=.7)=>data.pvp.find(p=>p.accuracy===accuracy).summary.rows.find(r=>r.id===id);
const trials=id=>data.pve.filter(r=>r.variant===id),trialPercent=id=>{const t=trials(id);return 100*t.reduce((n,r)=>n+r.wins,0)/t.reduce((n,r)=>n+r.games,0);};
const spirit=v=>{const id=Object.keys(R.SPIRIT_BRANCHES[v.core]||{}).find(k=>R.SPIRIT_BRANCHES[v.core][k]===v.branch);return Innate.branches(v.core).find(b=>b.id===id)?.name||'未結丹預設';};
const notes={
  surge:['直線最多四格，各命中者受到 1.45A 普通傷害，再推開最多兩格。A=200 時為 290 傷害。','推開路徑遇障礙、邊界或角色便停；只推仍存活的敵人。妖獸真的被推動後，其已蓄勢紅框會被打斷；頂在牆邊未動不會打斷。','適合直線穿透、多怪排隊與打斷妖獸；PvP 推開後也可能增加自己下一次追擊的體力成本。'],
  tide:['目標與四個正交鄰格，最多五格，各造成 1.1A 普通傷害，並施加緩速。A=200 時為 220 傷害。','不是 3×3 九格。緩速使角色下一次普通移動每格耗 2 體力，移動後清除；對妖獸則降低下一次移動格數，沒有額外扣血。','適合怪物聚集與限制位移；單挑多半只能打中一人，主要收益是緩速與射程。'],
  renew:['對自己回復 32% 最大生命，補至上限為止。H=1000 時最多回復 320。','沒有額外護盾，也不會按答對題數自動發動。必須花體力及一個攻擊／技能次數主動施放。','適合長期換血；高血量／攻擊比例會提高其相對收益。滿血時施放沒有治療收益。'],
  drain:['攻擊三格內一名敵人，造成 1.35A 普通傷害；回復實際扣除敵人生命之傷害的 65%。A=200、無防禦時傷害 270、回復 176（四捨五入）。','護盾吸收與護身減免後才計算吸血；敵人僅剩 100 生命時最多扣 100、回復 65。治療不超過自身生命上限。','適合持續輸出兼補血；對大量護盾的對手，傷害與吸血都會減少。'],
  barrier:['對自己取得至少 40% 最大生命的護盾，持續至被擊破。H=1000 時護盾門檻為 400。','採 max(現有護盾,400)，不是每次相加 400；此恢復型技能並將護盾限制於 H。沒有額外治療。','適合預先防守與長期換血；受到穿盾真傷時，護盾保護會被繞過。'],
  focus:['攻擊四格內一名敵人，造成 1.7A 普通傷害。A=200 時為 340。','目標必須是視線內的敵人；不是直線限制，斜向也可，但仍採曼哈頓距離，並受障礙遮蔽。','適合遠距單體壓血、搶先出手；沒有範圍傷害或控制效果。'],
  execute:['攻擊兩格內一名敵人，通常造成 1.35A；目標生命比例 ≤40% 時改為 2.2A。A=200 時分別為 270／440。','40% 整也符合條件，依出招當下的目標生命判斷；不是必殺，也不附穿盾。','適合低血量收尾；近距離門檻使追擊與移動體力安排更重要。'],
  breach:['躍至三格內空地，對落點四個正交相鄰格的敵人各造成 1.2A 普通傷害。A=200 時為 240。','位移加爆發共只收 4 體力；落點必須空、可通行且在視線內。斜角不算相鄰，不能直接落在敵人身上。','適合進退、穿過角色佔據的通道與多怪爆發；不能跨過會遮住落點視線的石障。'],
  meteor:['在四格內標記目標及四個正交鄰格；下一次自身回合開始時，各仍在標記格的敵人受到 1.9A 普通傷害。A=200 時為 380。','不是立即命中，也不追蹤移動。先讓對手／妖獸行動，再落下；若已因生命或回合上限結束，不會再等隕星補結算。','適合封位、逼迫移動，PvE 可預判妖獸落點。此策略對手會躲標記，故低 PvP 模擬值不能視為誘敵打法的上限。'],
  orbit:['躍至四格內空地，並取得至少 15% 最大生命的護盾。H=1000 時為 150。','消耗固定 3 體力，不再按位移格數收費。護盾取 max(現有,150) 而非相加；落點要空且有視線。','適合越過角色、脫離紅框與調位；技能本身沒有傷害，不能拿同回合兩次輸出能力直接比較。'],
  purify:['攻擊三格內一名敵人，造成 1.25A 真實傷害，繞過護盾與護身減傷。A=200 時直接扣 250 生命。','「真傷」不表示無視距離、障礙或雷返：已啟動的雷返仍可被此次命中觸發。','適合對付凝障、無塵與護身；對完全沒有防禦的敵人，其單次倍率低於部分普通傷害技能。'],
  cleanse:['移除自身緩速、回復 12% 最大生命，並將護盾補到至少 30% 最大生命。H=1000 時最多補 120 生命、護盾門檻 300。','護盾不累加，恢復型技能護盾不超過 H；治療不會溢出生命上限。淨化只移除現有緩速。','適合持續防守兼淨化；本模型中治療加護盾的組合特別強，遇穿盾真傷時防守收益下降。'],
  lightning:['目標及四個正交鄰格最多五格，各受到 1.4A 普通傷害。A=200 時每名敵人為 280。','同一次施放命中多個敵人，只花一次體力與攻擊次數；形狀是十字，不包含四個斜角。','適合清理群怪；單挑無法取得多人同時受傷的優勢，範圍技的 PvE 定位較明顯。'],
  counter:['對自己啟動 40% 護身減傷，並在第一次被命中且存活時，反擊自身攻擊力的 80%。A=200 時反擊 160。','反擊基數是自己的 A，不是對方這次傷害；只反擊一次，至下次自身回合開始即重設。真傷仍能觸發；若被一擊擊倒則不反擊。','適合準備承受下一次攻擊時使用；與免費護身的 40% 減傷不相加，主要額外收益在一次反擊。'],
  reversal:['攻擊兩格內一名敵人，倍率為 1.15+1.15×(1−自身生命/H)。滿血 1.15A、半血 1.725A，瀕死時接近 2.3A。A=200、半血為 345。','依出手當下的已失生命比例計算，不扣自己的血，也不是固定低血觸發率。仍受普通傷害防禦影響。','適合受傷後反打；低血量傷害高也伴隨被擊倒的風險，不附帶原版陰陽被動減傷。'],
  exchange:['與三格內一名敵人交換位置，並對交換後的該敵人造成 0.65A 普通傷害。A=200 時為 130。','需要視線，目標必須是敵人；對妖獸會打斷原蓄勢。這是交換兩人的位置，不是把敵人拉到相鄰空地。','適合拆陣、把妖獸換離預告位置或改變攻擊角度；本策略未做多回合誘敵陷阱，且每場施放極少，PvP 數字主要反映這套操作策略。'],
  lunge:['突進至三格內敵人身旁，造成 1.45A 普通傷害。A=200 時為 290。','敵人需在曼哈頓三格與視線內，且能找到不超過三步的合法相鄰落點路徑；突進不另收逐格體力。','適合近身追擊；不能穿越阻擋路線的地形，也不會像踏陣般同時傷害一圈敵人。'],
  blades:['沿上下左右任一方向，最多四格，各敵人受到 1.6A 普通傷害。A=200 時每名敵人為 320。','可穿過角色命中後方敵人，遇障礙或邊界停止；不是選四個方向同時攻擊。','適合直線遠打與多怪穿透；被敵人切成斜向時，要先花體力調整同列／同行。']
};
const table=(headers,body)=>'| '+headers.join(' | ')+' |\n| '+headers.map(()=>'---').join(' | ')+' |\n'+body.map(row=>'| '+row.join(' | ')+' |').join('\n')+'\n';
const pvpCounts=data.pvp.reduce((n,p)=>n+p.summary.games,0),baselineCount=data.baseline.reduce((n,p)=>n+p.games,0),pveCount=data.pve.reduce((n,p)=>n+p.games,0);
let md=`# 九丹十八分支：戰棋技能詳解與模擬勝率\n\n適用分支：\`stamina-battle\`；戰鬥規則基準：\`${data.sourceRevision}\`。這是**離線策略機器人模擬，並非真人對戰統計**。本次只整理及評估，沒有修改金丹數值、技能或遊戲規則。\n\n`;
md+=`## 模擬條件與讀法\n\n- 雙方統一攻擊 A=200、生命 H=1000，開場護盾 0，無法寶與額外被動。此為技能正規化比較，不代表某一境界的正式帳號數值。\n- 主表雙方答對率均為 70%；另做 50%／90% 敏感度比較。答題由正式 \`R.answer\` 結算，答對 +4、答錯 +1，最多兩題／自身回合，體力上限 10。\n- 十八分支各對另外十七分支，包含同金丹另一分支，排除自身鏡像。三張正式 PvP 地圖等權；每圖 ${data.config.seeds} 組答題種子，各交換先後手一次：每組對戰 ${data.config.seeds*6} 場，每分支 ${rows[0].games.toLocaleString('en-US')} 場。未結丹基準另外統計，不放入主排名。\n- 主表純勝率 = 勝場／總場；和局獨立列出。積分率 =（勝場+0.5×和局）／總場，**積分率不是純勝率**。十八分支的平均積分率必為 50%，純勝率平均會因和局而較低。\n- 95% 區間以 ${data.config.seeds} 組答題種子做 2,000 次叢集重抽樣；同一種子的所有地圖、對手與先後手一起抽取，避免把相關場次當成獨立樣本。區間只描述這套固定策略的種子變異，不包含真人技巧或策略模型的不確定性。50%／90% 各只有 ${data.config.sensitivitySeeds} 組種子，精度較低。\n- 本次共 ${Number(pvpCounts+baselineCount+pveCount).toLocaleString('en-US')} 場：十八分支循環賽 ${pvpCounts.toLocaleString('en-US')}、未結丹基準 ${baselineCount.toLocaleString('en-US')}、逐關試煉 ${pveCount.toLocaleString('en-US')}。全程本機，不呼叫出題／帳號 API，不讀寫正式資料庫。\n\n`;
md+=`策略會依現有體力、冷卻、視線與可通行格走位；優先可命中的攻擊與有效治療／護盾，考慮一次後續出招、反擊損失、妖獸紅框及對手隕星。使用自己已知的答對率估算後續體力，不預看後續答案。答案按種子、座位、自身回合數與該回合第 1／2 題固定；50%／90% 欄皆同時變更雙方答對率，用來檢查相對強弱如何改變。每回合至多一次主動接近，再保留一次紅框閃避移動；每次動作都由正式 \`tactical-rules.js\` 驗證／結算。這是固定的有限前瞻策略，沒有替各分支手動調參，也不等於最優打法，尤其低估多步誘敵、換位陷阱與部分控場價值。\n\n`;
md+=`主表中，先手一方勝率 ${percent(main.summary.seat0WinPercent)}，和局 ${percent(main.summary.drawPercent)}；${percent(main.summary.turnLimitPercent)} 的戰鬥由回合上限結束，平均 ${main.summary.meanTurns.toFixed(2)} 次單方行動。先後手已成對交換以抵銷偏差；**先手本身仍是目前規則很大的優勢**。PvP 上限是合計 60 次單方行動，並非雙方各 60 回合；上限後以生命比例判勝負，護盾不列入比例。未模擬兩分鐘操作逾時。\n\n`;
md+='## 金丹整體比較\n\n以下每一丹都是兩個分支的等權平均，不是選最強分支，也不是只比較同丹內戰。\n\n';
md+=table(['金丹','70% 答對率：純勝率','和局率','積分率'],main.summary.byCore.map(c=>[c.name,percent(c.winPercent),percent(c.drawPercent),percent(c.scorePercent)]));
md+='\n## 十八分支勝率總表\n\n';
md+=table(['金丹／分支','技能','50% 答對率','70% 答對率','70% 的 95% 區間','和局率（70%）','90% 答對率','試煉六關平均'],rows.map(r=>[r.coreName+'／'+r.branchName,r.skill,percent(find(r.id,.5).winPercent),'**'+percent(r.winPercent)+'**',r.ci95.map(n=>n.toFixed(2)).join('～')+'%',percent(r.drawPercent),percent(find(r.id,.9).winPercent),percent(trialPercent(r.id))]));
md+='\n## 共同規則與舊版差異\n\n1. 普通攻擊花 2 體力，四向擇一，沿該方向兩格各造成 1A；遇障礙停止。每回合攻擊、技能及護身合計最多兩次；移動、答題不占這兩次，但受總操作上限限制。\n2. 目前所有金丹技能冷卻都是 2：第 1 次自身回合施放，第 2 次不能，第 3 次可以再次施放。兩次自身回合之間，PvP 還會穿插對手行動。\n3. 除自身技能外，射程按曼哈頓距離 |Δx|+|Δy| 計算，且需要視線；斜向兩格等於四點距離。範圍十字會排除阻擋地格，與選點本身的視線限制分開。\n4. 普通傷害先受護身減傷，再由護盾吸收，剩餘部分扣生命。免費護身與雷光護體的 40% 減傷不累加。護盾可跨回合保留；一般護身與反擊在下次自身回合開始時重設。\n5. 目前戰棋主動技能倍率**不隨金丹品級、元神分支等階而增長**。元神頁面的選擇只決定帶哪個戰棋分支；境界、元嬰與裝備仍可能透過伺服器可信快照改變 A、H 或開場護盾。\n6. 舊版自動戰鬥的金丹機率、元嬰連擊、本命神通觸發鏈不額外疊進本戰棋引擎。既有 \`simulate-core-winrates.cjs\`／\`simulate-huashen-winrates.cjs\` 呼叫的是另一套引擎，其數字不能直接套用此表。\n7. 以最大生命百分比治療／護盾的技能，會受 H/A 比例影響。換成實際高境界、不同裝備或不同元嬰投影，應用新 A/H 重跑；本表不表示所有境界皆有相同勝率。\n\n';
md+='## 各金丹與分支詳細說明\n\n';
for(const [core,c]of Object.entries(R.CORES)){
  if(core==='none')continue;md+='### '+c.name+'\n\n';
  for(const b of c.branches){
    const r=find(core+'.'+b.id),sk=b.skill,[effect,limits,tactic]=notes[b.id];
    const pairRows=main.pairs.filter(p=>p.a===r.id||p.b===r.id).map(p=>{const mine=p.a===r.id;return {name:rows.find(v=>v.id===(mine?p.b:p.a)),rate:100*p[mine?'winsA':'winsB']/p.games,draw:100*p.draws/p.games};}).sort((a,b)=>b.rate-a.rate);
    md+=`**${b.name}｜${sk.name}**（\`${r.id}\`）\n\n`;
    md+=`- 元神頁面選項：${spirit(r)}。此處列的是其戰棋對應技能，並非舊版同名神通的被動數值。\n- 消耗 ${sk.cost} 體力；${sk.range===0?'對自身施放':'選點射程 '+sk.range+' 格'}；占一次攻擊／技能次數；冷卻規則見上。\n- **實際效果：**${effect}\n- **限制與細節：**${limits}\n- **戰術定位：**${tactic}\n- **模擬表現：**70% 答對率純勝率 ${percent(r.winPercent)}、和局 ${percent(r.drawPercent)}，每場平均施放此技能 ${r.castsPerGame.toFixed(2)} 次。最有利對戰：${pairRows[0].name.coreName}／${pairRows[0].name.branchName} ${percent(pairRows[0].rate)}；最不利：${pairRows.at(-1).name.coreName}／${pairRows.at(-1).name.branchName} ${percent(pairRows.at(-1).rate)}。這只是同一機器人策略下的對戰結果。\n\n`;
  }
}
md+='## 問道試煉通關率\n\n每一列是獨立進入指定關數，重設初始生命與體力，不是由第 1 關連續打到該關的存活率。各關使用相同的 '+data.config.pveSeeds+' 個地形種子，所有分支面對相同地圖與怪物；按正式 v2 生成規則，第 1／5／10／15／20／30 關等權。答對率 70%、A=200、H=1000，每關最多 60 次妖獸回應，逾上限判敗。\n\n';
md+=table(['金丹／分支',...data.config.stages.map(n=>'第 '+n+' 關'),'等權平均'],data.variants.map(v=>[v.coreName+'／'+v.branchName,...data.config.stages.map(stage=>{const t=trials(v.id).find(t=>t.stage===stage);return percent(100*t.wins/t.games);}),percent(trialPercent(v.id))]));
md+='\n高通關率與紅框可預知、此策略會主動閃避有關，不表示所有分支同等強，也不保證真人通關。每個關數只有 '+data.config.pveSeeds+' 場，少一勝就相差 '+one(100/data.config.pveSeeds)+'；觀察到 100% 不代表真實成功機率必然為 100%。這組樣本幾乎沒有區分大部分技能的 PvE 強弱，主要可看作回歸與策略可行性檢查。\n\n';
md+='## 未結金丹基準\n\n養氣／調息護元：3 體力、自身施放，回復 15% H 並補到至少 15% H 的護盾，冷卻同為 2；A/H 也統一為 200/1000。下表是**金丹分支**對此基準的勝率，不納入十八分支的主表分母。\n\n';
md+=table(['金丹／分支','對未結丹純勝率','和局率'],rows.map(r=>{const p=data.baseline.find(p=>p.b===r.id);return [r.coreName+'／'+r.branchName,percent(100*p.winsB/p.games),percent(100*p.draws/p.games)];}));
md+='\n## 資料與重跑\n\n- [原始彙總、每種子計數、條件與雜湊](tactical-v1/results.json)\n- [分支勝／和／敗與區間 CSV](tactical-v1/summary.csv)\n- [全部兩兩對戰 CSV](tactical-v1/matchups.csv)\n- [70% 純勝率矩陣 CSV](tactical-v1/pvp-matrix70.csv)（列是我方，欄是對手，空白對角線表示未測鏡像）\n- [逐關通關 CSV](tactical-v1/trials.csv)\n- [正式規則](../../public/cultivation/tactical-rules.js)、[固定操作策略](../../scripts/lib/tactical-balance.cjs)、[模擬程式](../../scripts/simulate-tactical-winrates.cjs)、[報告產生器](../../scripts/write-tactical-balance-report.cjs)\n- [MATLAB 分析／繪圖工具](../../scripts/analyze_tactical_winrates.m)：從勝和敗次數重新計算、繪製分支比例與對戰積分圖。本次環境沒有 MATLAB，未執行此工具；數字、資料一致性與 JavaScript 模擬則已驗證。\n\n```bash\nnode scripts/simulate-tactical-winrates.cjs\nnode scripts/write-tactical-balance-report.cjs\nnode --test tests/tactical-balance.test.cjs\n```\n\n```matlab\naddpath(\'scripts\');\n[summary, matchup] = analyze_tactical_winrates;\n```\n\n預設 4 個本機 worker，沒有網路／資料庫成本；可用 `--workers 1` 降低 CPU 佔用，用 `--seeds`、`--sensitivity-seeds`、`--pve-seeds` 調整場數，輸出位置用 `--out`。改動正式規則或操作策略後，須重跑模擬；報告產生器會核對雜湊，拒絕引用過期結果。\n';
fs.writeFileSync(path.join(root,'docs/balance/tactical-core-guide.md'),md);
const ids=rows.map(r=>r.id),matrix=ids.map(id=>ids.map(other=>{
  if(id===other)return '';
  const p=main.pairs.find(p=>p.a===id&&p.b===other||p.a===other&&p.b===id);return (100*p[p.a===id?'winsA':'winsB']/p.games).toFixed(4);
}));
fs.writeFileSync(path.join(directory,'pvp-matrix70.csv'),'id,'+ids.join(',')+'\n'+matrix.map((row,i)=>ids[i]+','+row.join(',')).join('\n')+'\n');
console.log('Updated docs/balance/tactical-core-guide.md and pvp-matrix70.csv');
