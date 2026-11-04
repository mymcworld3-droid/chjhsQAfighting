'use strict';
const Knowledge=require('../../public/cultivation/knowledge-points.js');
function generated(expected,overrides={}){
  const subject=Knowledge.subject(expected.subject)||'國文',point=Knowledge.points(subject)[0];
  return {q:'第 '+(expected.index+1)+' 題：社區活動公告說明，週六上午在圖書館舉行閱讀分享，參加者要先在週五前報名，並自備一本想分享的書。小明已報名但忘了帶書，依公告他還需要準備什麼？',
    correct:'一本想分享的書',wrong:['球拍','游泳衣','露營帳篷'],
    exp:'公告要求事先報名及自備書本。小明已完成報名，因此還需要帶一本想分享的書。',
    subject:expected.subject,question_form:expected.form,reasoning_steps:2,cognitive_level:2,
    literacy_context:'社區閱讀活動同時規定事先報名與自備書本，小明只完成其中一項。',
    literacy_task:'結合公告條件與小明已完成的事項，推論仍缺少的準備。',
    knowledge_points:[{subject,id:point.id,name:point.name}],...overrides};
}
async function ready(f,session,uid='u1'){
  if(session.question)return session;
  const expected=await f.service.prepareQuestion(uid);
  return f.service.commitQuestion(uid,expected,generated(expected));
}
module.exports={generated,ready};
