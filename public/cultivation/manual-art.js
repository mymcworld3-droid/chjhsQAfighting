// Canonical filenames for stamina-battle manual and skill artwork.
// Shared techniques reuse the base move's art; released weapons use approved paintings.
const BOOK_ART=Object.freeze({
  'sword-wind':'/assets/books/sword-wind.png',
  'sword-flight':'/assets/books/sword-flight.png',
  'sword-sky':'/assets/books/sword-sky.png',
  'body-rock':'/assets/books/body-rock.png',
  'body-dragon':'/assets/books/body-dragon.png',
  'body-tiger':'/assets/books/body-tiger.png',
  'sword-prism':'/assets/weapons/sword-prism-hd.webp',
  'body-bell':'/assets/weapons/body-bell-hd.webp',
  'sword-weave':'/assets/weapons/sword-weave-hd.webp',
  'body-mirror':'/assets/weapons/body-mirror-hd.webp',
  'sword-time':'/assets/weapons/sword-time-hd.webp',
  'body-gravity':'/assets/weapons/body-gravity-hd.webp'
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
  'prism-reflect':'/assets/skills/prism-reflect.webp',
  'prism-scatter':'/assets/skills/prism-scatter.webp',
  'bell-strike':'/assets/skills/bell-strike.webp',
  'bell-shock':'/assets/skills/bell-shock.webp',
  'bell-echo':'/assets/skills/bell-echo.webp',
  'weave-mark':'/assets/skills/weave-mark.webp',
  'weave-thread':'/assets/skills/weave-thread.webp',
  'weave-domain':'/assets/skills/weave-domain.webp',
  'mirror-strike':'/assets/skills/mirror-strike.webp',
  'mirror-summon':'/assets/skills/mirror-summon.webp',
  'mirror-swap':'/assets/skills/mirror-swap.webp',
  'time-slash':'/assets/skills/time-slash.webp',
  'time-double':'/assets/skills/time-double.webp',
  'time-union':'/assets/skills/time-union.webp',
  'gravity-strike':'/assets/skills/gravity-strike.webp',
  'gravity-core':'/assets/skills/gravity-core.webp',
  'gravity-crash':'/assets/skills/gravity-crash.webp'
});
const SHARED_MOVES=Object.freeze({
  'flight-slash':'wind-slash', 'sky-pierce':'wind-slash', 'prism-slash':'wind-slash',
  'flight-break':'wind-thousand', 'dragon-strike':'rock-fist',
  'tiger-fist':'rock-fist'
});
export const bookArt=id=>BOOK_ART[id]||'';
export const skillArt=skill=>{
  const id=typeof skill==='string'?skill:(skill?.moveId||skill?.id);
  return MOVE_ART[id]||MOVE_ART[SHARED_MOVES[id]]||'';
};
