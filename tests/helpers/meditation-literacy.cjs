'use strict';
const Knowledge=require('../../public/cultivation/knowledge-points.js');
function generated(expected,overrides={}){
  const subject=Knowledge.subject(expected.subject)||'國文',point=Knowledge.points(subject)[0];
  // These fixtures intentionally require application of a named school
  // concept. Mere passage recall must not be mistaken for literacy assessment.
  const examples={
    國文:{
      q:'某校準備公告週末資源回收活動，要求內容包括正確時間、地點及禮貌提醒。若運用正式公告的語體與資訊完整原則，下列哪一種公告最合適？',
      correct:'請於週六上午九時至十一時，至校門口依標示分類投放回收物。',
      wrong:['你們都不懂分類，週末一定要來！','週末再找個時間到某個地方回收。','活動只需宣告「請支持環保」，無須時間地點。'],
      exp:'正式公告須用客觀得體的語氣並清楚交代時間、地點與行動，第一句同時符合條件，其餘不是語氣失當就是資訊不足。',
      concept:'正式公告語體與資訊完整',task:'運用公告寫作原則，結合時間、地點與語氣限制選擇得體文句。'
    },
    英文:{
      q:'A museum announces that visitors must reserve weekend tickets in advance. A student cannot attend on Saturday and wants to ask whether the booking may be changed to Sunday. Which email sentence is the most polite and suitable?',
      correct:'Could you please tell me whether I may change my reservation to Sunday?',
      wrong:['Change my ticket now, because I said so.','The museum displays paintings from many periods.','I changed the booking yesterday without asking you.'],
      exp:'面對正式客服情境，應使用合乎禮貌的 could you please 問句，且明確提出星期日改期需求；其他句子粗魯、離題或未提出詢問。',
      concept:'禮貌請求句型與情境溝通',task:'運用英語委婉疑問句的語法與語用，判斷符合改期需求的表達。'
    },
    數學:{
      q:'某校的模擬新聞指出，班級訂購活動飲品可選方案甲每杯20元但固定運費40元，或方案乙每杯24元且免運費。若班級要訂15杯，並且只有一筆訂單，哪個選擇可節省支出？',
      correct:'方案甲，總價340元，比方案乙便宜20元。',
      wrong:['方案乙，總價300元，比甲便宜40元。','方案甲，總價300元，比乙便宜60元。','兩方案總價都是360元，沒有差別。'],
      exp:'甲為20×15＋40＝340元，乙為24×15＝360元。依一次函數的費用模型比較可得甲便宜20元。',
      concept:'一次函數費用模型與方案比較',task:'利用每杯單價、固定運費及杯數建立兩式並比較最終費用。'
    },
    自然:{
      q:'某校發表一段模擬的種子試驗報導：甲組種子每天照光8小時、澆水50 mL；乙組照光12小時、澆水100 mL。若要推論「光照時間是否影響發芽」，應如何修正實驗設計？',
      correct:'讓兩組澆水量相同，再僅改變光照時間。',
      wrong:['維持光照及澆水量同時不同，直接把結果全歸因光照。','讓甲乙再使用不同土壤，以增加變因數量。','只觀察長得最快的單一種子，忽略其他樣本。'],
      exp:'原設計同時改變光照與水分，無法分離影響。固定澆水量與其他條件，只改變光照，才能較合理估計光照效應。',
      concept:'控制變因與科學實驗設計',task:'辨認光照是操縱變因，並以固定水量排除混雜因素。'
    },
    社會:{
      q:'某模擬報導描述：某市擬將公共空間用作車道，商家支持物流便利，附近居民擔心行人安全。若依公共決策的利益權衡與公民參與原則，哪項處理方式最適當？',
      correct:'公開交通安全與物流資料，邀請不同使用者討論可行方案。',
      wrong:['只採第一位商家的意見，因為其他人沒有提出權利。','不必調查任何交通資料，只看哪邊口號較大聲。','在政策發布前永久禁止居民提出建議。'],
      exp:'公共政策涉及多個利害關係人，需以可靠資料及適當參與程序討論不同需求，不能僅依單一群體或情緒決定。',
      concept:'公共議題的利益權衡與參與',task:'運用公民參與及證據論證原則，分析兼顧物流與行人安全的方案。'
    }
  };
  const example=examples[expected.subject]||examples.社會;
  return {q:'第 '+(expected.index+1)+' 題：'+example.q,
    correct:example.correct,wrong:example.wrong,exp:example.exp,
    subject:expected.subject,question_form:expected.form,reasoning_steps:2,cognitive_level:2,
    literacy_context:'模擬事件提供可檢驗的資料與限制條件，須搭配本學科的既定觀念進行判斷。',
    literacy_concept:example.concept,
    literacy_task:example.task,
    knowledge_points:[{subject,id:point.id,name:point.name}],...overrides};
}
async function ready(f,session,uid='u1'){
  if(session.question)return session;
  const expected=await f.service.prepareQuestion(uid);
  return f.service.commitQuestion(uid,expected,generated(expected));
}
function seedShared(db,date){
  const {SETS,dailyPlan,makeQuestion}=require('../../daily-meditation-set.cjs');
  const plan=dailyPlan(),questions=plan.map((domain,index)=>{
    const expected={...domain,index,date};return makeQuestion(generated(expected),expected,()=>.5);
  });
  db.docs.set(SETS+'/'+date,{date,version:1,status:'ready',plan,questions,reviewCount:1});
}
function seedLegacySession(db,date,level='國中一年級'){
  const {plan}=require('../../daily-meditation-literacy.cjs');
  db.docs.set('meditationSessions/'+date+'_u1',{uid:'u1',date,version:2,runId:'legacy-five-question-session',
    level,plan:plan({profile:{educationLevel:level}}),index:0,questions:[],answers:[],issuedAtMs:0});
}
module.exports={generated,ready,seedShared,seedLegacySession};
