// 主線背景圖目錄。src 為預留的新素材；尚未提供時使用已存在的 fallback。
const ROOT = 'assets/story/backgrounds';
const opening = index => `assets/story/opening/opening-${index}.png`;
const background = (id, filename, title, description, fallback) => Object.freeze({
  id, filename, title, description, src: `${ROOT}/${filename}`, fallback
});

export const STORY_BACKGROUNDS = Object.freeze([
  background('sect-courtyard', 'story-bg-01-sect-courtyard.png', '收徒日廣場', '青雲宗山門內的收徒廣場，石階、古松、雲海與遠處問道殿，明亮晨光，中央留出空地。', opening(1)),
  background('spirit-root-hall', 'story-bg-02-spirit-root-hall.png', '問道殿測靈臺', '青雲宗問道殿內部，木石梁柱、測靈石臺與舊簿，石心浮現如書卷展開的青白靈紋，莊重清幽。', opening(1)),
  background('mountain-corridor', 'story-bg-03-mountain-corridor.png', '白日山間長廊', '連接問道殿與仙府的青石長廊，木柱、竹影與雲海，午後柔光，遠處可見修行院落。', opening(1)),
  background('study-day', 'story-bg-04-study-day.png', '白日問道仙府', '樸素古雅的修行書室，中央立著青黑問道碑，書案放竹簡與玉牌，窗外青山，柔和日光，古碑與案角造型固定。', opening(1)),
  background('study-night', 'story-bg-05-study-night.png', '夜間問道書室', '與白日問道仙府相同的書室、古碑與書案，夜間燈火，一卷攤開的竹簡與幾卷未讀的功課，窗外深藍月色。', opening(1)),
  background('bamboo-dream', 'story-bg-06-bamboo-dream.png', '竹簡天尊藏書夢境', '清澈鏡面水域上，無數高低書架延伸進青霧，堆滿竹簡，遠處空的書卷高臺與浮空長卷，夢幻又略帶壓迫感；不畫天尊或臉。', opening(5)),
  background('corridor-night', 'story-bg-07-corridor-night.png', '窗外月夜長廊', '問道仙府書室窗外的夜間長廊，窗內暖燈與窗外清冷月光相映，石階、木柱、竹影，安靜溫和。', opening(1)),
]);

const BY_ID = new Map(STORY_BACKGROUNDS.map(item => [item.id, item]));
export function storyBackgroundById(id) { return BY_ID.get(id) || null; }

export function storyBackgroundForLine(chapter, lineIndex = 0) {
  let selected = null;
  for (const scene of chapter?.backgrounds || []) {
    if (scene.fromLine > lineIndex) break;
    selected = storyBackgroundById(scene.id);
  }
  return selected;
}

export function nextStoryBackground(chapter, lineIndex = 0) {
  const scene = chapter?.backgrounds?.find(item => item.fromLine > lineIndex);
  return scene ? storyBackgroundById(scene.id) : null;
}

// 每個 URL 與場景只載入一次；缺圖才嘗試既有素材，兩者失敗也不阻塞劇情。
export function createStoryBackgroundLoader(loadImage) {
  const urls = new Map(), scenes = new Map(), resolved = new Map();
  function image(src) {
    if (!urls.has(src)) urls.set(src, Promise.resolve().then(() => loadImage(src)).catch(() => ({ ok: false })));
    return urls.get(src);
  }
  return {
    has: id => resolved.has(id),
    get: id => resolved.get(id),
    load(scene) {
      if (!scene) return Promise.resolve(null);
      if (!scenes.has(scene.id)) scenes.set(scene.id, (async () => {
        let src = null;
        if ((await image(scene.src))?.ok) src = scene.src;
        else if (scene.fallback && (await image(scene.fallback))?.ok) src = scene.fallback;
        resolved.set(scene.id, src);
        return src;
      })());
      return scenes.get(scene.id);
    }
  };
}
