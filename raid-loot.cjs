'use strict';
function victoryDate(ms) {
  if (!Number.isFinite(Number(ms)) || Number(ms) <= 0) return null;
  return new Date(Number(ms) + 8 * 3600000).toISOString().slice(0,10);
}
const MEMENTO = Object.freeze({name:'清霜劍印',description:'首次通過沈清霜試煉的永久紀念。'});
module.exports = {victoryDate,MEMENTO};
