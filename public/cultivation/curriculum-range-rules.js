// Pure rules for chapter splitting and portable study lists.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CurriculumRangeRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX_UNITS = 24, MAX_DETAIL = 90, MAX_INPUT = 2400, MAX_SHARE = 64000;
  const SCHEMA = 'qingyun-study-scopes';
  const subjects = new Set(['國文','國語','英文','數學','數學A','數學B','數學甲','數學乙','生物','物理','化學','地球科學','歷史','地理','公民','自然','自然科學','社會','生活','藝術','健康與體育','本土語文','綜合活動','綜合']);
  const brackets = new Map([['(',')'],['（','）'],['[',']'],['【','】'],['{','}'],['〔','〕'],['「','」'],['『','』'],['“','”'],['"','"']]);
  // Verified publisher contents may be selected without certifying every reference question.
  function selectableBook(book) {
    if(!book)return false;
    if(book.legacyVisible || book.releaseStatus === 'released')return true;
    // A separately labelled 114 school-year transcription is selectable for practice,
    // not a raw-document-verified or officially released book. Keep grade 11 gates intact.
    if(book.scopeSelectionStatus === 'source-reviewed-crosswalk'){
      const e=book.scopeEvidence;
      const subjects=['數學','物理','化學','生物','地球科學'], publishers=['龍騰','翰林','南一','泰宇','三民','全華'];
      if(book.grade!=='高中一年級'||!subjects.includes(book.subject)||!publishers.includes(book.publisher)||
        book.edition!==book.publisher+'版'||book.schoolYear!==114||book.releaseStatus!=='blocked'||
        book.verificationStatus!=='source-reviewed-crosswalk'||!/^\d{4}-\d{2}-\d{2}$/.test(book.verifiedAt||'')||
        e?.kind!=='publisher-crosswalk-transcription'||e.publisher!==book.publisher||e.schoolYear!==114||
        e.columnPolicy!=='publisher-left-only'||e.rawFileHashStatus!=='unavailable'||
        !['page-and-text','structured-text'].includes(e.reviewMethod)||!Number.isInteger(e.page)||e.page<1||e.page>6)return false;
      const expectedFile=book.subject==='數學'?(book.term==='第一學期'?'10-1_comparison_math_114.pdf':book.term==='第二學期'?'10-2_comparison_math_114.pdf':''):
        book.term==='必修'+book.subject?({'物理':'10-1_comparison_physical_114.pdf','化學':'10-1_comparison_chemistry_114.pdf','生物':'10-1_comparison_biologic_114.pdf','地球科學':'10-1_comparison_geoscience_114.pdf'}[book.subject]||''):'';
      const table=book.publisher+(book.subject==='數學'?'數學高一'+(book.term==='第一學期'?'上':'下'):'必修'+(book.subject==='地球科學'?'地科':book.subject));
      return !!expectedFile&&!!book.sources?.some(s=>s.type==='third-party-curriculum-crosswalk'&&s.schoolYear===114&&s.page===e.page&&
        s.publisherTable===table&&s.reviewMethod===e.reviewMethod&&s.url==='https://www.go100.com.tw/file/108_comparison_table/senior/'+expectedFile+'?v=20250901')&&
        !!book.units?.length&&book.units.every(u=>u.details?.length>0&&new Set(u.details).size===u.details.length&&
          Array.isArray(u.concepts)&&u.concepts.length===u.details.length&&u.concepts.every((c,i)=>c.name===u.details[i]&&Array.isArray(c.allowedContent)&&c.allowedContent.length>0&&Array.isArray(c.excludedContent)));
    }
    if(book.scopeSelectionStatus==='civics-crosswalk-transcription'){
      const e=book.scopeEvidence,vol=book.grade==='高中一年級'?(book.term==='第一學期'?1:book.term==='第二學期'?2:0):book.grade==='高中二年級'&&book.term==='第一學期'?3:0;
      const sources=["10-1_comparison_civics_114.pdf?v=20250901","10-2_comparison_civics_114.pdf?v=20260224","11-1_comparison_civics_114.pdf?v=20250901"];
      const allowed={"龍騰|龍騰版|高中一年級|第一學期":{"page":1,"additionalPages":[2],"table":"龍騰一上","method":"partial-page-and-text"},"龍騰|龍騰版（乙版）|高中一年級|第一學期":{"page":3,"additionalPages":[4],"table":"龍騰(乙)一上","method":"structured-text"},"翰林|翰林版|高中一年級|第一學期":{"page":5,"additionalPages":[6],"table":"翰林一上","method":"structured-text"},"翰林|翰林版（乙版）|高中一年級|第一學期":{"page":7,"additionalPages":[8],"table":"翰林(乙)一上","method":"structured-text"},"三民|三民版|高中一年級|第一學期":{"page":9,"additionalPages":[10],"table":"三民一上","method":"structured-text"},"南一|南一版|高中一年級|第一學期":{"page":11,"additionalPages":[12],"table":"南一一上","method":"structured-text"},"龍騰|龍騰版（乙版）|高中一年級|第二學期":{"page":1,"additionalPages":[],"table":"龍騰(乙)一下","method":"partial-page-and-text"},"翰林|翰林版（乙版）|高中一年級|第二學期":{"page":2,"additionalPages":[],"table":"翰林(乙)一下","method":"structured-text"},"三民|三民版|高中一年級|第二學期":{"page":3,"additionalPages":[],"table":"三民一下","method":"structured-text"},"南一|南一版|高中一年級|第二學期":{"page":4,"additionalPages":[],"table":"南一一下","method":"structured-text"},"龍騰|龍騰版|高中二年級|第一學期":{"page":1,"additionalPages":[2],"table":"龍騰二上","method":"partial-page-and-text"},"龍騰|龍騰版（乙版）|高中二年級|第一學期":{"page":3,"additionalPages":[],"table":"龍騰(乙)B3","method":"structured-text"},"翰林|翰林版|高中二年級|第一學期":{"page":4,"additionalPages":[],"table":"翰林二上","method":"structured-text"},"翰林|翰林版（乙版）|高中二年級|第一學期":{"page":5,"additionalPages":[],"table":"翰林(乙)二上","method":"structured-text"},"三民|三民版|高中二年級|第一學期":{"page":6,"additionalPages":[7],"table":"三民二上","method":"structured-text"},"南一|南一版|高中二年級|第一學期":{"page":8,"additionalPages":[9],"table":"南一二上","method":"structured-text"}};
      const a=allowed[[book.publisher,book.edition,book.grade,book.term].join('|')];
      if(!a||!vol||book.subject!=='公民'||book.schoolYear!==114||book.releaseStatus!=='blocked'||book.verificationStatus!==book.scopeSelectionStatus||
        book.courseType!=='required'||book.schedulePolicy!=='book-sequence'||book.scopeDetailLevel!=='crosswalk-sections'||!/^\d{4}-\d{2}-\d{2}$/.test(book.verifiedAt||'')||
        e?.kind!=='publisher-crosswalk-transcription'||e.publisher!==book.publisher||e.page!==a.page||e.schoolYear!==114||
        e.columnPolicy!=='publisher-left-only'||e.reviewMethod!==a.method||e.rawFileHashStatus!=='unavailable'||e.sourceTable!==a.table)return false;
      return !!book.sources?.some(s=>s.type==='third-party-curriculum-crosswalk'&&s.url==='https://www.go100.com.tw/file/108_comparison_table/senior/'+sources[vol-1]&&s.page===a.page&&JSON.stringify(s.additionalPages)===JSON.stringify(a.additionalPages)&&s.schoolYear===114&&s.publisherTable===a.table&&s.reviewMethod===a.method)&&
        !!book.units?.length&&new Set(book.units.map(u=>u.unit)).size===book.units.length&&book.units.every(u=>u.details?.length>0&&u.details.length<=24&&new Set(u.details).size===u.details.length&&
          Array.isArray(u.concepts)&&u.concepts.length===u.details.length&&u.concepts.every((c,i)=>c.name===u.details[i]&&Array.isArray(c.allowedContent)&&c.allowedContent.length&&Array.isArray(c.excludedContent)));
    }
    if(book.scopeSelectionStatus==='language-index-v2'){
      const a={"kiwi-108-chinese-1":{"publisher":"奇異果","subject":"國文","grade":"高中一年級","term":"第一學期","url":"https://www.titsia.com.tw/products-book/30","type":"official-textbook-index","provider":"奇異果文創","titles":["第1課 世說新語選（雪夜訪戴、坦腹東床）","第2課 項脊軒志","第3課 初經‧人事","第4課 小王子選（節錄）","第5課 師說","第6課 吶喊自序","第7課 JADA，我不要作山地人","第8課 渡台悲歌（節錄）","第9課 他鄉與故鄉","第10課 禹鯀治水","第11課 蒹葭","第12課 燭之武退秦師"]},"kiwi-108-chinese-2":{"publisher":"奇異果","subject":"國文","grade":"高中一年級","term":"第二學期","url":"https://www.titsia.com.tw/products-book/75","type":"official-textbook-index","provider":"奇異果文創","titles":["第1課 父後七日","第2課 寄遠戍東引的莫凡","第3課 種花","第4課 與元微之書","第5課 愛情‧鮮花‧夢想的莊園──殷海光（節錄）","第6課 張李德和詩文選（畫菊自序、歸寧、裁縫、教子）","第7課 童女之舞（節錄）","第8課 男人的撒嬌文化","第9課 鴻門宴","第10課 古詩、樂府詩選（東門行、短歌行、擬詠懷之十一）","中華文化基本教材第一單元：人文精神","中華文化基本教材第二單元：人性與安身立命"]},"kiwi-108-chinese-3":{"publisher":"奇異果","subject":"國文","grade":"高中二年級","term":"第一學期","url":"https://www.titsia.com.tw/products-book/84","type":"official-textbook-index","provider":"奇異果文創","titles":["第1課 紅樓夢（節錄）","第2課 現代詩選（大安、車過東港不老橋）","第3課 一首詩的完成（節錄）","第4課 世界鋼琴家訪問錄－齊瑪漫（節錄）","第5課 桃花源記","第6課 門（節錄）","第7課 福和橋","第8課 虯髯客傳","第9課 唐宋詩選（登高、金銅仙人辭漢歌、魯山山行）","第10課 五代宋詞選（浪淘沙、雨霖鈴、破陣子）","中華文化基本教材第三單元：人際的互動與衝突","中華文化基本教材第四單元：公共領域的構成與治理"]},"kiwi-108-chinese-4":{"publisher":"奇異果","subject":"國文","grade":"高中二年級","term":"第二學期","url":"https://www.titsia.com.tw/products-book/91","type":"official-textbook-index","provider":"奇異果文創","titles":["第1課 大同與小康","第2課 勸和論","第3課 自以為的客觀性","第4課 赤壁賦","第5課 無怨","第6課 服妖之鑑（節錄）","第7課 黑潮の親子舟","第8課 火車與稻田","第9課 竇娥冤","第10課 晚遊六橋待月記","中華文化基本教材第五單元：語言、知識與經典","中華文化基本教材第六單元：通往自由與幸福的道路"]},"sanmin-108-chinese-1":{"publisher":"三民","subject":"國文","grade":"高中一年級","term":"第一學期","url":"https://www.sanmin.com.tw/product/index/015587466","type":"publisher-companion-index","provider":"三民書局","titles":["第1課 桃花源記","第2課 再別康橋","第3課 師說","第4課 從「感覺」到「事實」的差距","第5課 樂府詩選（陌上桑、長干行）","第6課 髻","第7課 醉翁亭記","第8課 怪獸臺灣","第9課 項脊軒志","第10課 孔乙己","第11課 文學門縫","文化教材 論語選讀（找到自己的志向、如何立身處世、為學的方法）"]},"sanmin-108-chinese-2":{"publisher":"三民","subject":"國文","grade":"高中一年級","term":"第二學期","url":"https://www.sanmin.com.tw/product/index/011470635","type":"publisher-companion-index","provider":"三民書局","titles":["第1課 晚遊六橋待月記","第2課 詠物篇","第3課 劉姥姥進大觀園","第4課 祕密頻道","第5課 古詩選（生年不滿百、詠史）","第6課 鬼頭刀","第7課 出師表","第8課 玉山去來","第9課 岳陽樓記","第10課 現代詩選（狼之獨步、山雨）","第11課 壯遊"]},"sanmin-108-chinese-3":{"publisher":"三民","subject":"國文","grade":"高中二年級","term":"第一學期","url":"https://www.sanmin.com.tw/product/index/011987798","type":"publisher-companion-index","provider":"三民書局","titles":["第1課 勞山道士","第2課 發明為需求之母","第3課 近體詩選（旅夜書懷、夜雨寄北、寄黃幾復）","第4課 水證據——給河流","第5課 燭之武退秦師","第6課 一桿「稱仔」","第7課 鹿港乘桴記","第8課 祖靈遺忘的孩子","第9課 虬髯客傳","第10課 現代詩選（坤伶、愛的辯證）","第11課 散戲","文化教材 墨韓選讀（兼愛、猛狗社鼠、鄭人買履）"]},"sanmin-108-english-1":{"publisher":"三民","subject":"英文","grade":"高中一年級","term":"第一學期","url":"https://www.sanmin.com.tw/product/index/009636573","type":"publisher-companion-index","provider":"三民書局","titles":["UNIT 1 The First Day of School Around the World","UNIT 2 A Lesson in Forgiveness","UNIT 3 Making Society Work","UNIT 4 A Colorful Life","UNIT 5 Go to Bed!","UNIT 6 The Real ‘Price’ of Plastic","UNIT 7 A Little Science Works a Lot of Magic","UNIT 8 Customs and Superstitions Everywhere","UNIT 9 The World’s Love Affair with Chocolate","UNIT 10 A ‘Hero’ Called Frankenstein"]},"sanmin-108-english-2":{"publisher":"三民","subject":"英文","grade":"高中一年級","term":"第二學期","url":"https://www.sanmin.com.tw/product/index/007588882","type":"publisher-companion-index","provider":"三民書局","titles":["Unit 1 Animal Imagery in Different Languages","Unit 2 Reading Can Be a Daring Act","Unit 3 One Box, Many Solutions","Unit 4 Let's Dig In!","Unit 5 Gaming for Good?","Unit 6 Mother's Hands","Unit 7 Celebrating Science That Is Anything But Useful","Unit 8 The Hidden Costs of Our Clothing","Unit 9 Why Do We Lie?","Unit 10 The Men Behind Sherlock Holmes"]},"sanmin-108-chinese-4":{"publisher":"三民","subject":"國文","grade":"高中二年級","term":"第二學期","url":"https://www.sanmin.com.tw/product/index/012920708","type":"publisher-companion-index","provider":"三民書局","titles":["第1課 張李德和詩文選","第2課 天才夢","第3課 赤壁賦","第4課 尋熊記","第5課 大同與小康","第6課 死去活來","第7課 詞選（浪淘沙、一剪梅、破陣子）","第8課 豐富我的天使們","第9課 諫逐客書","第10課 現代詩選（小站、雁）","第11課 俊興街二二四巷","文化教材 老莊選讀（天下皆知美之為美、庖丁解牛）"]},"sanmin-108-chinese-5":{"publisher":"三民","subject":"國文","grade":"高中三年級","term":"第一學期","url":"https://www.sanmin.com.tw/product/index/013493054","type":"publisher-companion-index","provider":"三民書局","titles":["第1課 鴻門宴","第2課 第九味","第3課 勸和論","第4課 發生了什麼事？","第5課 先秦韻文選（蒹葭、漁父）","第6課 那晚的月光","第7課 文明的永晝與永夜已經開始","第8課 曲選（大德歌．秋、牡丹亭．遊園）","第9課 文學有用嗎？","第10課 竹林中"]},"sanmin-108-english-3":{"publisher":"三民","subject":"英文","grade":"高中二年級","term":"第一學期","url":"https://www.sanmin.com.tw/product/index/010608379","type":"publisher-companion-index","provider":"三民書局","titles":["Unit 1 Wrestling with Cultural Differences","Unit 2 Social Media: Finding a Balance","Unit 3 Dying to Be Attractive","Unit 4 A Quest for Taiwan's Freedom","Unit 5 The Stolen Generations: An Australian Tragedy","Unit 6 They’re Back!","Unit 7 Gynaikratia: The DayWomen ‘Rule’","Unit 8 Choose Love","Unit 9 Celebrations that Come with a Price","Unit 10 A Human War for a Dispute Among Gods"]},"sanmin-108-english-4":{"publisher":"三民","subject":"英文","grade":"高中二年級","term":"第二學期","url":"https://www.sanmin.com.tw/product/index/013675432","type":"publisher-companion-index","provider":"三民書局","titles":["Unit 1 A Love Coach’s Game Plan","Unit 2 The Truth About Fake News","Unit 3 The Woman That Never Dies","Unit 4 The Journey Ahead","Unit 5 A Future Without Forests","Unit 6 Would It Be Right to Let Our Loved Ones Go?","Unit 7 Living Together for the Greater Good","Unit 8 To Bribe or Not to Bribe, That Is the Question","Unit 9 A Slash Career: The Mainstream in the Future","Unit 10 Anne Frank’s Diary"]},"sanmin-108-english-5":{"publisher":"三民","subject":"英文","grade":"高中三年級","term":"第一學期","url":"https://www.sanmin.com.tw/product/index/013368570","type":"publisher-companion-index","provider":"三民書局","titles":["UNIT 1 Harvesting Power from Rotten Tomatoes","UNIT 2 Be Afraid, Be Very Afraid","UNIT 3 I Have a Dream","UNIT 4 Why Can’t I Say ‘NO!’?","UNIT 5 English for All: A Truly Global Language","UNIT 6 The Road Not Taken"]},"hanlin-108-chinese-1":{"publisher":"翰林","subject":"國文","grade":"高中一年級","term":"第一學期","url":"https://resource.hle.com.tw/Books/BooksResource/%E9%AB%98%E4%B8%AD%E5%9C%8B%E6%96%87%281%29%E3%80%90%E6%B7%B7%E5%90%88%E8%A9%A6%E9%A1%8C%E9%9B%86%E3%80%91%28111f467228%29.pdf","type":"publisher-companion-index","provider":"翰林出版","titles":["第1課 現代詩選","第2課 師說","第3課 鬼頭刀","第4課 項脊軒志","第5課 驚情","第6課 樂府詩選──陌上桑","第7課 孔乙己","第8課 桃花源記","第9課 髻","第10課 左忠毅公逸事","第11課 天才夢","文教 論語選（一）、（二）","自學 無國界醫生行醫記（第一次叢林手術、大愛非洲行）"]}}[book.bookId],e=book.scopeEvidence;
      return !!a&&book.publisher===a.publisher&&book.edition===a.publisher+'版'&&book.subject===a.subject&&book.grade===a.grade&&book.term===a.term&&book.schoolYear===null&&
        book.releaseStatus==='blocked'&&book.verificationStatus===book.scopeSelectionStatus&&book.scopeDetailLevel==='publisher-lessons-editorial-concepts'&&book.courseType==='required'&&book.schedulePolicy==='book-sequence'&&
        /^\d{4}-\d{2}-\d{2}$/.test(book.verifiedAt||'')&&e?.kind==='publisher-lesson-index'&&e.publisher===a.publisher&&e.schoolYear===null&&e.sectionPolicy==='editorial-concepts'&&e.sourceKind===a.type&&
        !!book.sources?.some(s=>s.url===a.url&&s.type===a.type&&s.provider===a.provider)&&JSON.stringify(book.units?.map(u=>u.unit))===JSON.stringify(a.titles)&&
        book.units.every(u=>u.details?.length===3&&new Set(u.details).size===3&&u.concepts?.length===3&&u.concepts.every((c,i)=>c.name===u.details[i]&&c.name.startsWith(u.unit+'｜')&&Array.isArray(c.allowedContent)&&c.allowedContent.length&&Array.isArray(c.excludedContent)));
    }
    if(book.scopeSelectionStatus==='publisher-language-outline'){
      const a={"longteng-108-chinese-1":{"subject":"國文","grade":"高中一年級","term":"第一學期","url":"https://www.ltedu.com.tw/web/mobile2/prodlist2.aspx?ID=9716","type":"official-textbook-index","titles":["第1課 桃花源記","第2課 再別康橋","第3課 樂府古詩選","第4課 小王子與狐狸","第5課 師說","第6課 發現事理的樂趣","第7課 范進中舉","第8課 孔乙己","第9課 髻","第10課 項脊軒志","第11課 煤炭堆上的黃蝴蝶","文教1 中華文化基本教材（一）論語選讀"]},"longteng-108-chinese-2":{"subject":"國文","grade":"高中一年級","term":"第二學期","url":"https://www.ltedu.com.tw/web/mobile2/prodlist2.aspx?ID=9817","type":"official-textbook-index","titles":["第1課 醉翁亭記","第2課 水證據－給河流","第3課 晚遊六橋待月記","第4課 玉山去來","第5課 丁挽","第6課 唐宋詩選","第7課 一桿「稱仔」","第8課 臺灣女性古典詩文選","第9課 天才夢","第10課 劉姥姥進大觀園","第11課 我們都失智","文教2 中華文化基本教材（二）孟子選讀"]},"longteng-108-chinese-3":{"subject":"國文","grade":"高中二年級","term":"第一學期","url":"https://www.ltedu.com.tw/web/mobile2/prodlist2.aspx?ID=9982","type":"official-textbook-index","titles":["第1課 飛魚季——Arayo","第2課 出師表","第3課 兩個孔明的文化玄機","第4課 勞山道士","第5課 散戲","第6課 赤壁賦","第7課 扼口","第8課 詞選","第9課 新詩選","第10課 燭之武退秦師","第11課 真愛","文教3 中華文化基本教材（三）墨韓選讀"]},"longteng-108-chinese-4":{"subject":"國文","grade":"高中二年級","term":"第二學期","url":"https://www.ltedu.com.tw/web/mobile2/prodlist2.aspx?ID=10093","type":"official-textbook-index","titles":["第1課 大同與小康","第2課 第九味","第3課 虬髯客傳","第4課 潛藏在認知裡的「錯誤知識」","第5課 諫逐客書","第6課 壯遊","第7課 曲選","第8課 和好的藝術","第9課 戰士，乾杯！","第10課 鹿港乘桴記","第11課 池上日記","文教4 中華文化基本教材（四）老莊選讀"]},"longteng-108-chinese-5":{"subject":"國文","grade":"高中三年級","term":"第一學期","url":"https://www.ltedu.com.tw/web/mobile2/prodlist2.aspx?ID=10293","type":"official-textbook-index","titles":["第1課 鴻門宴","第2課 雲裡找門","第3課 勸和論","第4課 新詩選","第5課 在迷宮中仰望星斗","第6課 先秦韻文選","第7課 一點六米寬的樓梯","第8課 竹藪中","第9課 馮諼客孟嘗君","第10課 好奇的眼睛"]},"longteng-108-english-1":{"subject":"英文","grade":"高中一年級","term":"第一學期","url":"https://www.ltedu.com.tw/web/mobile2/prodlist2.aspx?ID=9796","type":"publisher-companion-index","titles":["L1 Firsts in Life","L2 Goodbye, John","L3 Do Animals Sleep like You and Me?","R1 When Shocked in Rome","L4 Sniffing Out More Than Just Bones","L5 The Life of a Plastic Bag","L6 Built for Freedom: The Statue of Liberty","R2 Having Fun with Change","L7 From Trash to Triumph","L8 Convenience Stores: Where Our Wallets Are Always Open","L9 Fighting for or against Graffiti","R3 An Island’s Beauty, an Islander’s Duty"]},"longteng-108-english-2":{"subject":"英文","grade":"高中一年級","term":"第二學期","url":"https://www.ltedu.com.tw/web/mobile2/prodlist2.aspx?ID=9823","type":"publisher-companion-index","titles":["L1 The Heart of a Champion","L2 My Mouth’s in Airplane Mode!","L3 The Birthmark","R1 How Do You Take Your Tea, High or Low?","L4 Malala: Stronger Than Violence","L5 Walt Disney’s Inspirational Message: Dare to Dream","L6 No Wonder He’s Special","R2 Note How to Really Learn","L7 TED Talks: Spreading Ideas for a Better World","L8 Ban-Doh: The Most Authentic Taiwanese Eating Experience","L9 The Story behind Eponyms","R3 Living above the Earth—and Beyond"]},"longteng-108-english-3":{"subject":"英文","grade":"高中二年級","term":"第一學期","url":"https://www.ltedu.com.tw/web/mobile2/prodlist2.aspx?ID=10012","type":"publisher-companion-index","titles":["L1 The Day I Broke the Rules","L2 The Marshmallow Challenge: A Lesson in Keeping It Simple","L3 Prometheus: The Champion of Humankind","R1 3D Printing: Imagination Is the Only Limit","L4 Day of the Dead: A Joyous Celebration of Death","L5 Kyoto: The Heart of Japan","L6 My Life in Your Hands","R2 The Mystery of the Disappearing Bees","L7 Bodies Speak Louder Than Words","L8 Elephant Abuse: The Thai Tourism Industry’s Dark Secret","L9 Mazu Mania: A Great Pilgrimage That Unifies the People","R3 Fast Fashion, But at What Cost?"]},"longteng-108-english-4":{"subject":"英文","grade":"高中二年級","term":"第二學期","url":"https://www.ltedu.com.tw/web/mobile2/prodlist2.aspx?ID=10107","type":"publisher-companion-index","titles":["L1 The Bet","L2 Boat Schools: Making Waves in Education","L3 Progress and Preservation: Striking a Balance","R1 Grasse: The Perfume Capital of the World","L4 Living under Nature’s Wing","L5 Irena Sendler: A Holocaust Hero","L6 Dabbawalas: Door-to-Door Meal Delivery in Mumbai","R2 Watch Out! Danger Ahead on the Information Superhighway","L7 Iceland’s Road to Gender Equality","L8 Too Much of a Good Thing—Overtourism in Barcelona","L9 To Kill a Mockingbird","R3 Marathons: Going the Extra Mile"]},"longteng-108-english-5":{"subject":"英文","grade":"高中三年級","term":"第一學期","url":"https://www.ltedu.com.tw/web/mobile2/prodlist2.aspx?ID=10313","type":"official-textbook-index","titles":["L1 Life Lessons in Rudyard Kipling's \"If--\"","L2 Battling Fake News: A Critical Mindset","L3 Formosa: One Name, Two Stories","L4 Lab-Grown Meat: To Eat or Not to Eat","L5 Venice: A Sinking City","L6 I Have a Dream"]}}[book.bookId],e=book.scopeEvidence;
      return !!a&&book.grade===a.grade&&book.subject===a.subject&&book.term===a.term&&book.publisher==='龍騰'&&book.edition==='龍騰版'&&book.schoolYear===null&&
        book.releaseStatus==='blocked'&&book.verificationStatus===book.scopeSelectionStatus&&book.courseType==='required'&&book.schedulePolicy==='book-sequence'&&
        book.scopeDetailLevel==='publisher-lessons-editorial-concepts'&&/^\d{4}-\d{2}-\d{2}$/.test(book.verifiedAt||'')&&e?.kind==='publisher-lesson-index'&&
        e.publisher===book.publisher&&e.schoolYear===null&&e.sectionPolicy==='editorial-concepts'&&e.sourceKind===a.type&&
        !!book.sources?.some(s=>s.url===a.url&&s.type===a.type&&s.provider==='龍騰文化')&&
        JSON.stringify(book.units?.map(u=>u.unit))===JSON.stringify(a.titles)&&
        book.units.every(u=>u.details?.length>0&&u.details.length<=24&&new Set(u.details).size===u.details.length&&Array.isArray(u.concepts)&&u.concepts.length===u.details.length&&u.concepts.every((c,i)=>c.name===u.details[i]&&Array.isArray(c.allowedContent)&&c.allowedContent.length&&Array.isArray(c.excludedContent)));
    }
    if(book.scopeSelectionStatus==='elective-social-crosswalk-transcription'){
      const a={"longteng-114-elective-history-1":{"subject":"歷史","publisher":"龍騰","term":"第一學期","page":1,"additionalPages":[],"url":"https://www.go100.com.tw/file/108_comparison_table/senior/12-1_comparison_history_I_114.pdf?v=20250901","table":"龍騰選修I","method":"page-and-text"},"hanlin-114-elective-history-1":{"subject":"歷史","publisher":"翰林","term":"第一學期","page":2,"additionalPages":[],"url":"https://www.go100.com.tw/file/108_comparison_table/senior/12-1_comparison_history_I_114.pdf?v=20250901","table":"翰林選修I","method":"structured-text"},"nani-114-elective-history-1":{"subject":"歷史","publisher":"南一","term":"第一學期","page":3,"additionalPages":[],"url":"https://www.go100.com.tw/file/108_comparison_table/senior/12-1_comparison_history_I_114.pdf?v=20250901","table":"南一選修I","method":"structured-text"},"sanmin-114-elective-history-1":{"subject":"歷史","publisher":"三民","term":"第一學期","page":4,"additionalPages":[],"url":"https://www.go100.com.tw/file/108_comparison_table/senior/12-1_comparison_history_I_114.pdf?v=20250901","table":"三民選修I","method":"structured-text"},"longteng-114-elective-history-2":{"subject":"歷史","publisher":"龍騰","term":"第二學期","page":1,"additionalPages":[],"url":"https://www.go100.com.tw/file/108_comparison_table/senior/12-2_comparison_elective_history_II_114.pdf?v=20260224","table":"龍騰選修II","method":"page-and-text"},"nani-114-elective-history-2":{"subject":"歷史","publisher":"南一","term":"第二學期","page":2,"additionalPages":[],"url":"https://www.go100.com.tw/file/108_comparison_table/senior/12-2_comparison_elective_history_II_114.pdf?v=20260224","table":"南一選修II","method":"structured-text"},"hanlin-114-elective-history-2":{"subject":"歷史","publisher":"翰林","term":"第二學期","page":3,"additionalPages":[],"url":"https://www.go100.com.tw/file/108_comparison_table/senior/12-2_comparison_elective_history_II_114.pdf?v=20260224","table":"翰林選修II","method":"structured-text"},"sanmin-114-elective-history-2":{"subject":"歷史","publisher":"三民","term":"第二學期","page":4,"additionalPages":[],"url":"https://www.go100.com.tw/file/108_comparison_table/senior/12-2_comparison_elective_history_II_114.pdf?v=20260224","table":"三民選修II","method":"structured-text"},"longteng-114-elective-geography-1":{"subject":"地理","publisher":"龍騰","term":"第一學期","page":1,"additionalPages":[],"url":"https://www.go100.com.tw/file/108_comparison_table/senior/12-1_comparison_elective_geography_I_114.pdf?v=20250901","table":"龍騰選修I","method":"page-and-text"},"hanlin-114-elective-geography-1":{"subject":"地理","publisher":"翰林","term":"第一學期","page":2,"additionalPages":[],"url":"https://www.go100.com.tw/file/108_comparison_table/senior/12-1_comparison_elective_geography_I_114.pdf?v=20250901","table":"翰林選修I","method":"structured-text"},"nani-114-elective-geography-1":{"subject":"地理","publisher":"南一","term":"第一學期","page":3,"additionalPages":[4],"url":"https://www.go100.com.tw/file/108_comparison_table/senior/12-1_comparison_elective_geography_I_114.pdf?v=20250901","table":"南一選修I","method":"structured-text"},"longteng-114-elective-geography-2":{"subject":"地理","publisher":"龍騰","term":"第二學期","page":1,"additionalPages":[],"url":"https://www.go100.com.tw/file/108_comparison_table/senior/12-2_comparison_elective_geography_II_114.pdf?v=20260224","table":"龍騰選修II","method":"page-and-text"},"hanlin-114-elective-geography-2":{"subject":"地理","publisher":"翰林","term":"第二學期","page":2,"additionalPages":[],"url":"https://www.go100.com.tw/file/108_comparison_table/senior/12-2_comparison_elective_geography_II_114.pdf?v=20260224","table":"翰林選修II","method":"structured-text"},"nani-114-elective-geography-2":{"subject":"地理","publisher":"南一","term":"第二學期","page":3,"additionalPages":[],"url":"https://www.go100.com.tw/file/108_comparison_table/senior/12-2_comparison_elective_geography_II_114.pdf?v=20260224","table":"南一選修II","method":"structured-text"},"longteng-114-elective-civics-1":{"subject":"公民","publisher":"龍騰","term":"第一學期","page":1,"additionalPages":[2],"url":"https://www.go100.com.tw/file/108_comparison_table/senior/12-1_comparison_civics_I_114.pdf?v=20250901","table":"龍騰選修上","method":"structured-text"},"hanlin-114-elective-civics-1":{"subject":"公民","publisher":"翰林","term":"第一學期","page":3,"additionalPages":[],"url":"https://www.go100.com.tw/file/108_comparison_table/senior/12-1_comparison_civics_I_114.pdf?v=20250901","table":"翰林選修上","method":"structured-text"},"sanmin-114-elective-civics-1":{"subject":"公民","publisher":"三民","term":"第一學期","page":4,"additionalPages":[],"url":"https://www.go100.com.tw/file/108_comparison_table/senior/12-1_comparison_civics_I_114.pdf?v=20250901","table":"三民選修上","method":"structured-text"},"nani-114-elective-civics-1":{"subject":"公民","publisher":"南一","term":"第一學期","page":5,"additionalPages":[6],"url":"https://www.go100.com.tw/file/108_comparison_table/senior/12-1_comparison_civics_I_114.pdf?v=20250901","table":"南一選修上","method":"structured-text"},"longteng-114-elective-civics-2":{"subject":"公民","publisher":"龍騰","term":"第二學期","page":1,"additionalPages":[],"url":"https://www.go100.com.tw/file/108_comparison_table/senior/12-2_comparison_elective_civics_II_114.pdf?v=20260224","table":"龍騰選修II","method":"page-and-text"},"hanlin-114-elective-civics-2":{"subject":"公民","publisher":"翰林","term":"第二學期","page":2,"additionalPages":[],"url":"https://www.go100.com.tw/file/108_comparison_table/senior/12-2_comparison_elective_civics_II_114.pdf?v=20260224","table":"翰林選修II","method":"structured-text"},"sanmin-114-elective-civics-2":{"subject":"公民","publisher":"三民","term":"第二學期","page":3,"additionalPages":[],"url":"https://www.go100.com.tw/file/108_comparison_table/senior/12-2_comparison_elective_civics_II_114.pdf?v=20260224","table":"三民選修II","method":"structured-text"},"nani-114-elective-civics-2":{"subject":"公民","publisher":"南一","term":"第二學期","page":4,"additionalPages":[],"url":"https://www.go100.com.tw/file/108_comparison_table/senior/12-2_comparison_elective_civics_II_114.pdf?v=20260224","table":"南一選修II","method":"structured-text"}}[book.bookId],e=book.scopeEvidence;
      if(!a||book.grade!=='高中三年級'||book.subject!==a.subject||book.publisher!==a.publisher||book.term!==a.term||book.edition!==a.publisher+'版'||book.schoolYear!==114||book.releaseStatus!=='blocked'||
        book.verificationStatus!==book.scopeSelectionStatus||book.courseType!=='elective'||book.schedulePolicy!=='book-sequence'||book.scopeDetailLevel!=='crosswalk-sections'||
        !/^\d{4}-\d{2}-\d{2}$/.test(book.verifiedAt||'')||e?.kind!=='publisher-crosswalk-transcription'||e.publisher!==a.publisher||e.page!==a.page||e.schoolYear!==114||e.columnPolicy!=='publisher-left-only'||e.reviewMethod!==a.method||e.rawFileHashStatus!=='unavailable')return false;
      return !!book.sources?.some(s=>s.type==='third-party-curriculum-crosswalk'&&s.url===a.url&&s.page===a.page&&JSON.stringify(s.additionalPages||[])===JSON.stringify(a.additionalPages)&&s.schoolYear===114&&s.publisherTable===a.table&&s.reviewMethod===a.method)&&
        !!book.units?.length&&new Set(book.units.map(u=>u.unit)).size===book.units.length&&book.units.every(u=>u.details?.length>0&&u.details.length<=24&&new Set(u.details).size===u.details.length&&Array.isArray(u.concepts)&&u.concepts.length===u.details.length&&u.concepts.every((c,i)=>c.name===u.details[i]&&Array.isArray(c.allowedContent)&&c.allowedContent.length&&Array.isArray(c.excludedContent)));
    }
    if(book.scopeSelectionStatus==='geography-crosswalk-transcription'){
      const p=['龍騰','翰林','南一','三民'].indexOf(book.publisher),e=book.scopeEvidence;
      const vol=book.grade==='高中一年級'?(book.term==='第一學期'?1:book.term==='第二學期'?2:0):book.grade==='高中二年級'&&book.term==='第一學期'?3:0;
      const page=p+1+(vol===3&&p===3?1:0),method=p===0||vol===1&&p===1?'page-and-text':'structured-text';
      const urls=["10-1_comparison_geography_114.pdf?v=20250901","10-2_comparison_geography_114.pdf?v=20260224","11-1_comparison_geography_114.pdf?v=20250901"];
      if(p<0||!vol||book.subject!=='地理'||book.edition!==book.publisher+'版'||book.schoolYear!==114||book.releaseStatus!=='blocked'||
        book.verificationStatus!==book.scopeSelectionStatus||book.courseType!=='required'||book.schedulePolicy!=='book-sequence'||book.scopeDetailLevel!=='crosswalk-sections'||
        !/^\d{4}-\d{2}-\d{2}$/.test(book.verifiedAt||'')||e?.kind!=='publisher-crosswalk-transcription'||e.publisher!==book.publisher||
        e.page!==page||e.schoolYear!==114||e.columnPolicy!=='publisher-left-only'||e.reviewMethod!==method||e.rawFileHashStatus!=='unavailable')return false;
      return !!book.sources?.some(s=>s.type==='third-party-curriculum-crosswalk'&&s.url==='https://www.go100.com.tw/file/108_comparison_table/senior/'+urls[vol-1]&&s.page===page&&s.schoolYear===114&&s.publisherTable===book.publisher+' 地理'+['一上','一下','二上'][vol-1]&&s.reviewMethod===method&&(!(vol===3&&p===2)||JSON.stringify(s.additionalPages)==='[4]'))&&
        !!book.units?.length&&new Set(book.units.map(u=>u.unit)).size===book.units.length&&book.units.every(u=>u.details?.length>0&&u.details.length<=24&&new Set(u.details).size===u.details.length&&
          Array.isArray(u.concepts)&&u.concepts.length===u.details.length&&u.concepts.every((c,i)=>c.name===u.details[i]&&Array.isArray(c.allowedContent)&&c.allowedContent.length&&Array.isArray(c.excludedContent)));
    }
    if(book.scopeSelectionStatus==='social-crosswalk-transcription'){
      const e=book.scopeEvidence, pub=['龍騰','翰林','南一','三民','泰宇','全華'],page=pub.indexOf(book.publisher)+1;
      const vol=book.grade==='高中一年級'?(book.term==='第一學期'?1:book.term==='第二學期'?2:0):book.grade==='高中二年級'&&book.term==='第一學期'?3:0;
      const files=['10-1_comparison_history_114.pdf?v=20250901','10-2_comparison_history_114.pdf?v=20260224','11-1_comparison_history_114.pdf?v=20250901'];
      const method=page===1&&vol>1?'page-and-text':'structured-text';
      if(book.subject!=='歷史'||!vol||!page||(page===6&&vol!==1)||book.edition!==book.publisher+'版'||book.schoolYear!==114||
        book.releaseStatus!=='blocked'||book.verificationStatus!==book.scopeSelectionStatus||book.courseType!=='required'||book.schedulePolicy!=='book-sequence'||
        book.scopeDetailLevel!=='crosswalk-sections'||!/^\d{4}-\d{2}-\d{2}$/.test(book.verifiedAt||'')||
        e?.kind!=='publisher-crosswalk-transcription'||e.publisher!==book.publisher||e.page!==page||e.schoolYear!==114||
        e.columnPolicy!=='publisher-left-only'||e.reviewMethod!==method||e.rawFileHashStatus!=='unavailable')return false;
      return !!book.sources?.some(s=>s.type==='third-party-curriculum-crosswalk'&&s.url==='https://www.go100.com.tw/file/108_comparison_table/senior/'+files[vol-1]&&s.page===page&&s.schoolYear===114&&s.publisherTable===book.publisher+['一上','一下','二上'][vol-1]&&s.reviewMethod===method)&&
        !!book.units?.length&&book.units.every(u=>u.details?.length>0&&u.details.length<=24&&new Set(u.details).size===u.details.length&&
          Array.isArray(u.concepts)&&u.concepts.length===u.details.length&&u.concepts.every((c,i)=>c.name===u.details[i]&&Array.isArray(c.allowedContent)&&c.allowedContent.length&&Array.isArray(c.excludedContent)));
    }
    if(book.scopeSelectionStatus==='grade12-crosswalk-transcription'){
      const e=book.scopeEvidence, track=book.subject==='數學甲'?'甲':book.subject==='數學乙'?'乙':'';
      const variant=book.edition===book.publisher+'版（乙版）';
      if(!track||book.grade!=='高中三年級'||book.schoolYear!==114||book.releaseStatus!=='blocked'||
        book.verificationStatus!==book.scopeSelectionStatus||book.courseType!=='elective'||book.schedulePolicy!=='book-sequence'||
        !['第一學期','第二學期'].includes(book.term)||(!variant&&book.edition!==book.publisher+'版')||(variant&&book.publisher!=='南一')||
        !/^\d{4}-\d{2}-\d{2}$/.test(book.verifiedAt||''))return false;
      const lower=book.term==='第二學期',pages={'龍騰':1,'南一':variant?3:2,'翰林':4,'三民':5,'泰宇':6,'全華':7};
      const page=pages[book.publisher],table=book.publisher+'數學 選修數'+track+'('+(lower?'下':'上')+')'+(variant?'乙版':'');
      const url='https://www.go100.com.tw/file/108_comparison_table/senior/'+(lower?'12-2_comparison_elective_math_II_114.pdf?v=20250221':'12-1_comparison_math_114.pdf?v=20250901');
      if(!page||(book.publisher==='全華'&&track==='乙'&&!lower)||
        e?.kind!=='publisher-crosswalk-transcription'||e.publisher!==book.publisher||e.page!==page||e.schoolYear!==114||
        e.columnPolicy!=='publisher-left-only'||e.rawFileHashStatus!=='unavailable'||e.reviewMethod!=='structured-text'||e.sourceTable!==table||
        book.scopeDetailLevel!==(book.publisher==='龍騰'?'publisher-units-editorial-concepts':'crosswalk-sections'))return false;
      return !!book.sources?.some(s=>s.type==='third-party-curriculum-crosswalk'&&s.url===url&&s.page===page&&s.schoolYear===114&&s.publisherTable===table&&s.reviewMethod==='structured-text')&&
        !!book.units?.length&&book.units.every(u=>u.details?.length>0&&u.details.length<=24&&new Set(u.details).size===u.details.length&&
          Array.isArray(u.concepts)&&u.concepts.length===u.details.length&&u.concepts.every((c,i)=>c.name===u.details[i]&&Array.isArray(c.allowedContent)&&c.allowedContent.length&&Array.isArray(c.excludedContent)));
    }
    if(['elective-crosswalk-transcription','publisher-chapter-outline'].includes(book.scopeSelectionStatus)){
      const e=book.scopeEvidence, grades=['高中二年級','高中三年級'];
      if(!grades.includes(book.grade)||JSON.stringify(book.eligibleGrades)!==JSON.stringify(grades)||
        book.edition!==book.publisher+'版'||book.releaseStatus!=='blocked'||book.verificationStatus!==book.scopeSelectionStatus||
        !/^\d{4}-\d{2}-\d{2}$/.test(book.verifiedAt||'')||book.courseType!=='elective'||book.schedulePolicy!=='school-scheduled'||
        !book.units?.length||!book.units.every(u=>u.details?.length>0&&u.details.length<=24&&new Set(u.details).size===u.details.length&&
          Array.isArray(u.concepts)&&u.concepts.length===u.details.length&&u.concepts.every((c,i)=>c.name===u.details[i]&&Array.isArray(c.allowedContent)&&c.allowedContent.length&&Array.isArray(c.excludedContent))))return false;
      if(book.scopeSelectionStatus==='publisher-chapter-outline'){
        const titles={'選修地球科學－地質與環境':['9853','組成地球的物質','地球的起源與演變','地表與地殼變動','天然災害與防治','永續發展與資源的利用'],
          '選修地球科學－大氣、海洋及天文':['9854','宇宙與天體','地球與太空','天氣與氣候變化','海水的運動','氣候變遷之影響與調適']};
        const match=titles[book.term];
        return !!match&&book.subject==='地球科學'&&book.publisher==='泰宇'&&book.schoolYear===null&&
          e?.kind==='publisher-chapter-index'&&e.publisher===book.publisher&&e.sectionPolicy==='editorial-concepts'&&e.schoolYear===null&&
          book.scopeDetailLevel==='publisher-chapters-editorial-concepts'&&JSON.stringify(book.units.map(u=>u.unit))===JSON.stringify(match.slice(1))&&
          !!book.sources?.some(s=>s.type==='official-chapter-index'&&s.url==='https://digitaiyucoo.com/AR/ebook0111/'+match[0]+'.html');
      }
      const publishers=['龍騰','翰林','南一','泰宇','三民','全華'];
      const urls=['11-1_comparison_elective_biologic_I_114.pdf?v=20250901','11-2_comparison_elective_biologic_II_114.pdf?v=20260224','12-1_comparison_elective_biologic_III_114.pdf?v=20250901','12-2_comparison_elective_biologic_IV_112.pdf?v=20240301'];
      const romans=['I','II','III','IV'], idx=romans.findIndex(r=>book.term==='選修生物'+r),page=publishers.indexOf(book.publisher)+1;
      if(book.subject!=='生物'||idx<0||page<1||book.schoolYear!==(idx===3?112:114)||book.scopeDetailLevel!=='crosswalk-sections'||
        e?.kind!=='publisher-crosswalk-transcription'||e.publisher!==book.publisher||e.schoolYear!==book.schoolYear||e.page!==page||
        e.columnPolicy!=='publisher-left-only'||e.reviewMethod!=='structured-text'||e.rawFileHashStatus!=='unavailable')return false;
      return !!book.sources?.some(s=>s.type==='third-party-curriculum-crosswalk'&&s.schoolYear===book.schoolYear&&s.page===page&&
        s.publisherTable===book.publisher+'選修生物('+romans[idx]+')'&&s.reviewMethod==='structured-text'&&s.url==='https://www.go100.com.tw/file/108_comparison_table/senior/'+urls[idx]);
    }
    if(book.grade !== '高中二年級' || !['數學A','數學B','物理','化學'].includes(book.subject) ||
      !book.verifiedAt || !book.units?.length || !book.units.every(u=>u.details?.length > 0))return false;
    if(book.scopeSelectionStatus === 'verified-toc')return book.verificationStatus === 'verified-complete-toc' &&
      !!book.sources?.some(s=>['official-toc','official-product-toc'].includes(s.type));
    const evidence=book.scopeEvidence;
    return book.scopeSelectionStatus === 'verified-crosswalk' && book.verificationStatus === 'verified-complete-crosswalk' &&
      evidence?.kind === 'publisher-crosswalk' && evidence.publisher === book.publisher &&
      evidence.columnPolicy === 'publisher-left-only' && evidence.schoolYear === book.schoolYear &&
      Number.isInteger(book.schoolYear) && !!book.sources?.some(s=>s.type === 'third-party-curriculum-crosswalk' &&
        /^https:\/\/www\.go100\.com\.tw\/file\/108_(?:comparison_table|version_compare)\/senior\//.test(s.url) &&
        s.schoolYear === book.schoolYear && s.page === evidence.page && Number.isInteger(s.page) && s.page > 0 &&
        String(s.publisherTable||'').startsWith(book.publisher) && /^[0-9a-f]{64}$/.test(s.documentSha256||''));
  }
  function curriculumMetadata(raw) {
    if(raw===undefined)return undefined;
    if(!raw||typeof raw!=='object'||Array.isArray(raw)||
      !['bookId','edition','term'].every(k=>typeof raw[k]==='string'&&raw[k].length>0&&raw[k].length<=100)||
      raw.schoolYear!=null&&(!Number.isInteger(raw.schoolYear)||raw.schoolYear<100||raw.schoolYear>200)||
      !Array.isArray(raw.conceptIds)||raw.conceptIds.length>24||raw.conceptIds.some(id=>typeof id!=='string'||!/^[-a-zA-Z0-9\u3400-\u9fff_]{1,100}$/.test(id)))
      throw Error('教材版本或觀念資料格式有誤。');
    return {bookId:raw.bookId,edition:raw.edition,term:raw.term,schoolYear:raw.schoolYear??null,
      conceptIds:[...new Set(raw.conceptIds)].sort()};
  }
  const key = u => JSON.stringify([u.path, u.detail || '', Array.isArray(u.sub_topics) ? u.sub_topics : [],
    ...(u.curriculum?[curriculumMetadata(u.curriculum)]:[])]);

  function splitChapters(value) {
    const parts = [], stack = [];
    let chunk = '', math = '';
    const flush = () => { const text = chunk.trim(); if (text) parts.push(text); chunk = ''; };
    for (let i = 0; i < value.length; i++) {
      const c = value[i], escaped = value[i - 1] === '\\';
      if (c === '$' && !escaped && !stack.length) {
        const fence = value[i + 1] === '$' ? '$$' : '$';
        if (!math) math = fence; else if (math === fence) math = '';
        chunk += fence; i += fence.length - 1; continue;
      }
      if (!math) {
        if (stack.length && c === stack[stack.length - 1]) stack.pop();
        else if (brackets.has(c) && (!escaped || ['(','[','{'].includes(c))) stack.push(brackets.get(c));
      }
      const slash = /[\/／]/.test(c) && (
        /\s/.test(value[i - 1] || '') && /\s/.test(value[i + 1] || '') ||
        /[\u3400-\u9fff]{2}$/.test(chunk) && /^[\u3400-\u9fff]{2}/.test(value.slice(i + 1))
      );
      if (!math && !stack.length && (/[、,，;；\n\r|｜。]/.test(c) || slash)) flush();
      else chunk += c;
    }
    flush();
    return parts;
  }

  function parseChapters(value) {
    const text = String(value || '').trim();
    if (!text) return { ok:false, message:'請先輸入想練習的範圍。' };
    if (text.length > MAX_INPUT) return { ok:false, message:'一次輸入最多 2400 字，請分批加入。' };
    const parts = splitChapters(text), details = [...new Set(parts)];
    if (!details.length) return { ok:false, message:'請輸入章節或考點，不能只有分隔符號。' };
    if (details.some(detail => detail.length > MAX_DETAIL)) return { ok:false, message:'每個自訂範圍最多 90 字，請精簡或用頓號、分號分開。' };
    return { ok:true, details, count:parts.length, duplicates:parts.length - details.length };
  }

  // Never partially apply a batch: a full cart must retain every old entry.
  function mergeSelection(existing, incoming) {
    const units = [], seen = new Set();
    let added = 0;
    for (const [list, isNew] of [[existing, false], [incoming, true]]) {
      for (const unit of list) {
        if (String(unit?.path || '').split('/')[0] === '資訊科技') continue; // retired range
        const id = key(unit);
        if (seen.has(id)) continue;
        seen.add(id); units.push(unit); if (isNew) added++;
      }
    }
    if (units.length > MAX_UNITS) return { ok:false, required:units.length,
      message:'整理後共需 ' + units.length + ' 個範圍，超過 24 項上限；原清單已保留，請先移除其他項目。' };
    return { ok:true, units, added };
  }

  function organizeSelection(list) {
    const expanded = [];
    let split = 0, internalDuplicates = 0;
    for (const unit of list) {
      // Catalog chapter titles and their subtopics are structured data. Only
      // custom text can represent a pasted list of independent chapters.
      if (!String(unit.path || '').split('/').includes('自訂') || !unit.detail) {
        expanded.push(unit); continue;
      }
      const parsed = parseChapters(unit.detail);
      if (!parsed.ok) return parsed;
      if (parsed.count > 1) split++;
      internalDuplicates += parsed.duplicates;
      for (const detail of parsed.details) expanded.push({ ...unit, detail });
    }
    const result = mergeSelection([], expanded);
    if (!result.ok) return result;
    return { ...result, split, duplicates:internalDuplicates + expanded.length - result.units.length,
      changed:JSON.stringify(list) !== JSON.stringify(result.units) };
  }

  function validateUnits(raw) {
    if (!Array.isArray(raw) || !raw.length || raw.length > MAX_UNITS) throw Error('清單必須包含 1～24 個範圍。');
    return raw.map(unit => {
      if (!unit || typeof unit !== 'object' || Array.isArray(unit) || typeof unit.path !== 'string' ||
        !unit.path.trim() || unit.path.length > 240 || !subjects.has(unit.path.split('/')[0]) ||
        unit.detail !== undefined && (typeof unit.detail !== 'string' || unit.detail.length > 200) ||
        unit.sub_topics !== undefined && (!Array.isArray(unit.sub_topics) || unit.sub_topics.length > 24 ||
        unit.sub_topics.some(v => typeof v !== 'string' || v.length > 200))) throw Error('清單中有無法辨識的範圍，請重新複製完整分享內容。');
      return { path:unit.path.trim(), detail:(unit.detail || '').trim(), sub_topics:(unit.sub_topics || []).map(v => v.trim()),
        ...(unit.curriculum!==undefined?{curriculum:curriculumMetadata(unit.curriculum)}:{}) };
    });
  }

  function shareSelection(list) {
    try {
      const units = validateUnits(list);
      const code = JSON.stringify({ schema:SCHEMA, version:units.some(u=>u.curriculum)?2:1, units });
      const lines = units.map((u,i) => (i + 1) + '. ' + u.path.replace(/\//g,'／') + '：' + (u.detail || '全部'));
      const text = '青雲問道｜已選修習清單（' + units.length + ' 項）\n' + lines.join('\n') + '\n\n在課程研修所的「匯入清單」貼上以下內容。\n分享碼：\n' + code;
      if (text.length > MAX_SHARE) throw Error('清單內容太長，請減少範圍後再分享。');
      return { ok:true, text, code };
    } catch (error) { return { ok:false, message:error.message }; }
  }

  function readSharedSelection(value) {
    try {
      const text = String(value || '').trim().replace(/\r\n/g,'\n');
      if (!text || text.length > MAX_SHARE) throw Error('請貼上完整的清單分享內容（最多 64000 字）。');
      // Accept either just the code or the full human-readable shared message.
      const marker = '分享碼：\n', start = text.lastIndexOf(marker);
      const data = JSON.parse(start < 0 ? text : text.slice(start + marker.length));
      if (!data || typeof data !== 'object' || Array.isArray(data) || data.schema !== SCHEMA ||
        ![1,2].includes(data.version)||data.version===2&&(!Array.isArray(data.units)||!data.units.some(u=>u?.curriculum))) throw Error('這不是支援的青雲問道清單分享碼。');
      const units = validateUnits(data.units);
      return organizeSelection(units);
    } catch (error) { return { ok:false, message:error instanceof SyntaxError ? '分享碼不完整或格式有誤，請重新複製。' : error.message }; }
  }

  function validateShareTitle(value) {
    if (value != null && typeof value !== 'string') return { ok:false, message:'請輸入清單標題。' };
    const title = (value || '').trim();
    const length = typeof Intl.Segmenter === 'function'
      ? Array.from(new Intl.Segmenter('zh-Hant', { granularity:'grapheme' }).segment(title)).length
      : Array.from(title).length;
    if (length > 20 || /[\u0000-\u001f\u007f]/.test(title)) return { ok:false, length, message:'清單標題最多 20 字，請使用單行文字。' };
    return { ok:true, length, title:title || '我的修習清單' };
  }

  function createChatShare(list, value) {
    const title = validateShareTitle(value);
    if (!title.ok) return title;
    const shared = shareSelection(list);
    if (!shared.ok) return shared;
    return { ok:true, message:{ type:'curriculum-share', scopeTitle:title.title,
      scopeCode:shared.code, text:'分享了修習清單' } };
  }

  function readChatShare(message) {
    if (message?.type !== 'curriculum-share') return { ok:false, message:'這不是修習清單。' };
    const title = validateShareTitle(message.scopeTitle);
    if (!title.ok) return title;
    const parsed = readSharedSelection(message.scopeCode);
    return parsed.ok ? { ...parsed, title:title.title } : parsed;
  }

  return { parseChapters, mergeSelection, organizeSelection, shareSelection, readSharedSelection, curriculumMetadata, selectableBook,
    validateShareTitle, createChatShare, readChatShare };
});
