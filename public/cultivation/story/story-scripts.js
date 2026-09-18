// 沈清霜主線劇本資料。
// 劇情台詞、角色資料與境界觸發全部集中在此檔，播放 UI 由 story-engine.js 負責。
// {{playerName}}、{{junior}} 會在執行時依玩家資料與性別自動替換。

export const STORY_VERSION = 1;

export const STORY_CHARACTERS = Object.freeze({
  narrator: Object.freeze({ name: '旁白', side: 'center', image: '' }),
  player: Object.freeze({ name: '{{playerName}}', side: 'left', dynamicPlayer: true }),
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
    title: '序章 · 誰把你帶進來的',
    subtitle: '青雲宗收徒日',
    lines: Object.freeze([
      c('narrator', '青雲宗山門前，三千多名新弟子排成長龍。有人測出火靈根，有人測出雷靈根，輪到你時，測靈石沉默了很久。'),
      c('elder', '……再測一次。'),
      c('player', '長老，是壞掉了嗎？', 'confused'),
      c('elder', '測靈石三百年沒壞過。通常出問題的不是石頭。'),
      c('narrator', '許長老換了一顆測靈石。光芒亮起，又迅速熄滅。玉牌上只浮出兩個字：正常。'),
      c('player', '「正常」也是一種靈根？', 'confused'),
      c('elder', '今日以前，我也不知道。'),
      c('narrator', '正當幾位長老研究該把你分去哪一峰時，一名月白道袍的女子從石階上走下。四周原本嘈雜的人群安靜了不少。'),
      c('elder', '清霜，來得正好。此子……妳看如何？'),
      c('shen', '能修。'),
      c('elder', '然後呢？'),
      c('shen', '那便修。'),
      c('narrator', '許長老看了看你，又看了看沈清霜，忽然露出一種「事情終於有人接手」的欣慰神情。'),
      c('player', '師姐，我是不是有什麼隱藏體質？', 'happy'),
      c('shen', '沒有。'),
      c('player', '特殊血脈？', 'confused'),
      c('shen', '沒有。'),
      c('player', '那妳為什麼選我？', 'confused'),
      c('shen', '其他人都走了。'),
      c('narrator', '你的修仙之路，就這樣非常有緣分地開始了。')
    ])
  }),

  Object.freeze({
    id: 'qi-one-ask-dao',
    order: 1,
    minScore: 1,
    realm: '煉氣一層',
    title: '第一章 · 問道不是猜答案',
    subtitle: '仙府的第一堂課',
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
    title: '第二章 · 把知識煉成一座山',
    subtitle: '洞天初開',
    lines: Object.freeze([
      c('shen', '{{junior}}，你已經會回答別人的問題。接下來學第二件事。'),
      c('player', '更難的題？', 'confused'),
      c('shen', '出題。'),
      c('player', '……修仙還要出考卷？', 'confused'),
      c('shen', '若你不能整理一件事、辨別重點、設計試煉，就很難說自己真的理解。'),
      c('narrator', '沈清霜抬手，仙府一角的空間向內折疊，一道紫色門扉慢慢展開。'),
      c('shen', '這叫洞天。文字、筆記、圖片，都能交給仙府推演成固定題序的知識秘境。'),
      c('player', '仙府自己出題，那我是不是不用讀？', 'happy'),
      c('shen', '它也會出題考你。'),
      c('player', '……我收回剛才的話。', 'confused'),
      c('shen', '正式洞天至少十題。少量十題，中量十五至二十題，大量二十五至三十題。每題四選一，只留一個正解。'),
      c('shen', '生成時每五題一批，後一批會看過前面的題目，避免同一件事換句話再問一次。'),
      c('player', '師姐連「AI 亂出重複題」都想過？', 'happy'),
      c('shen', 'AI 是什麼？'),
      c('player', '……當我沒說。', 'confused'),
      c('shen', '我給你留了一座私人範例。完成它，再親手刪掉。'),
      c('player', '剛做完就刪？', 'confused'),
      c('shen', '修士不可執著外物。'),
      c('player', '妳是不是只是懶得整理？', 'happy'),
      c('shen', '今日修行加倍。'),
      c('player', '我錯了。', 'determined')
    ])
  }),

  Object.freeze({
    id: 'foundation-first-battle',
    order: 3,
    minScore: 10,
    realm: '築基初期',
    title: '第三章 · 築基之後，別只會做題',
    subtitle: '第一次真正的鬥法',
    lines: Object.freeze([
      c('narrator', '踏入築基的那天，宗門演武場第一次向你開放。沈清霜帶你走進場內，一名抱劍青年已經等了很久。'),
      c('rival', '顧長風。聽說你就是大師姐親自帶的那個人。'),
      c('player', '聽起來好像很厲害。', 'happy'),
      c('rival', '我說的是「親自帶」，沒說你厲害。'),
      c('player', '這宗門的人說話都這麼直接嗎？', 'confused'),
      c('shen', '不是。'),
      c('player', '還好。', 'happy'),
      c('shen', '只有實話比較短。'),
      c('narrator', '顧長風忍了幾息，最後還是笑出了聲。'),
      c('shen', '築基之後開放鬥法與仙盟。題目修為決定你能走多遠，法寶、狀態與判斷決定你在真正交手時能不能站到最後。'),
      c('rival', '我不會因為你是大師姐帶的就放水。'),
      c('shen', '不必放。'),
      c('player', '師姐，妳是不是應該先鼓勵我？', 'confused'),
      c('shen', '別死。'),
      c('player', '這算鼓勵？', 'confused'),
      c('shen', '對我而言算。'),
      c('narrator', '你第一次明白，築基的「基」可能也包含心理素質。')
    ])
  }),

  Object.freeze({
    id: 'foundation-refinery',
    order: 4,
    minScore: 10,
    realm: '築基初期',
    title: '第四章 · 法寶不是把東西丟進火裡',
    subtitle: '八方煉器陣',
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
    minScore: 128,
    realm: '化神',
    title: '第九章 · 天裂不是天災',
    subtitle: '許長老的舊卷',
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
    minScore: 208,
    realm: '煉虛',
    title: '第十章 · 無相客給了你一道沒有選項的題',
    subtitle: '唯一答案',
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
    minScore: 308,
    realm: '合體',
    title: '第十一章 · 仙府真正的用途',
    subtitle: '不是考場',
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
    minScore: 448,
    realm: '大乘',
    title: '第十二章 · 大家都來了，因為你已經不能裝沒事',
    subtitle: '決戰之前',
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
    minScore: 628,
    realm: '渡劫',
    title: '第十三章 · 天劫之上仍有一道題',
    subtitle: '問道天碑核心',
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
    minScore: 868,
    realm: '真仙',
    title: '終章 · 出師這件事，師姐說了算',
    subtitle: '問道不止',
    lines: Object.freeze([
      c('narrator', '你踏入真仙那日，青雲宗沒有天地異象。因為前一天的異象已經被沈清霜一劍劈散，理由是「太吵」。'),
      c('player', '師姐，我現在是真仙了。', 'happy'),
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
      c('player', '我都真仙了，為什麼？', 'confused'),
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
