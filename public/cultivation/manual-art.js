// Canonical filenames for stamina-battle manual and skill artwork.
// Shared techniques reuse the base move's art; all 13 unique moves have paintings.
const BOOK_ART=Object.freeze({
  'sword-wind':'/assets/books/sword-wind.png',
  'sword-flight':'/assets/books/sword-flight.png',
  'sword-sky':'/assets/books/sword-sky.png',
  'body-rock':'/assets/books/body-rock.png',
  'body-dragon':'/assets/books/body-dragon.png',
  'body-tiger':'/assets/books/body-tiger.png',
  'sword-prism':'/assets/weapons/sword-prism-hd.svg',
  'body-bell':'/assets/weapons/body-bell-hd.svg',
  'sword-weave':'/assets/weapons/sword-weave-hd.svg',
  'body-mirror':'/assets/weapons/body-mirror-hd.svg',
  'sword-time':'/assets/weapons/sword-time-hd.svg',
  'body-gravity':'/assets/weapons/body-gravity-hd.svg'
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
  'tiger-throw':'/assets/skills/tiger-throw.png',
  'prism-slash':'/assets/skills/prism-slash.svg',
  'prism-reflect':'/assets/skills/prism-reflect.svg',
  'prism-scatter':'/assets/skills/prism-scatter.svg',
  'bell-strike':'/assets/skills/bell-strike.svg',
  'bell-shock':'/assets/skills/bell-shock.svg',
  'bell-echo':'/assets/skills/bell-echo.svg',
  'weave-mark':'/assets/skills/weave-mark.svg',
  'weave-thread':'/assets/skills/weave-thread.svg',
  'weave-domain':'/assets/skills/weave-domain.svg',
  'mirror-strike':'/assets/skills/mirror-strike.svg',
  'mirror-summon':'/assets/skills/mirror-summon.svg',
  'mirror-swap':'/assets/skills/mirror-swap.svg',
  'time-slash':'/assets/skills/time-slash.svg',
  'time-double':'/assets/skills/time-double.svg',
  'time-union':'/assets/skills/time-union.svg',
  'gravity-strike':'/assets/skills/gravity-strike.svg',
  'gravity-core':'/assets/skills/gravity-core.svg',
  'gravity-crash':'/assets/skills/gravity-crash.svg'
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
