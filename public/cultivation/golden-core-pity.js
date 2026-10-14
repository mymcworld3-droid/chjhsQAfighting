// 每五次成功洗髓保底三品以上；抽樣參數在交易前固定，重試不重抽。
(function (root) {
  'use strict';
  const WEIGHTS = Object.freeze([25,20,16,12,9,7,5,4,2]);
  const count = n => Number.isFinite(Number(n)) ? Math.max(0, Math.floor(Number(n))) : 0;
  function draw(previousCount, typeRoll, gradeRoll, types, createdAt) {
    const nextCount = count(previousCount) + 1, guaranteed = nextCount % 5 === 0;
    const rows = WEIGHTS.map((weight, i) => ({ grade:9-i, weight }))
      .filter(row => !guaranteed || row.grade <= 3);
    const total = rows.reduce((sum, row) => sum + row.weight, 0);
    let roll = Math.max(0, Math.min(.999999999, Number(gradeRoll) || 0)) * total;
    let grade = rows.at(-1).grade;
    for (const row of rows) { roll -= row.weight; if (roll < 0) { grade = row.grade; break; } }
    const index = Math.min(types.length-1, Math.floor(Math.max(0, Number(typeRoll) || 0) * types.length));
    return { count:nextCount, guaranteed, core:{type:types[index],grade,createdAt} };
  }
  const api = Object.freeze({ WEIGHTS, count, draw, remaining:n => 5-count(n)%5 });
  if (typeof module === 'object' && module.exports) module.exports=api;
  else root.QAGoldenCorePity=api;
})(globalThis);
