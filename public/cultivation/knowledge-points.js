// Shared, versioned classification for generation and analysis. Curriculum scope stays separate.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.QAKnowledgePoints = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const definitions = [
    ['國文', 'chinese', ['閱讀理解','文言文','字音字形','詞語成語','語法修辭','篇章結構','文學常識','寫作表達']],
    ['英文', 'english', ['詞彙片語','文法句型','時態語態','閱讀理解','篇章結構','語意推論','翻譯寫作','情境溝通']],
    ['數學', 'math', ['數與運算','代數運算','方程與不等式','函數與圖形','幾何與向量','數列與級數','機率與統計','微積分']],
    ['物理', 'physics', ['力與運動','功與能量','熱學','波動與聲音','光學','電學','磁學','近代物理']],
    ['化學', 'chemistry', ['物質與粒子','原子與週期表','化學鍵與結構','化學反應與計量','溶液與濃度','酸鹼與鹽','氧化還原與電化學','有機化學']],
    ['生物', 'biology', ['細胞與代謝','植物構造與生理','動物構造與生理','遺傳與分子生物','演化與分類','生態與環境','生物技術','科學探究']],
    ['地科', 'earth', ['地球構造','板塊與地質作用','岩石與礦物','大氣與天氣','氣候變遷','海洋科學','天文與宇宙','地球環境與災害']],
    ['公民', 'civics', ['個人與社會','文化與多元','政治與民主','憲法與人權','法律與生活','經濟與市場','貨幣與金融','公共議題與全球化']],
    ['地理', 'geography', ['地圖與空間','地形與地貌','氣候與水文','人口與聚落','產業與經濟地理','臺灣地理','世界區域','環境與永續']],
    ['歷史', 'history', ['臺灣史','中國史','東亞史','世界古代史','世界近代史','世界現代史','史料判讀','歷史因果與比較']]
  ];
  const SUBJECTS = Object.freeze(definitions.map(([name, id, names]) => Object.freeze({
    name, id, points: Object.freeze(names.map((name, index) => Object.freeze({ id: `${id}-${index + 1}`, name })))
  })));
  const SUBJECT_NAMES = Object.freeze(SUBJECTS.map(x => x.name));
  const ALIASES = Object.freeze({地球科學:'地科',公民與社會:'公民',國語:'國文',國語文:'國文',英語:'英文',
    數學A:'數學',數學B:'數學',數學甲:'數學',數學乙:'數學'});
  const clean = value => typeof value === 'string' ? value.trim() : '';
  function subject(value) {
    const name = clean(value), canonical = ALIASES[name] || name;
    return SUBJECT_NAMES.includes(canonical) ? canonical : '';
  }
  function points(value) { return SUBJECTS.find(x => x.name === subject(value))?.points || []; }
  function label(input = {}, fallbackSubject = '') {
    const raw = input?.meta || input || {};
    const expected = subject(fallbackSubject || input?.learningSubject || input?.subject);
    const declared = clean(raw.knowledge_subject ?? raw.knowledgeSubject);
    const name = declared ? subject(declared) : expected;
    if (!name || (expected && expected !== name)) return null;
    const id = clean(raw.knowledge_point_id ?? raw.knowledgePointId);
    const text = clean(raw.knowledge_point ?? raw.knowledgePoint);
    const point = points(name).find(x => id ? x.id === id : text && x.name === text);
    if (!point || (text && point.name !== text)) return null;
    return { subject: name, id: point.id, name: point.name };
  }
  function metadata(input, fallbackSubject = '') {
    const value = label(input, fallbackSubject);
    return { knowledge_subject: value?.subject || '', knowledge_point_id: value?.id || '', knowledge_point: value?.name || '' };
  }
  function assertLabel(input, fallbackSubject = '', targetId = '') {
    const value = label(input, fallbackSubject);
    if (value && (!targetId || value.id === targetId)) return value;
    // Subjects outside the ten analysis categories may explicitly opt out.
    if (!subject(fallbackSubject) && !targetId && input?.knowledge_subject === '' &&
        input?.knowledge_point_id === '' && input?.knowledge_point === '') return null;
    throw new Error('知識點標記無效：請從指定科目的固定清單選一個主要知識點，範圍不可代替知識點');
  }
  const count = value => Number.isFinite(Number(value)) ? Math.min(10000000, Math.max(0, Math.floor(Number(value)))) : 0;
  function record(map = {}, input, isCorrect) {
    const value = label(input);
    if (!value || typeof isCorrect !== 'boolean') return map;
    const old = map?.[value.subject]?.[value.id] || {};
    const total = Math.min(10000000, count(old.total) + 1);
    const correct = Math.min(count(old.correct), count(old.total)) + (isCorrect ? 1 : 0);
    return { ...map, [value.subject]: { ...map?.[value.subject], [value.id]: { total, correct: Math.min(total, correct) } } };
  }
  function promptFor(value, targetId = '') {
    const selected = subject(value);
    const choices = SUBJECTS.filter(x => !selected || x.name === selected)
      .map(x => ({ subject:x.name, points:x.points.filter(p => !targetId || p.id === targetId) }));
    return '[固定能力知識點標記]\n出題範圍／章節（sub_topic、topic、focus、concept）保持原要求，不得用它代替能力知識點。' +
      '完成題目後，依實際主要考查能力，從以下清單選且只選一個；不得新增、改名、跨科或因選定節點而改變出題範圍。' +
      '\n每題另附 knowledge_subject（分析科目）、knowledge_point_id（清單 ID）、knowledge_point（清單名稱），三者必須配對。' +
      (!selected ? '無法合理歸入這十科的題目，三個欄位均填空字串，不可硬套學科。' : '') +
      '\n固定清單：' + JSON.stringify(choices);
  }
  return Object.freeze({ VERSION:1, SUBJECTS, SUBJECT_NAMES, subject, points, label, metadata, assertLabel, record, promptFor });
});
