// 沈清霜主線劇本資料。
// 劇情台詞、角色資料與境界觸發全部集中在此檔，播放 UI 由 story-engine.js 負責。
// {{playerName}}、{{junior}} 會在執行時依玩家資料與性別自動替換。

export const STORY_VERSION = 1;

export const STORY_CHARACTERS = Object.freeze({
  narrator: Object.freeze({ name: '旁白', side: 'center', image: '' }),
  player: Object.freeze({ name: '{{playerName}}', side: 'left', dynamicPlayer: true }),
  bamboo: Object.freeze({ name: '竹簡天尊', side: 'right', image: '' }),
  shen: Object.freeze({
    name: '沈清霜',
    side: 'right',
    image: 'assets/story/characters/shen-qingshuang.png'
  }),
  elder: Object.freeze({
    name: '許長老',
    side: 'right',
    image: 'assets/story/characters/sect-elder.png'
  }),
  refineryMaster: Object.freeze({
    name: '石百煉',
    side: 'right',
    image: 'assets/story/characters/refinery-master.png'
  }),
  rival: Object.freeze({
    name: '顧長風',
    side: 'right',
    image: 'assets/story/characters/battle-rival.png'
  }),
  envoy: Object.freeze({
    name: '蘇聞月',
    side: 'right',
    image: 'assets/story/characters/alliance-envoy.png'
  }),
  antagonist: Object.freeze({
    name: '無相客',
    side: 'right',
    image: 'assets/story/characters/mysterious-antagonist.png'
  })
});

const c = (speaker, text, expression = 'neutral') => Object.freeze({ speaker, text, expression });

