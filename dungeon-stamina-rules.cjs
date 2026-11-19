'use strict';
// Canonical stamina contract shared by dungeon combat, movement and charging.
// Match 問道試煉: 10 maximum stamina, one point per walked tile,
// four restored on a correct answer and one on an incorrect answer.
const MAX_STAMINA=10;
const START_STAMINA=10;
const STEP_COST=1;
const RIGHT=4,WRONG=1;
const clampStamina=value=>{
  const numeric=Number(value);
  return Number.isSafeInteger(numeric)?
    Math.max(0,Math.min(MAX_STAMINA,numeric)):0;
};
module.exports={MAX_STAMINA,START_STAMINA,STEP_COST,RIGHT,WRONG,clampStamina};
