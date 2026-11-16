// Canonical filenames for stamina-battle manual and skill artwork.
// Shared techniques reuse the base move's art; all 13 unique moves have paintings.
const BOOK_ART=Object.freeze({
  'sword-wind':'/assets/books/sword-wind.png',
  'sword-flight':'/assets/books/sword-flight.png',
  'sword-sky':'/assets/books/sword-sky.png',
  'body-rock':'/assets/books/body-rock.png',
  'body-dragon':'/assets/books/body-dragon.png',
  'body-tiger':'/assets/books/body-tiger.png'
});
const MOVE_ART=Object.freeze({
  'wind-slash':'/assets/skills/wind-slash.png',
  'wind-step':'/assets/skills/wind-step.png',
  'wind-thousand':'/assets/skills/wind-thousand.png',
  'flight-summon':'/assets/skills/flight-summon.png',
  'sky-cloud':'/assets/skills/sky-cloud.png',
  'sky-sever':'/assets/skills/sky-sever.png',
  'rock-fist':'/assets/skills/rock-fist.png',
  'rock-quake':'/assets/skills/rock-quake.png',
  'rock-break':'/assets/skills/rock-break.png',
  'dragon-guard':'/assets/skills/dragon-guard.png',
  'dragon-roar':'/assets/skills/dragon-roar.png',
  'tiger-step':'/assets/skills/tiger-step.png',
  'tiger-throw':'/assets/skills/tiger-throw.png'
});
const SHARED_MOVES=Object.freeze({
  'flight-slash':'wind-slash', 'sky-pierce':'wind-slash',
  'flight-break':'wind-thousand', 'dragon-strike':'rock-fist',
  'tiger-fist':'rock-fist'
});
export const bookArt=id=>BOOK_ART[id]||'';
export const skillArt=skill=>{
  const id=typeof skill==='string'?skill:(skill?.moveId||skill?.id);
  return MOVE_ART[id]||MOVE_ART[SHARED_MOVES[id]]||'';
};
