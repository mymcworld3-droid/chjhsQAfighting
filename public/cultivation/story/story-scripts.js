// 沈清霜主線劇本資料。
// 劇情台詞、角色資料與境界觸發全部集中在此檔，播放 UI 由 story-engine.js 負責。
// {{playerName}}、{{junior}} 會在執行時依玩家資料與性別自動替換。

export const STORY_VERSION = 1;

export const STORY_CHARACTERS = Object.freeze({
  narrator: Object.freeze({ name: '旁白', side: 'center', image: '' }),
  player: Object.freeze({ name: '{{playerName}}', side: 'left', dynamicPlayer: true }),
  bamboo: Object.freeze({ name: '竹簡天尊', side: 'right', image: 'assets/story/characters/bamboo-tianzun.png' }),
  shen: Object.freeze({
    name: '沈清霜',
    side: 'right',
    image: 'assets/story/characters/shen-qingshuang.png'
  }),
  elder: Object.freeze({
    name: '許長老',
    side: 'right',
    image: 'assets/story/characters/sect-elder.png'
  })
});

const c = (speaker, text, expression = 'neutral') => Object.freeze({ speaker, text, expression });
const bg = (...scenes) => Object.freeze(scenes.map(([fromLine, id]) => Object.freeze({ fromLine, id })));

