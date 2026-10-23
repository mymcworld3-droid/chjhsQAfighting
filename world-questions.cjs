'use strict';
const {questionQualityIssue}=require('./question-quality.cjs');
const {pickTrustedRaidKnowledge}=require('./raid-authority.cjs');
const {ANSWER_AND_EXPLANATION_RULES,subjectReliabilityPrompt}=require('./quiz-answer-prompt.cjs');
// A small reviewed set keeps turns playable during an unavailable AI service.
const BANK=[
  ['數學','一元一次方程式','若 3x + 5 = 20，則 x 為多少？',['5','3','7','15'],0,'兩邊先減去 5，得到 3x = 15，再除以 3，故 x = 5。'],
  ['數學','比例','一張地圖每格代表 20 公尺，走 6 格共走多少公尺？',['120','26','100','140'],0,'每格 20 公尺乘以 6 格，共 120 公尺。'],
  ['國文','成語','「鍥而不捨」最接近哪一種態度？',['堅持到底','立刻放棄','誇大其詞','隨遇而安'],0,'「鍥」指雕刻，「不捨」是不停止，比喻持續努力、不輕易放棄。'],
  ['英文','文法','Which sentence is correct?',['She goes to school every day.','She go to school every day.','She going to school every day.','She gone to school every day.'],0,'一般現在式的主詞 She 是第三人稱單數，動詞 go 要變成 goes。'],
  ['物理','速率','物體 10 秒移動 50 公尺，平均速率為何？',['5 公尺／秒','500 公尺／秒','0.2 公尺／秒','60 公尺／秒'],0,'平均速率等於路程除以時間：50 ÷ 10 = 5 公尺／秒。'],
  ['化學','物質分類','下列何者屬於純物質？',['蒸餾水','空氣','海水','牛奶'],0,'蒸餾水在理想情況下只有水這一種化合物，其餘皆為混合物。'],
  ['生物','光合作用','植物進行光合作用時，主要吸收哪一種氣體？',['二氧化碳','氮氣','氧氣','氫氣'],0,'光合作用利用二氧化碳與水合成有機物，並釋放氧氣。'],
  ['地科','地球運動','地球自轉直接造成下列哪一種現象？',['晝夜交替','一年四季','月相變化','日食'],0,'地球自轉使同一地點輪流面向與背向太陽，形成晝夜交替。'],
  ['地理','地圖判讀','等高線越密集，通常代表地形如何？',['坡度越陡','海拔一定越低','坡度越緩','一定是平原'],0,'相同水平距離內高度變化越大，坡度越陡，等高線也越密集。'],
  ['公民','權力分立','權力分立與制衡的主要目的為何？',['避免權力過度集中','取消所有法律','讓政府不用負責','使人民不能參政'],0,'不同機關分掌職權並相互制衡，可防止濫權，保障人民權利。'],
  ['歷史','史料判讀','研究過去事件時，哪一種方式最能提高判斷的可靠性？',['比較不同來源的史料','只看單一傳聞','忽略史料形成背景','只採信符合自己想法的資料'],0,'比較來源、立場與形成背景不同的史料，能相互檢證，減少單一來源的偏差。']
];
function fallback(battle,scope) {
  const preferred=BANK.filter(q=>q[0]===scope.subject),pool=preferred.length>=2?preferred:preferred.concat(BANK.filter(q=>q[0]==='數學'));
  return Array.from({length:2},(_,i)=>{
    const q=pool[(battle.turn*2+i)%pool.length],rotate=(battle.turn+i)%4;
    const options=q[3].slice(rotate).concat(q[3].slice(0,rotate));
    return {subject:q[0],topic:q[1],q:q[2],options,answerIndex:(4-rotate)%4,explanation:q[5],source:'reviewed'};
  });
}
async function generate(battle,{router=require('./ai-router')}={}) {
  const selected=pickTrustedRaidKnowledge(battle.player.knowledgeScope,battle.turn)||{};
  const scope={...selected,topic:selected.specificTopic||''};
  if(!router.getStatus().length)return fallback(battle,scope);
  try{
    const prompt=`你是臺灣${scope.level||'國中'}的出題老師。為修仙戰棋的本回合補能產生兩道獨立單選題。學科：${scope.subject||'數學'}；範圍：${scope.topic||'基礎觀念'}。題目必須簡潔、正確、適齡，不包含答案提示，避免與下列題目重複：${(battle.records||[]).slice(-6).map(q=>q.q).join('；')}。所有說明用繁體中文，英文學科可保留英文題幹與選項。${ANSWER_AND_EXPLANATION_RULES}\n${subjectReliabilityPrompt(scope.subject||'數學')}\n只回傳 JSON {"questions":[{"q":"題幹","correct":"正確選項","wrong":["錯誤一","錯誤二","錯誤三"],"exp":"解析","topic":"知識點"}]}，恰好兩題。`;
    const result=await router.generateJSON(prompt,{timeoutMs:12000,maxOutputTokens:1800});
    if(!Array.isArray(result.data?.questions)||result.data.questions.length!==2)throw Error('invalid question batch');
    return result.data.questions.map((q,i)=>{
      if(questionQualityIssue(q)||!Array.isArray(q.wrong)||q.wrong.length!==3)throw Error('invalid question');
      const raw=[q.correct,...q.wrong].map(String),rotation=(battle.turn+i)%4;
      if(new Set(raw.map(x=>x.trim())).size!==4)throw Error('duplicate choices');
      return {q:String(q.q).slice(0,1600),options:raw.slice(rotation).concat(raw.slice(0,rotation)),answerIndex:(4-rotation)%4,
        explanation:String(q.exp).slice(0,2400),subject:scope.subject||'數學',topic:String(q.topic||scope.topic||'基礎觀念').slice(0,100),source:'generated'};
    });
  }catch{return fallback(battle,scope);}
}
module.exports={generate,fallback,BANK};