export const STORY_CHAPTERS = Object.freeze([
  Object.freeze({
    id: 'prologue-enter-sect',
    order: 0,
    minScore: 0,
    realm: '凡人',
    title: '第一章 · 問道靈根',
    subtitle: '與宗主相同的靈根 · 師姐授課',
    scene: Object.freeze({ page: 'page-home' }),
    // 介紹靈根後交棒給實際的新手教學；結束後回到仙府接續對話。
    tutorialAfterLine: 32,
    tutorialKind: 'question',
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
      c('shen', '今後在這裡修行。問道碑會將悟念化為修為，我先教你如何使用。'),
      c('player', '師姐，問道靈根到底要怎麼修？', 'confused'),
      c('shen', '尋常靈根對天地靈氣各有所長，問道靈根的長處，在於悟。理解一個道理，知道它為何成立、如何運用，便能凝成悟念。'),
      c('shen', '問道碑會用題目幫你檢驗所學。答對正式題目可以累積修為；看懂解析，才能把這份理解帶到下一題。'),
      c('player', '所以，多背一些答案就行？', 'happy'),
      c('shen', '題目換個問法，你還能說明理由，才算讀懂。只記住答案，遇到新的題目便會卡住。'),
      c('shen', '你與宗主同樣是問道靈根，也得親自讀題、思考、參悟。靈根不會替你作答。'),
      c('player', '宗主以前，也是從答題開始的？', 'confused'),
      c('shen', '也是。他問得比你多。你有不明白的地方，可以問我。'),
      c('narrator', '沈清霜遞來一枚入門玉簡。上面只有一題簡單的範例，旁邊寫著「不計修為」。她將玉簡放在問道碑前，示意你親手試試。'),
      c('shen', '先學讀題、選答案、看題解與回報問題，再去洞府認識修習範圍和難度。正式問道前，把這些入口記清楚。'),
      c('player', '只有一題？宗主同款靈根的第一堂課，這麼樸實嗎？', 'confused'),
      c('shen', '先把這一題看明白。我在這裡陪你。這是教學範例，不計修為，也不會送出正式回報。'),
      c('narrator', '入門玉簡的光芒收斂，你重新回到仙府。沈清霜仍站在問道碑旁，等你說出剛才的疑問。'),
      c('player', '原來問道還要看解析。題目本身有問題，也能提出來？', 'confused'),
      c('shen', '能。把題意、答案或解析哪裡有問題說清楚。修行遇到疑處，要有理由地追問，不能只因自己答錯便怪題目。'),
      c('player', '那我不會的題，可以慢慢弄懂？', 'confused'),
      c('shen', '可以。正式問道答錯不扣修為。先看懂解析，再繼續下一題；這比急著把題目翻過去有用。'),
      c('narrator', '她抬手凝出一道纖細劍光，想讓你看清靈氣的運行。劍光很穩，直到她為了讓你看得更清楚，稍稍多送了一分靈力。桌角無聲地落了下來。'),
      c('player', '……師姐，桌子。', 'confused'),
      c('shen', '看見了。今日先學問道，鬥法另找地方教。'),
      c('shen', '正式修行的範圍可以在洞府調整。從你學過、願意繼續鑽研的內容開始；不熟悉的入口，也能在洞府重新查看這一章與教學。'),
      c('narrator', '她將弟子玉牌放到你手中，又把玉簡移到桌子完好的那一側。宗主曾走過的路，如今也在你面前展開。'),
      c('player', '師姐，我準備好了。', 'determined'),
      c('shen', '那便從仙府的「問道試煉」開始。遇到不明白的地方，先記下來。'),
      c('narrator', '山風翻動書頁。你握住玉牌，望向問道碑，開始了自己的第一場正式修行。')
    ])
  }),

  Object.freeze({
    id: 'qi-one-ask-dao',
    order: 1,
    minScore: 1,
    realm: '煉氣一層',
    title: '入門續篇 · 問道不是猜答案',
    subtitle: '仙府的第一堂課',
    scene: Object.freeze({ page: 'page-home' }),
    lines: Object.freeze([
      c('narrator', '沈清霜把你帶進一座殘舊仙府。正中央懸著一面古碑，碑面沒有經文，只有一道道尚未亮起的紋路。'),
      c('shen', '此處名為問道仙府。你今後在這裡修行。'),
      c('player', '師姐要教我絕世功法？', 'happy'),
      c('shen', '先答題。'),
      c('player', '……這明明是數學題。', 'confused'),
      c('shen', '陣法不用算？'),
      c('player', '要。', 'neutral'),
      c('shen', '煉器不用算？'),
      c('player', '也要。', 'neutral'),
      c('shen', '靈石不用算？'),
      c('player', '這個我會。', 'happy'),
      c('shen', '所以先從你不會的開始。'),
      c('narrator', '問道碑會把真正理解的「悟念」轉化成修為。蒙對不代表理解，看完題解、知道為什麼，才算問道。'),
      c('player', '碑怎麼知道我是猜的？', 'confused'),
      c('shen', '它未必知道。'),
      c('player', '那就好。', 'happy'),
      c('shen', '所以最好別讓我知道。'),
      c('narrator', '你第一次意識到，師姐不需要測靈石，也能讓人感受到壓力。')
    ])
  }),

  Object.freeze({
    id: 'qi-five-dongtian',
    order: 2,
    minScore: 5,
    realm: '煉氣五層',
    title: '第二章 · 竹簡天尊',
    subtitle: '一場讓人不敢荒廢功課的夢',
    scene: Object.freeze({ page: 'page-home' }),
    // 這一章只播放夢境；洞天實作由後續獨立仙道任務開啟。
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
  }),

    Object.freeze({
    id: 'foundation-first-battle',
    order: 3,
    minScore: 10,
    realm: '築基初期',
    title: '第三章 · 築基之後，別只會做題',
    subtitle: '第一次真正的鬥法',
    scene: Object.freeze({ page: 'page-battle' }),
    // 兩次交棒：先與沈清霜交手，回到主線對話後，才由顧長風接手教學。
    tutorials: Object.freeze([
      Object.freeze({ kind: 'battle-shen', afterLine: 13 }),
      Object.freeze({ kind: 'battle-gu', afterLine: 22 })
    ]),
    lines: Object.freeze([
      c('narrator', '踏入築基的那天，宗門演武場第一次向你開放。沈清霜帶你走上鬥法臺。'),
      c('shen', '築基之後，鬥法與仙盟正式開放。真正交手時，題目、速度、法寶、生命與判斷都會決定勝負。'),
      c('player', '所以我要跟誰打？', 'confused'),
      c('shen', '我。'),
      c('player', '……師姐親自？不太好吧…哈哈。', 'confused'),
      c('shen', '鬥法台有保命陣法，在這裡演武，不會真的死亡。'),
      c('player', '那就好……嗯？不對！', 'happy'),
      c('shen', '痛覺也關了。'),
      c('player', '師姐突然很體貼呢……', 'happy'),
      c('shen', '因為你等一下沒空想這個。'),
      c('player', '……我現在可以反悔嗎？', 'confused'),
      c('shen', '不可以。'),
      c('narrator', '沈清霜走到鬥法臺另一端，連劍都沒有完全拔出。'),
      c('shen', '上場，我帶你練習一次。'),
      c('narrator', '一道劍光掠過，你還沒看清她如何出手，演武投影便碎成滿地流光。沈清霜收劍，難得怔住。'),
      c('player', '……', 'confused'),
      c('shen', '……'),
      c('shen', '呃……沒事吧？'),
      c('player', '人沒事，尊嚴沒了。', 'confused'),
      c('shen', '顧長風，過來。你陪他練基本鬥法。'),
      c('rival', '師姐，你剛才那一劍……'),
      c('shen', '我已經收了力。下一場按你們能承受的程度。'),
      c('narrator', '顧長風走上鬥法臺，沈清霜退到場邊，示意他開始。'),
      c('narrator', '第二場演武結束後，你扶著鬥法臺站穩。顧長風收起劍，沈清霜仍在場邊看著你。'),
      c('player', '師姐，這次我總算知道怎麼出手了。', 'determined'),
      c('shen', '記住，先看清題目，再看清對手。'),
      c('rival', '下次正式配對，可不會有人在旁邊替你解釋。'),
      c('player', '……我還是先回仙府多練幾題。', 'confused')
    ])
  }),

  Object.freeze({
    id: 'foundation-refinery',
    order: 4,
    minScore: 10,
    realm: '築基初期',
    title: '第四章 · 法寶不是把東西丟進火裡',
    subtitle: '八方煉器陣',
    scene: Object.freeze({ page: 'page-training', trainingTab: 'refinery' }),
    lines: Object.freeze([
      c('narrator', '鬥法結束後，沈清霜沒有讓你休息，而是把你帶到器坊。一名袖口沾著金屬灰的男子正對著一座八方火陣發脾氣。'),
      c('refineryMaster', '誰又把沒有靈性的廢料塞進我的坎位？'),
      c('shen', '他。'),
      c('player', '我才剛來！', 'confused'),
      c('refineryMaster', '哦。那應該是上一個。'),
      c('narrator', '石百煉看了你兩眼，把一塊木料丟進你手裡。'),
      c('refineryMaster', '煉器不是把材料燒熟。先看性質、再看搭配、再看你想讓它成為什麼。'),
      c('shen', '材料可以先煉成能用的部件，也可以讓已有法寶繼續升華。越往後，越重視不同特性的協調。'),
      c('player', '如果煉出一個不知道有什麼用途的東西呢？', 'confused'),
      c('refineryMaster', '那叫失敗品。'),
      c('player', '如果它很亮？', 'happy'),
      c('shen', '比較亮的失敗品。'),
      c('refineryMaster', '……我喜歡她的分類法。'),
      c('narrator', '石百煉教你認識八方煉器陣、素材與器胚。沈清霜則站在旁邊，負責在你想把奇怪東西放進爐子時看你一眼。'),
      c('player', '師姐，妳不用說話我也知道。', 'confused'),
      c('shen', '很好。省時間。')
    ])
  }),

  Object.freeze({
    id: 'foundation-mid-alliance',
    order: 5,
    minScore: 16,
    realm: '築基中期',
    title: '第五章 · 仙盟送來了一封很不吉利的信',
    subtitle: '古洞天異變',
    scene: Object.freeze({ page: 'page-social' }),
    lines: Object.freeze([
      c('narrator', '築基中期後，宗門收到仙盟急信。使者蘇聞月來到仙府時，沈清霜正在看你整理洞天題目。'),
      c('envoy', '沈道友，北境三座古洞天同時失去題序。碑文沒有損壞，但所有答案都被改成了同一個字。'),
      c('player', '什麼字？', 'confused'),
      c('envoy', '「一」。'),
      c('player', '這個反派是不是很省事？', 'confused'),
      c('shen', '也可能是字庫壞了。'),
      c('envoy', '……我第一次聽見有人用這種方式安慰仙盟。'),
      c('narrator', '蘇聞月把一片黑色殘頁放到桌上。殘頁靠近問道碑時，碑面浮出你從沒見過的古紋。'),
      c('shen', '天裂之前的問道紋。'),
      c('player', '師姐知道？', 'confused'),
      c('shen', '我查了很多年。'),
      c('envoy', '有人正在收集古洞天與上古道印。仙盟只知道那人自稱「無相客」。'),
      c('shen', '從今天起，你建立洞天時多留意來源不明的黑色符紋。不要碰。'),
      c('player', '如果已經碰了呢？', 'confused'),
      c('shen', '你碰了？'),
      c('player', '我是假設。', 'determined'),
      c('shen', '很好。保持假設。')
    ])
  }),

  Object.freeze({
    id: 'foundation-late-shadow',
    order: 6,
    minScore: 22,
    realm: '築基後期',
    title: '第六章 · 沈清霜的劍第一次出鞘',
    subtitle: '無相客',
    scene: Object.freeze({ page: 'page-home' }),
    lines: Object.freeze([
      c('narrator', '築基後期的一次洞天回返，你在仙府外看見一個陌生人。他沒有腳步聲，也沒有影子。'),
      c('antagonist', '原來問道碑真的在這裡。'),
      c('player', '你是誰？', 'determined'),
      c('antagonist', '一個想讓世間少一點錯誤答案的人。'),
      c('player', '聽起來不像壞人。', 'confused'),
      c('antagonist', '所以我喜歡聰明人。'),
      c('narrator', '下一瞬，一道極細的劍光橫在你與陌生人之間。沈清霜站在台階上，神情和平常一樣。'),
      c('shen', '離他遠點。'),
      c('antagonist', '沈清霜。妳還是一樣護短。'),
      c('shen', '我只是懶得重新教一個。'),
      c('player', '師姐，我就在旁邊。', 'confused'),
      c('shen', '所以你聽得見。'),
      c('narrator', '無相客沒有出手，只把一片黑色殘頁留在地上。'),
      c('antagonist', '天下萬法若各有答案，爭論便永遠不會停止。總有一天，你們會明白「唯一答案」才是秩序。'),
      c('shen', '只有不會思考的人，才怕答案太多。'),
      c('narrator', '無相客消失後，你才發現沈清霜的劍已經回鞘。從頭到尾，你甚至沒看清她何時拔劍。'),
      c('player', '師姐，妳剛才那劍能教我嗎？', 'happy'),
      c('shen', '能。'),
      c('player', '真的？', 'happy'),
      c('shen', '先練一百年。'),
      c('player', '……當我沒問。', 'confused')
    ])
  }),

  Object.freeze({
    id: 'golden-core-truth',
    order: 7,
    minScore: 28,
    realm: '金丹',
    title: '第七章 · 丹成之日，問道碑醒了',
    subtitle: '第一枚道印',
    scene: Object.freeze({ page: 'page-training', trainingTab: 'core' }),
    tutorialKind: 'golden-core',
    tutorialAfterLine: 14,
    lines: Object.freeze([
      c('narrator', '金丹凝成的那一刻，仙府震動了整整三息。問道碑上第一道古紋完全亮起，一枚金色印記從碑中浮出。'),
      c('player', '師姐，這正常嗎？', 'confused'),
      c('shen', '不知道。'),
      c('player', '妳終於也有不知道的事。', 'happy'),
      c('shen', '我不知道的是它為什麼現在才亮。不是它是什麼。'),
      c('player', '……高興早了。', 'confused'),
      c('shen', '這是上古問道天碑的道印。天裂之變時，完整天碑被打碎，散入各地洞天與傳承。'),
      c('shen', '我們現在用的問道仙府，只保留了其中一部分能力：把理解轉成悟念，再把悟念化成修為。'),
      c('player', '無相客在找這些道印？', 'determined'),
      c('shen', '嗯。他想把所有道印重新拼起來。'),
      c('player', '重新拼好不是好事？', 'confused'),
      c('shen', '看由誰拼，以及他想把什麼寫進去。'),
      c('narrator', '沈清霜伸手碰了一下金色道印。道印沒有排斥她，卻在接近你時發出更明亮的光。'),
      c('shen', '它認你。'),
      c('shen', '你的本命金丹也被喚醒了。先去修煉頁看看丹性、品級和調御之法，再來看這枚道印。'),
      c('narrator', '你從修煉頁返回時，丹田中那枚金丹仍靜靜運轉；金色道印的光芒卻像在等你回答一個更難的問題。'),
      c('player', '因為我是天選之人？', 'happy'),
      c('shen', '也可能因為你第一天就把靈石拿反，它覺得你需要幫助。'),
      c('player', '這件事可以不要再提嗎？', 'confused'),
      c('shen', '不可以。')
    ])
  }),

  Object.freeze({
    id: 'nascent-soul-expedition',
    order: 8,
    minScore: 68,
    realm: '元嬰',
    title: '第八章 · 仙盟不是來請你喝茶',
    subtitle: '北境問道臺',
    scene: Object.freeze({ page: 'page-social' }),
    lines: Object.freeze([
      c('narrator', '踏入元嬰後，蘇聞月第二次來到青雲宗。這一次，她沒有帶信，而是帶來一張北境古圖。'),
      c('envoy', '問道臺現世。仙盟已確認，其中藏著第二枚道印。'),
      c('player', '所以要去拿？', 'determined'),
      c('envoy', '如果只有拿東西這麼簡單，我就不會親自來。'),
      c('rival', '我也去。'),
      c('player', '顧長風？你什麼時候進來的？', 'confused'),
      c('rival', '你們說到「不簡單」的時候。'),
      c('shen', '他一直在門外。'),
      c('rival', '大師姐，這個可以不用說。'),
      c('shen', '可以。但已經說了。'),
      c('narrator', '北境問道臺並不是單純遺跡，而是一座會根據進入者認知改變結構的古洞天。答錯的不是一道題，而是整條路。'),
      c('envoy', '無相客已先一步進去。'),
      c('shen', '{{junior}}，這次我不會替你選路。'),
      c('player', '因為我要獨當一面了？', 'determined'),
      c('shen', '因為上次我替你選，你還是走錯了。'),
      c('player', '那是岔路長得一模一樣！', 'confused'),
      c('shen', '所以這次自己錯。'),
      c('narrator', '你忽然覺得元嬰修士的尊嚴來得有點早。')
    ])
  }),

  Object.freeze({
    id: 'spirit-transformation-history',
    order: 9,
    minScore: 188,
    realm: '化神',
    title: '第九章 · 天裂不是天災',
    subtitle: '許長老的舊卷',
    scene: Object.freeze({ page: 'page-home' }),
    lines: Object.freeze([
      c('narrator', '化神之後，你的神識足以讀取問道碑深層殘文。許長老把一卷封存多年的宗門密錄交給你。'),
      c('elder', '有些事，本來要等你再穩一點才說。'),
      c('player', '我現在很穩。', 'determined'),
      c('elder', '你上週御劍撞了藏經閣。'),
      c('player', '那是風向。', 'confused'),
      c('shen', '那天無風。'),
      c('player', '師姐。', 'confused'),
      c('elder', '……總之，天裂之變並非自然災劫。'),
      c('narrator', '上古有一批修士認為，世間紛爭源於「不同理解」。他們試圖用完整問道天碑替天下所有問題刻下唯一答案。'),
      c('elder', '結果天碑無法承受。無數互相衝突的道理被強行壓成一種說法，最後碑碎、洞天崩塌，這才有天裂。'),
      c('player', '無相客是在重做當年的事。', 'determined'),
      c('shen', '而且他知道當年失敗在哪。'),
      c('elder', '所以這次更危險。'),
      c('player', '我們要阻止他。', 'determined'),
      c('shen', '嗯。'),
      c('player', '師姐沒有更振奮人心一點的話嗎？', 'confused'),
      c('shen', '有。'),
      c('player', '什麼？', 'happy'),
      c('shen', '先把藏經閣修好。'),
      c('player', '……是。', 'neutral')
    ])
  }),

  Object.freeze({
    id: 'void-refinement-choice',
    order: 10,
    minScore: 428,
    realm: '煉虛',
    title: '第十章 · 無相客給了你一道沒有選項的題',
    subtitle: '唯一答案',
    scene: Object.freeze({ page: 'page-home' }),
    lines: Object.freeze([
      c('narrator', '煉虛境後，你終於在一座廢棄洞天正面遇見無相客。這次沈清霜沒有立刻拔劍。'),
      c('antagonist', '你已走到這一步，應該知道世間最大的浪費是什麼。'),
      c('player', '走錯洞天出口？', 'confused'),
      c('shen', '那是你的問題。'),
      c('antagonist', '爭論。無數人耗盡一生，只因每個人都相信自己的答案。'),
      c('antagonist', '若問道天碑重建，我可以讓所有人一開始就知道正確答案。沒有誤解、沒有爭執、沒有錯路。'),
      c('player', '聽起來很方便。', 'neutral'),
      c('shen', '方便不等於對。'),
      c('antagonist', '妳還是一樣固執。'),
      c('shen', '你還是一樣怕麻煩。'),
      c('narrator', '無相客看向你。他沒有出手，而是把第三枚道印放在地上。'),
      c('antagonist', '拿去。等你真正見過修行界的混亂，再來回答我：人究竟需要真相，還是需要選擇？'),
      c('player', '這題沒有四個選項？', 'confused'),
      c('antagonist', '……沒有。'),
      c('player', '那有點不習慣。', 'confused'),
      c('shen', '很好。開始會做申論了。'),
      c('narrator', '這大概是你第一次從沈清霜口中聽見近似稱讚的話。大概。')
    ])
  }),

  Object.freeze({
    id: 'integration-revelation',
    order: 11,
    minScore: 788,
    realm: '合體',
    title: '第十一章 · 仙府真正的用途',
    subtitle: '不是考場',
    scene: Object.freeze({ page: 'page-settings' }),
    lines: Object.freeze([
      c('narrator', '合體境時，三枚道印在仙府中彼此共鳴。原本封閉的地宮開啟，你和沈清霜在最深處看見一行上古刻字。'),
      c('player', '「以問開道，以疑證真。」', 'neutral'),
      c('shen', '這座仙府最初不是考場。'),
      c('player', '那是什麼？', 'confused'),
      c('shen', '研究道理的地方。題目只是方法，不是目的。'),
      c('narrator', '完整的問道天碑從來不提供「所有問題的唯一答案」。它記錄不同人的推理、證據與反駁，讓後來者站在前人的理解上繼續問。'),
      c('player', '所以無相客從根本上理解反了。', 'determined'),
      c('shen', '他不是不懂。他是不接受。'),
      c('player', '有差嗎？', 'confused'),
      c('shen', '很大。笨可以教，執意不想懂比較麻煩。'),
      c('player', '師姐是在說我以前屬於前者？', 'confused'),
      c('shen', '你現在偶爾也屬於。'),
      c('player', '……謝謝妳沒有說「一直」。', 'happy'),
      c('shen', '我本來要說。'),
      c('narrator', '地宮盡頭，一道通往上古天碑核心的星門逐漸成形。真正的決戰開始有了方向。')
    ])
  }),

  Object.freeze({
    id: 'mahayana-alliance',
    order: 12,
    minScore: 1268,
    realm: '大乘',
    title: '第十二章 · 大家都來了，因為你已經不能裝沒事',
    subtitle: '決戰之前',
    scene: Object.freeze({ page: 'page-social' }),
    lines: Object.freeze([
      c('narrator', '大乘境後，仙盟、青雲宗與各地洞天主人齊聚仙府。石百煉帶來修好的法寶，顧長風帶來一身新傷，蘇聞月帶來一疊厚得像能當武器的情報。'),
      c('envoy', '無相客已集齊六枚道印。剩下三枚，其中一枚在你這裡。'),
      c('refineryMaster', '你的主法寶我重新校過。這次再炸，我就當場改行煉丹。'),
      c('player', '上次不是我炸的。', 'confused'),
      c('refineryMaster', '我知道。所以上次我沒改行。'),
      c('rival', '外圍交給我。你只管進去。'),
      c('player', '突然這麼可靠，我有點不習慣。', 'confused'),
      c('rival', '等你回來再打一場，就習慣了。'),
      c('shen', '先活著回來。'),
      c('player', '這次終於像正常的關心了。', 'happy'),
      c('shen', '因為重新教一個真的很麻煩。'),
      c('player', '我就知道。', 'confused'),
      c('envoy', '你們平常都是這樣準備決戰的嗎？'),
      c('refineryMaster', '比平常嚴肅很多了。'),
      c('narrator', '那天夜裡，問道碑的光照亮整座仙府。所有曾被你回答、建立、修復過的題與洞天，都化成細小光點匯入星門。')
    ])
  }),

  Object.freeze({
    id: 'tribulation-final',
    order: 13,
    minScore: 1868,
    realm: '渡劫',
    title: '第十三章 · 天劫之上仍有一道題',
    subtitle: '問道天碑核心',
    scene: Object.freeze({ page: 'page-rank' }),
    lines: Object.freeze([
      c('narrator', '渡劫之日，雷雲覆蓋九州。無相客在天碑核心完成了第八枚道印，最後缺的正是你手中那一枚。'),
      c('antagonist', '把它交給我。從此天下所有人都不必再走錯路。'),
      c('player', '如果碑上的答案本身錯了呢？', 'determined'),
      c('antagonist', '我會確保它不錯。'),
      c('player', '誰來確保你？', 'determined'),
      c('narrator', '無相客沉默。天碑核心第一次出現裂紋。'),
      c('antagonist', '所以你寧願留下混亂？'),
      c('player', '我寧願留下能質疑答案的人。', 'determined'),
      c('antagonist', '那你和她一樣愚蠢。'),
      c('shen', '謝謝。'),
      c('player', '師姐，他不是在誇妳。', 'confused'),
      c('shen', '我知道。只是很少有人當面說。'),
      c('narrator', '雷光落下。沈清霜一劍截住崩裂的天碑，你則把最後一枚道印放回問道碑原本的位置——不是中心，而是留白處。'),
      c('narrator', '九枚道印沒有合成唯一答案，而是彼此分開，形成九個可以互相校驗、互相反駁的環。'),
      c('antagonist', '……原來如此。'),
      c('player', '你現在才懂？', 'confused'),
      c('shen', '別笑。他至少懂了。'),
      c('narrator', '無相客身後的黑色符紋一片片熄滅。天劫仍在，但那已經只是你自己的劫。'),
      c('shen', '{{junior}}。'),
      c('player', '嗯？', 'neutral'),
      c('shen', '別死。'),
      c('player', '又是這句。', 'happy'),
      c('shen', '有用就不必換。')
    ])
  }),

  Object.freeze({
    id: 'true-immortal-epilogue',
    order: 14,
    minScore: 2588,
    realm: '半仙',
    title: '終章 · 出師這件事，師姐說了算',
    subtitle: '問道不止',
    scene: Object.freeze({ page: 'page-rank' }),
    lines: Object.freeze([
      c('narrator', '你踏入半仙境那日，青雲宗沒有天地異象。因為前一天的異象已經被沈清霜一劍劈散，理由是「太吵」。'),
      c('player', '師姐，我現在半仙了。', 'happy'),
      c('shen', '嗯。'),
      c('player', '就這樣？', 'confused'),
      c('shen', '要恭喜？'),
      c('player', '正常來說會吧。', 'confused'),
      c('shen', '恭喜。'),
      c('player', '妳停頓得讓這兩個字完全沒有感情。', 'confused'),
      c('narrator', '修復後的問道碑不再替人保存「唯一答案」，而是保存題目、推理、題解、反例與後來者留下的新問題。'),
      c('envoy', '仙盟已決定把各地洞天接入新的問道網。'),
      c('refineryMaster', '器坊也會提供煉器實錄。錯誤配方也留。'),
      c('rival', '我的鬥法紀錄不准刪。尤其是贏你的。'),
      c('player', '輸的呢？', 'happy'),
      c('rival', '那是技術問題。'),
      c('narrator', '眾人離去後，你和沈清霜站在仙府門口。當年那塊寫著「正常」的測靈牌，還被她收在桌角。'),
      c('player', '師姐，我現在算出師了嗎？', 'happy'),
      c('shen', '不算。'),
      c('player', '我都半仙了，為什麼？', 'confused'),
      c('shen', '你還會問「為什麼」。'),
      c('player', '這不是好事嗎？', 'confused'),
      c('shen', '所以還能繼續教。'),
      c('player', '……妳是不是根本沒打算讓我出師？', 'confused'),
      c('shen', '被你發現了。'),
      c('narrator', '她轉身走進仙府。你愣了兩息才跟上。問道碑上，新的題目正一行一行亮起。'),
      c('narrator', '——修仙有境界，問道沒有終點。')
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