export const STORY_CHAPTERS = Object.freeze([
  Object.freeze({
    id: 'prologue-enter-sect',
    order: 0,
    minScore: 0,
    realm: '凡人',
    title: '第一章 · 問道靈根',
    subtitle: '與宗主相同的靈根 · 師姐授課',
    backgrounds: bg([0, 'sect-courtyard'], [2, 'spirit-root-hall'], [17, 'mountain-corridor'], [19, 'study-day']),
    scene: Object.freeze({ page: 'page-home' }),
    lines: Object.freeze([
      c('narrator', '青雲宗收徒日，問道殿外排起長龍。有人帶著家傳玉佩，有人默背《仙門入門必過十訣》。你前面那人，還偷偷往掌心抹了一層金粉。'),
      c('elder', '洗乾淨。測靈石看靈根，不看成色。下一位，{{playerName}}。'),
      c('narrator', '你將手掌貼上石臺。沒有烈火，也沒有雷鳴，一縷清光卻在石心盤旋，交錯成細密的紋路，像一卷正在自行展開的書。'),
      c('player', '長老，這是什麼靈根？', 'confused'),
      c('elder', '手先別移開。讓我查一查。'),
      c('narrator', '許長老的筆停在半空。他翻開案旁的舊簿，比對石上的靈紋，最後停在最前面的一頁。周圍的人聲漸漸低下去。'),
      c('elder', '問道靈根。竟然又見到了……'),
      c('player', '這種靈根，很厲害嗎？', 'happy'),
      c('elder', '宗主當年測出的，也是問道靈根。你這道靈紋，與記錄中的一樣。'),
      c('narrator', '你還沒來得及追問，一名月白道袍的女子已走進殿中。沿途弟子紛紛讓開，喚她大師姐。她在石臺旁站定，仔細看了片刻。'),
      c('shen', '手放著，我再確認一次。'),
      c('narrator', '她的指尖掠過清光，靈紋在眼前重新展開。女子核對了舊簿上的筆記，才收回手。'),
      c('shen', '確實與宗主相同。'),
      c('elder', '清霜，這位弟子的修行安排……'),
      c('shen', '我來帶。{{junior}}，跟我走。'),
      c('player', '師姐，我是不是可以直接學宗主的絕世功法？', 'happy'),
      c('shen', '你與宗主從同一條路起步。先把第一步走穩。'),
      c('narrator', '你跟著沈清霜走出問道殿。身後的議論聲，已經把「靈根與宗主相同」說成了「宗主親自選中的弟子」。'),
      c('shen', '不必回頭。再聽一會兒，他們就要說宗主昨夜託夢給你了。'),
      c('narrator', '穿過長廊，她將你帶進問道仙府。中央立著一面古碑，桌上擺著書卷與玉簡。你看了半天，沒有找到仙丹。'),
      c('shen', '今後在這裡修行。問道碑會將悟念化為修為，這是問道靈根的修行之路。'),
      c('player', '師姐，問道靈根到底要怎麼修？', 'confused'),
      c('shen', '尋常靈根對天地靈氣各有所長，問道靈根的長處，在於悟。理解一個道理，知道它為何成立、如何運用，便能凝成悟念。'),
      c('shen', '問道碑會用題目幫你檢驗所學。答對正式題目可以累積修為；看懂解析，才能把這份理解帶到下一題。'),
      c('player', '所以，多背一些答案就行？', 'happy'),
      c('shen', '題目換個問法，你還能說明理由，才算讀懂。只記住答案，遇到新的題目便會卡住。'),
      c('shen', '你與宗主同樣是問道靈根，也得親自讀題、思考、參悟。靈根不會替你作答。'),
      c('player', '宗主以前，也是從答題開始的？', 'confused'),
      c('shen', '也是。他問得比你多。你有不明白的地方，可以問我。'),
      c('narrator', '沈清霜遞來一枚弟子玉簡，裡面記著宗主初入仙門時的筆記。字跡有些潦草，頁邊卻密密麻麻寫滿了疑問。'),
      c('shen', '宗主也曾被一道題難住。這些筆記裡，留下的問題比答案還多。'),
      c('player', '連宗主也有不會的題？', 'confused'),
      c('shen', '當然。他會把疑處記下，一個個弄明白。你也不必急著裝作什麼都懂。'),
      c('narrator', '玉簡映出一行被反覆修改的推演。你看著那些塗改的痕跡，忽然覺得，宗主走過的路並沒有那麼遙遠。'),
      c('player', '原來問道還要看解析。題目本身有問題，也能提出來？', 'confused'),
      c('shen', '能。把題意、答案或解析哪裡有問題說清楚。修行遇到疑處，要有理由地追問，不能只因自己答錯便怪題目。'),
      c('player', '那我不會的題，可以慢慢弄懂？', 'confused'),
      c('shen', '可以。正式問道在金丹期以前答錯不扣修為，金丹期起答錯扣一修為。先看懂解析，再繼續下一題；這比急著把題目翻過去有用。'),
      c('narrator', '她抬手凝出一道纖細劍光，想讓你看清靈氣的運行。劍光很穩，直到她為了讓你看得更清楚，稍稍多送了一分靈力。桌角無聲地落了下來。'),
      c('player', '……師姐，桌子。', 'confused'),
      c('shen', '看見了。今日先學問道，鬥法另找地方教。'),
      c('shen', '從你學過、願意繼續鑽研的內容開始。路是自己走的，有疑問就問，不必怕旁人笑話。'),
      c('narrator', '她將弟子玉牌放到你手中，又把玉簡移到桌子完好的那一側。宗主曾走過的路，如今也在你面前展開。'),
      c('player', '師姐，我準備好了。', 'determined'),
      c('shen', '那便從仙府的「問道試煉」開始。遇到不明白的地方，先記下來。'),
      c('narrator', '山風翻動書頁。你握住玉牌，望向問道碑，開始了自己的第一場正式修行。')
    ])
  }),

  Object.freeze({
    id: 'qi-five-dongtian',
    order: 2,
    minScore: 5,
    realm: '煉氣五層',
    title: '第二章 · 竹簡天尊',
    subtitle: '一場讓人不敢荒廢功課的夢',
    backgrounds: bg([0, 'study-night'], [1, 'bamboo-dream'], [19, 'study-night'], [21, 'corridor-night']),
    scene: Object.freeze({ page: 'page-home' }),
    lines: Object.freeze([
      c('narrator', '煉氣五層之後，你漸漸熟悉了問道碑。這晚，案上還攤著幾卷未讀完的竹簡，你卻已靠著椅背睡著。最後一個念頭，是明日再看也來得及。'),
      c('narrator', '再睜眼時，書案與燈火都不見了。腳下是一片清澈如鏡的水面，四周高高低低的書架延伸到霧裡，每一架都堆著成捆竹簡。'),
      c('player', '我不是在仙府睡著了嗎？這是哪裡？', 'confused'),
      c('narrator', '一卷竹簡從最高的書架上緩緩飄下。竹片舒展，青光在縫隙間凝成一雙眼睛；它端坐在由書卷疊成的高臺上，身後還懸著一圈細密小字。'),
      c('bamboo', '抬頭。本尊在這裡。'),
      c('player', '……竹簡會說話？', 'confused'),
      c('bamboo', '山川可生靈，古劍可成仙，一卷通曉萬法的竹簡，自然也有成道之日。你可稱本尊為竹簡天尊。'),
      c('player', '晚輩{{playerName}}，見過天尊。您找我有何事？', 'confused'),
      c('bamboo', '本尊巡閱諸天，偶然發現你有問道靈根。這份資質十分合適，合適得本尊連夜替你列了一份修行安排。'),
      c('narrator', '竹簡天尊輕輕一抖，身後的小字便落了下來，化成一張長卷。長卷越展越長，穿過水面、繞過書架，最後又從你背後繞了回來。'),
      c('player', '這些……全是要讀的？', 'confused'),
      c('bamboo', '左邊是功課，右邊是溫習。下方是你忘記溫習之後，需要再溫習的功課。'),
      c('player', '天尊，修行總得有個盡頭吧？', 'confused'),
      c('bamboo', '當然有。你將這一架讀懂，本尊便替你開下一架。'),
      c('narrator', '它指向霧裡。無數書架依次亮起，像一片看不到岸的青色星海。你忽然很想回到自己的書案前，那幾卷竹簡看起來親切多了。'),
      c('player', '晚輩覺得，先把今晚留下的功課做完，比較穩妥。', 'confused'),
      c('bamboo', '甚好。倘若你明日仍想拖延，本尊可以把這座藏書天地搬進你的夢裡，夜夜陪讀，逐字提問。'),
      c('player', '不用勞煩天尊！我自己讀，我明日一早就讀！', 'determined'),
      c('narrator', '竹簡天尊露出慈祥的神情。整座藏書天地忽然翻起書頁，萬千竹簡一起朝你展開，連水中的倒影都開始追問：「這一句，你真的明白了嗎？」'),
      c('narrator', '你猛地坐直，額頭抵上書案，燈芯在眼前輕晃。屋裡沒有天尊，只有原先那幾卷竹簡。你盯著它們看了好一會兒，伸手把最上面的一卷攤開。'),
      c('player', '先讀一段。讀明白再睡……總比在夢裡被整座藏書閣追著問好。', 'determined'),
      c('narrator', '窗外，沈清霜收回指尖的入夢靈光。她聽見翻動竹簡的聲音，微微點頭，又確認了一遍自己沒有把天尊的修為設得太高。'),
      c('shen', '看來記住了。適當給些壓力，果然能讓人更上心。'),
      c('narrator', '她想著，自己特意替{{junior}}製造的這場夢，既有前輩指點，又有修行督促，明日一定能更加用心修煉。這一回，師姐的教導應當十分周全。'),
      c('narrator', '沈清霜望了一眼重新亮起的窗燈，心滿意足地離開。夜風穿過長廊，只留下你對著竹簡，小聲確認那幾個字到底是什麼意思。')
    ])
  })
]);

export function playerPortraitPath(gender = 'male', expression = 'neutral') {
  const g = gender === 'female' ? 'female' : 'male';
  const allowed = new Set(['neutral', 'confused', 'happy', 'determined']);
  const e = allowed.has(expression) ? expression : 'neutral';
  return `assets/story/characters/player-${g}-${e}.png`;
}

export function storyChapterById(id) {
  return STORY_CHAPTERS.find((chapter) => chapter.id === id) || null;
}
