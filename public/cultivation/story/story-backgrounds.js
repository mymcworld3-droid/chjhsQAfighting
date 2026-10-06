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
  background('battle-arena', 'story-bg-08-battle-arena.png', '宗門演武場', '青雲宗開闊演武場，圓形石臺、克制的保命陣紋、劍架、山峰與雲海，白日，中央保留完整空曠交手區。', opening(2)),
  background('refinery', 'story-bg-09-refinery.png', '八方煉器器坊', '青雲宗器坊內部，八方煉器陣、青銅爐、木料與金屬器胚，炭火暖橙和窗外青光相映，器具合理、有使用痕跡。', opening(4)),
  background('black-page', 'story-bg-10-black-page.png', '仙府黑色殘頁', '與白日問道仙府相同的室內，書案中央放一片黑色殘頁，纖細墨色靈紋與問道碑青光相互呼應，光線略冷、氣氛疑惑。', opening(5)),
  background('sect-steps-dusk', 'story-bg-11-sect-steps-dusk.png', '仙府外黃昏石階', '青雲宗仙府門外的石階、門廊與古松，日光將盡，淡霧與一片落地黑色殘頁，空間安靜，略有危險將至之感。', opening(1)),
  background('golden-tablet', 'story-bg-12-golden-tablet.png', '道印甦醒的問道碑', '問道仙府內的同一座青黑古碑，一道古紋亮起，金色小道印浮在碑前，青金光映亮室內，莊重而克制。', opening(3)),
  background('expedition-map', 'story-bg-13-expedition-map.png', '北境古圖書案', '仙府議事書案上的北境古圖、卷宗與玉簡，背景為同一座問道碑與山景窗，準備出行的氣氛，地圖沒有可辨識文字。', opening(1)),
  background('northern-ruins', 'story-bg-14-northern-ruins.png', '北境問道臺', '寒冷北境山谷中的上古問道臺，殘破石階、古紋石柱與數條相似岔路，青白霧氣、遠山和微光，遺跡中央保留空地。', opening(5)),
  background('sealed-archive', 'story-bg-15-sealed-archive.png', '宗門封存密錄', '青雲宗藏經閣的封存室，深色木書架、古卷、案上展開的密錄與柔和靈燈，久藏的塵埃在光束中可見，肅靜。', opening(1)),
  background('ancient-collapse', 'story-bg-16-ancient-collapse.png', '天裂往事幻景', '密錄映出的上古災變遠景，龐大問道天碑破碎，浮空遺跡坍塌、天幕裂開，青金碎光與深灰裂隙，史詩感但不血腥。', opening(6)),
  background('abandoned-cave', 'story-bg-17-abandoned-cave.png', '廢棄洞天', '廢棄古洞天中的破損石殿，長年無人修補的陣紋、斷柱與冷霧，地上一枚克制發光的道印，適合安靜對峙。', opening(5)),
  background('underground-palace', 'story-bg-18-underground-palace.png', '仙府地宮', '問道仙府地下的上古石宮，深長階梯、三枚道印共鳴、環形推演紋路與無可辨識文字的刻紋，青金微光、沉靜宏大。', opening(5)),
  background('star-gate', 'story-bg-19-star-gate.png', '地宮星門', '同一座上古地宮的盡頭，一扇由青金光構成的星門正在成形，細小悟念光點流向門內，星空般深邃，門外留空。', opening(8)),
  background('war-council', 'story-bg-20-war-council.png', '決戰前議事廳', '問道仙府擴展後的議事廳，中央長案放情報、古圖、修好的法寶，四周空座，青雲宗古雅建築，夜間靈燈莊重溫暖。', opening(1)),
  background('core-storm', 'story-bg-21-core-storm.png', '雷劫中的天碑核心', '上古問道天碑核心的巨型環形石臺，中央有裂紋的碑體，八枚道印、遠處雷雲與垂落閃電，冷藍與金光，決戰中央留空。', opening(6)),
  background('core-restored', 'story-bg-22-core-restored.png', '九環重建的天碑核心', '與雷劫天碑核心相同的石臺與碑體，九枚道印各自形成相互連接的光環，墨色侵蝕消退、雷雲漸散，柔和青金希望之光。', opening(8)),
  background('sect-dawn', 'story-bg-23-sect-dawn.png', '重建後的青雲宗', '風雨過後的青雲宗晨景，與收徒廣場相同的山門、石階、古松與建築語彙，雲海與柔金晨光，寧靜日常而不浮誇。', opening(1)),
  background('study-restored', 'story-bg-24-study-restored.png', '出師未成的仙府門口', '同一座問道仙府門口望向書室，修復的問道碑亮著層次清楚的青光，熟悉的書案、竹簡與玉牌，日光溫暖，有故事仍將繼續的感覺。', opening(1))
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
