// 暗記カード：記録（できごとの列）から、カードごとの成績を出す。画面には触らない。node でも読める。
//
// できごとの形：
//   {type:'answer', card, d:'YYYY-MM-DD', t, result:'o'|'x', mode, sec?, found?, miss?, giveup?, judge?}
//     sec：思い出すのにかかった秒数（180秒を超えたら付けない）。打ち込み型（タイピングゲーム型）のとき：
//     found は見つけた項目の番号（0から、見つけた順）、miss は打ちまちがいの回数、giveup は「わからない」を押した、
//     judge はアプリの判定（'auto'）か「合ってた」を押した（'self'）か。
//     2026-11-26 の前の版（答えの欄に打って答え合わせ）の記録には typed（打った答え）がある
//   {type:'flag', card, d, t, on:true|false, memo}
// 1日の記録は「○ が付くまでに × を押した回数」。その日 ○ が付いたら、そのあとの答えは数えない。

const RECENT_DAYS = 3; // 最近の何日ぶんで並べるか

function replay(cards, events) {
  const st = {};
  for (const c of cards) st[c.id] = { days: {}, flag: false, memo: '' };
  const sorted = events.slice().sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  for (const e of sorted) {
    const s = st[e.card];
    if (!s) continue; // カードが消えた記録は読み飛ばす
    if (e.type === 'flag') { s.flag = !!e.on; s.memo = e.memo || ''; }
    else if (e.type === 'answer') {
      const day = s.days[e.d] || (s.days[e.d] = { x: 0, o: false });
      if (day.o) continue;
      if (e.result === 'o') day.o = true; else day.x += 1;
    }
  }
  for (const id in st) {
    const s = st[id];
    s.history = Object.keys(s.days).sort().reverse().map(d => ({ d, x: s.days[d].x, o: s.days[d].o }));
    s.recent = s.history.slice(0, RECENT_DAYS);
    s.score = s.recent.reduce((n, r) => n + r.x, 0);
    s.last = s.history.length ? s.history[0].d : null;
    s.solved = s.history.length > 0;
  }
  return st;
}

// 要注意の順：最近3日の × の合計が多い順 → 同じなら最後に解いた日が新しい順。まだ解いていないカードは最後
function byAttention(st) {
  return (a, b) => {
    const A = st[a.id], B = st[b.id];
    if (A.solved !== B.solved) return A.solved ? -1 : 1;
    if (B.score !== A.score) return B.score - A.score;
    if (A.last !== B.last) return A.last < B.last ? 1 : -1;
    return 0;
  };
}

if (typeof module !== 'undefined') module.exports = { RECENT_DAYS, replay, byAttention };
