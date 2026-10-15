const { shuffle } = require('./utils/shuffle');

// Specific events precede broad settings; repeated incidental words get no extra weight.
const themes = [
  { pattern: /タイムリープ|同じ(?:一)?日を(?:繰り返|何度|生き直)|今日を(?:繰り返|やり直)|一日を繰り返|時間のループ/u,
    englishTitles: ['Another Morning', 'Until Tomorrow', 'Daybreak Again', 'Yesterday Returns', 'The Unending Day', 'Once More Today', 'After the Loop'], titles: [
    '今日から抜け出せない', '何度目かの朝に', '明日が来るまで', '繰り返す一日の出口',
    'やり直しの先で待っている', '終わらない今日を越えて', '二度目の今日を生きる',
  ] },
  { pattern: /時間旅行|タイムトラベル|過去に戻|未来から|時を越|時空を/u,
    englishTitles: ['Tomorrow Remembers', 'Across Yesterday', 'Timeward', 'The Unwritten Future', 'Before We Meet', 'Borrowed Time', 'A Different Past'], titles: [
    '昨日に置いてきた約束', 'まだ来ない明日へ', 'あの日をやり直せたなら',
    '未来からの忘れもの', '過去からの帰り道', '時間を越えて会いに行く', '明日の記憶をたどって',
  ] },
  { pattern: /誘拐|拉致|人質|身代金/u,
    englishTitles: ['Bring Them Home', 'Missing Hours', 'Ransom', 'The Last Call', 'Taken Away', 'Until You Return', 'Someone Is Waiting'], titles: [
    '返してほしいのは、あの日', '帰ってこないあなたを待つ', '奪われた日常',
    '取り戻すまで終われない', '無事だと言ってほしい', '帰りを待つ人がいる', 'あなたを連れて帰る',
  ] },
  { pattern: /情報を統制|情報統制|歴史を書き換|独裁|全体主義|体制に抗|検閲/u,
    englishTitles: ['Unwritten', 'The Approved Truth', 'Silent Citizens', 'Words Forbidden', 'The Other Record', 'Nothing to Declare', 'History Erased'], titles: [
    '正しい嘘のつくり方', '消された昨日', '真実を選ぶのは誰', '沈黙する自由',
    '書き換えられた世界で', '従わない者の記録', 'その言葉は誰のもの',
  ] },
  { pattern: /裁判|訴訟|弁護士|法廷|冤罪|裁判官|検察|法律|条項|執行/u,
    englishTitles: ['Final Verdict', 'The Last Clause', 'Witness', 'Beyond Justice', 'The Unwritten Law', 'Under Judgment', 'Sentence Pending'], titles: [
    '法廷で語られなかったこと', '証言台の向こう側', '判決のあとに残るもの',
    '沈黙を破る日', '正しさだけでは救えない', '名前のない訴え', '最後の弁護',
  ] },
  { pattern: /記憶喪失|記憶を失|記憶がな|記憶をなく|記憶を取り戻|思い出せない/u,
    englishTitles: ['Unremembered', 'Someone I Was', 'A Name Forgotten', 'Missing Yesterday', 'Before I Woke', 'The Familiar Stranger', 'Fragments of Me'], titles: [
    '知らない自分に会いに行く', '記憶のない朝', '思い出せない約束', '誰かが覚えている',
    '失われた昨日を探して', '名前を思い出すその日まで', '忘れた私を見つけて',
  ] },
  { pattern: /幽霊|怪異|亡霊|呪い|悪霊|心霊|怪談/u,
    englishTitles: ['Still Here', 'Unseen Footsteps', 'The Empty Room', 'Behind You', 'Never Alone', 'Haunted', 'Someone Within'], titles: [
    'そこにいるのは誰', '気づいてはいけなかった', '誰もいないはずだった',
    'まだ、そこにいる', '見えないものが見ている', 'ひとりではなかった', '振り返らないで',
  ] },
  { pattern: /脱出|閉じ込め|囚われ|監禁|捕獲|追われる|逃げ延び/u,
    englishTitles: ['No Way Out', 'Breakaway', 'The Last Exit', 'Outside Again', 'Until We Escape', 'Beyond the Walls', 'Run Before Dawn'], titles: [
    'ここから生きて帰る', '出口を探す者たち', '脱出までの長い夜', '逃げ切るまで終われない',
    '自由まであと一歩', '外の世界をもう一度', 'ここには留まれない',
  ] },
  { pattern: /迷宮|ダンジョン|神器|地下.{0,12}探索/u,
    englishTitles: ['Below', 'Vanishing Paths', 'The Last Descent', 'Into the Depths', 'No Turning Back', 'Relicbound', 'Downward'], titles: [
    '深淵への道', '消えゆく迷宮', '最後の下降', '地下に眠るもの', 'もう戻れない', '神器をたどる者', '底のない世界',
  ] },
  { pattern: /滅亡|世界を救|崩壊|大災害|人類の危機|世界の終わり/u,
    englishTitles: ['Before the End', 'Afterfall', 'The Final Dawn', 'A World Remaining', 'Borrowed Tomorrow', 'Nothing Left Behind', 'Save the Morning'], titles: [
    '世界が終わる前に', '崩れゆく明日を止めて', '最後の朝を迎えるために',
    '終わりを告げる鐘', '残された時間を数えて', '夜明けを取り戻せ', 'それでも世界を諦めない',
  ] },
  { pattern: /復讐|仇を|仇討|報復|婚約破棄|搾取/u,
    englishTitles: ['Unforgiven', 'The Debt Remains', 'After Revenge', 'A Price to Pay', 'Until It Ends', 'What Was Taken', 'No Way to Forget'], titles: [
    '許せないまま生きている', '復讐のあとに残るもの', '忘れるには遅すぎる',
    '奪われたものの代価', 'あの日を終わらせるために', '許しのない帰り道', '決着がつくその日まで',
  ] },
  { pattern: /強盗|盗賊|盗み|盗ま|盗む|侵入|暗殺|殺し屋|裏社会/u,
    englishTitles: ['The Last Job', 'Double Cross', 'Stolen Night', 'No Clean Exit', 'Underhand', 'A Dangerous Bargain', 'Nothing to Lose'], titles: [
    'その仕事には裏がある', '誰にも渡せないもの', '闇の取引が終わるまで', '盗まれた夜',
    '帰れない仕事', '裏切りの代価', '危険な仕事の終わらせ方',
  ] },
  { pattern: /殺人|捜査|探偵|刑事|犯人|遺体|アリバイ|失踪|事件を解/u,
    englishTitles: ['False Witness', 'After Midnight', 'Untraced', 'The Silent Alibi', 'Missing Evidence', 'Until the Truth', 'Footsteps Gone'], titles: [
    '証言のない夜', '消えた足音を追って', '偽りの供述', 'その事件には続きがある',
    '夜明けまでのアリバイ', '沈黙が残した証拠', '真相を知るまでは',
  ] },
  { pattern: /戦争|戦場|兵士|軍隊|侵略|戦線|戦地|戦火|出征|敗戦/u,
    englishTitles: ['Before the Ceasefire', 'Homeward', 'The Silent Front', 'Letters from Battle', 'Those Who Remain', 'After the Guns', 'No Soldiers in Spring'], titles: [
    '停戦までの長い夜', '故郷へ戻るために', '戦場に残した約束', '銃声の向こうに朝が来る',
    '帰らなかった人たちへ', '兵士のいない春', '終わらない戦争のあとで',
  ] },
  { pattern: /死別|亡くな|葬儀|遺品|余命|看取り|(?:母|父|妻|夫|友人)の死/u,
    englishTitles: ['After Goodbye', 'Still Remembering', 'The Empty Chair', 'Days Without You', 'What Remains', 'Unanswered', 'A Season Apart'], titles: [
    'あなたのいない季節', 'さよならのあとに残るもの', 'もう会えない人へ',
    '別れを抱いて生きる', '名前を呼んでも返らない', 'いなくなった人の部屋', '残された日々を歩く',
  ] },
  { pattern: /大会|試合|優勝|競技|アスリート|野球|サッカー|陸上|水泳/u,
    englishTitles: ['The Last Second', 'Overtake', 'Beyond Defeat', 'One More Match', 'A Reason to Win', 'Still in the Race', 'Until the Finish'], titles: [
    '最後の一秒まで', '勝ちたい理由がある', '負けたままでは終われない',
    '昨日の自分を越えて', '夢はまだ途中', 'ここからが勝負', 'もう一度、挑むために',
  ] },
  { pattern: /音楽|演奏|吹奏楽|合唱|バンド|作曲|ピアノ|楽器/u,
    englishTitles: ['Resonance', 'The Last Note', 'Until You Hear', 'Our Unfinished Song', 'Echoes Remain', 'Playing Together', 'After the Silence'], titles: [
    'まだ鳴りやまない', '音を重ねる日々', '届くまで、奏でる', 'あの日の音が聞こえる',
    '響きの向こうに', '最後の音を忘れない', '私たちの音になるまで',
  ] },
  { pattern: /農場|農園|畑|収穫|牧場|作物/u,
    englishTitles: ['After the Harvest', 'Rooted', 'A Place to Grow', 'The Small Field', 'Seeds of Tomorrow', 'Living on the Land', 'Until Spring Comes'], titles: [
    '種をまく日々', '実りを待つ時間', 'この土地で暮らしていく', '土とともに生きる',
    '小さな畑から', '次の収穫まで', '育てる暮らし',
  ] },
  { pattern: /再建|復興|街をつく|町をつく|都市を建設|街を建設|町を建設/u,
    englishTitles: ['Rebuild', 'A City Again', 'Where We Begin', 'The Returning Lights', 'Foundations', 'Tomorrow Lives Here', 'Streets of Our Own'], titles: [
    'この街をもう一度', '明日の街をつくる', 'ここから立て直そう', '暮らしが戻るまで',
    'はじまりの街づくり', '未来のための場所', '小さな街の大きな一歩',
  ] },
  { pattern: /パズル|謎解き|仕掛けを解|謎を解/u,
    englishTitles: ['Unsolved', 'The Missing Piece', 'One More Clue', 'Beyond the Riddle', 'Almost an Answer', 'Hidden in Plain Sight', 'A Different Solution'], titles: [
    'ひらめきの先へ', '答えはすぐそこに', '解けないままでは終われない', '最後の手がかり',
    '隠された答えを探して', 'ひとつずつ、解き明かす', 'まだ解けていない',
  ] },
  { pattern: /人工知能|アンドロイド|ロボット/u,
    englishTitles: ['Becoming Human', 'Heartware', 'The Other Mind', 'Made to Feel', 'Someone Artificial', 'Between Us', 'A Heart Unwritten'], titles: [
    '人間になるための時間', '心を持つということ', '機械仕掛けのとなり人',
    'わたしは何者なのか', 'つくられた者たち', '心のありかを探して', '人と機械のあいだで',
  ] },
  { pattern: /恋人|恋愛|初恋|片思い|恋|愛情|結婚|婚約/u,
    englishTitles: ['Almost Together', 'Unspoken', 'A Season with You', 'The Distance Between', 'Until We Meet', 'Someone Beside Me', 'Before I Tell You'], titles: [
    'あなたと過ごした季節', 'ふたりの距離を測る', '愛を告げないままで', '君を待つ街角',
    'となりにいてほしい', '好きだと言えたなら', 'ふたりになるまで',
  ] },
  { pattern: /手紙|便り|封筒|差出人|宛先|郵便|文通/u,
    englishTitles: ['Unsigned', 'The Last Letter', 'Return to Sender', 'A Promise Undelivered', 'The Waiting Postbox', 'Words for You', 'Before the Reply'], titles: [
    '返事のない手紙', '差出人を探す旅', '届かなかった約束', '最後の便りが届くまで',
    '宛先は、あの日の君', 'まだ読めない一通', 'ポストの向こうで待つ人',
  ] },
  { pattern: /家族|親子|兄弟|姉妹|夫婦|子育て|育児|シングルマザー/u,
    englishTitles: ['Home Again', 'Kinship', 'The Family Table', 'Under One Roof', 'A Place to Return', 'Things We Never Said', 'Growing Apart'], titles: [
    '家族になるまでの時間', 'おかえりを言うために', '同じ家で、違う明日を',
    '家族に話せないこと', '遠くにいても家族', '帰る場所を探して', '食卓を囲む人たち',
  ] },
  { pattern: /宇宙船|宇宙|惑星|銀河|星間/u,
    englishTitles: ['Far from Earth', 'Starbound', 'The Return Signal', 'Across the Galaxy', 'A Ship Called Home', 'The Waiting Planet', 'Beyond Our Orbit'], titles: [
    '帰還船を待つ星', '故郷はまだ遠い', '星間航路の忘れもの', '地球への最後の通信',
    '帰り道は銀河の向こう', '星を渡る約束', '宇宙の果てで灯りをともす',
  ] },
  { pattern: /魔法|魔術|異世界|勇者|魔王|妖精|竜/u,
    englishTitles: ['Beyond the Veil', 'Spellbound', 'The Other Realm', 'An Unfamiliar Power', 'Before the Magic Fades', 'Through the Boundary', 'A World Unseen'], titles: [
    '不思議な世界の歩き方', 'まだ知らない力がある', '魔法がほどける、その前に',
    'こちら側にはない世界', 'あの世界への道しるべ', '境界の向こうで待っている', 'ありえない日々の始まり',
  ] },
  { pattern: /学校|教室|高校|中学|部活|卒業|放課後|夏休み|同級生/u,
    englishTitles: ['After School', 'Before Graduation', 'The Long Summer', 'Classmates', 'A Promise in Spring', 'Through the Classroom Window', 'Our Unfinished Days'], titles: [
    '放課後の約束', '卒業までに伝えたいこと', '遠回りの夏休み', '制服を脱ぐ日まで',
    '校庭に残した夢', '春が来る前に', '教室の窓から見た明日',
  ] },
  { pattern: /仕事|職場|会社|商店|喫茶店|店主|閉店|商店街|銀行員|預金|融資|転勤|経営/u,
    englishTitles: ['Another Working Day', 'The Corner Shop', 'Overtime', 'A Job Worth Doing', 'Beyond the Counter', 'Starting Again', 'Tomorrow We Open'], titles: [
    '働く街の片隅で', '明日の仕事を探して', 'はじめての仕事',
    'いつもの街で会いましょう', '日々の続きをつくる', '仕事の先にある暮らし', '明日もここで働く',
  ] },
  { pattern: /旅|列車|鉄道|放浪|見知らぬ町/u,
    englishTitles: ['Wayfarer', 'The Long Way Home', 'A Town Unknown', 'One Way Ticket', 'Where the Road Ends', 'Beyond the Map', 'Before the Next Train'], titles: [
    '知らない町で朝を待つ', '帰り道をなくした日', '地図にはない目的地',
    '旅の終わりに会う人', '遠い町への片道切符', '故郷までの長い道', 'ここから、遠くへ',
  ] },
];
const fallbackTitles = [
  'まだ知らない景色', '日々の続きをつくる', '明日を迎えるために', 'あの日から、ここまで',
  '小さな世界の片隅で', 'それぞれの歩幅で', 'ここから始まる日々',
];

// shortcut: select authored titles by story cues; unrestricted story-specific writing needs a language model.
function generateComputerTitles(synopsis, count, { realTitle = '', excludedTitles = [], usedTitles = [] } = {}) {
  if (!count) return [];
  const story = synopsis.split(/(?<=[。!?！？])|\n/u).filter(sentence =>
    !/メガホン|主演を|共演|らが出演|『[^』]*』など.{0,80}演じ/u.test(sentence))
    .join('').replace(/『[^』]*』/gu, '')
    .replace(/[^。!?！？]*?(?:映画|ドラマ|小説|漫画|本|ゲーム)を(?:観た|見た|読んだ|遊んだ)/gu, '');
  const english = /\p{Script=Latin}/u.test(realTitle) && !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(realTitle);
  const matching = themes.filter(({ pattern }) => pattern.test(story));
  const pools = matching.length ? matching.map(theme => english ? theme.englishTitles : theme.titles) :
    [english ? ['Another Horizon', 'Unfinished', 'The Quiet Days', 'A World Apart', 'Starting Here', 'Beyond Tomorrow', 'The Way Ahead'] : fallbackTitles];
  const key = title => title.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
  const excluded = new Set([realTitle, ...excludedTitles].filter(Boolean).map(key));
  const used = new Set(usedTitles.map(key));
  const selected = [], seen = new Set([...excluded, ...used]);
  for (const pool of pools) for (const title of shuffle(pool)) {
    if (!seen.has(key(title))) { selected.push(title); seen.add(key(title)); }
  }
  // shortcut: authored pools are finite; the caller must reselect a verified
  // work when there are too few unused candidates, never recycle past answers.
  return selected.slice(0, count);
}

module.exports = { generateComputerTitles };
