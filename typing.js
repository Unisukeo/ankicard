// 暗記カード：打ち込み型（タイピングゲーム型。2026-11-26〜）
//   ローマ字 → ひらがな、1文字打つたびに「まだ見つけていない答えのどれかの頭と合っているか」を見る。
//   画面には触らない。node でも読める（試すとき）。
//
// カードの形：items[] の全部に yomi（その項目の答えの読み。ひらがな。言いかえも並べられる）があると、
//   そのカードは打ち込み型で出る。どの項目から打ってもよい。読みを打ち終えたら、その項目を見つけたことになる。
//   合わない字はブッで入らず、ミスに数える。ミスが MISS_MAX 回を超えたら ×。
//   読みが、ほかの項目の読みの頭と同じとき（りこう／りこうのせいきゅう）は、次の答えを打ち始めるか「確定」で決まる。
//   同じ項目の中の長い読み（5ねん／5ねんかん）は、短いほうで見つけたことにして、続けて打った残りは受け流す。

const ROMA = (() => {
  const t = {
    a: 'あ', i: 'い', u: 'う', e: 'え', o: 'お',
    ka: 'か', ki: 'き', ku: 'く', ke: 'け', ko: 'こ',
    sa: 'さ', si: 'し', shi: 'し', su: 'す', se: 'せ', so: 'そ',
    ta: 'た', ti: 'ち', chi: 'ち', tu: 'つ', tsu: 'つ', te: 'て', to: 'と',
    na: 'な', ni: 'に', nu: 'ぬ', ne: 'ね', no: 'の',
    ha: 'は', hi: 'ひ', hu: 'ふ', fu: 'ふ', he: 'へ', ho: 'ほ',
    ma: 'ま', mi: 'み', mu: 'む', me: 'め', mo: 'も',
    ya: 'や', yu: 'ゆ', yo: 'よ',
    ra: 'ら', ri: 'り', ru: 'る', re: 'れ', ro: 'ろ',
    wa: 'わ', wo: 'を', nn: 'ん', "n'": 'ん', xn: 'ん',
    ga: 'が', gi: 'ぎ', gu: 'ぐ', ge: 'げ', go: 'ご',
    za: 'ざ', zi: 'じ', ji: 'じ', zu: 'ず', ze: 'ぜ', zo: 'ぞ',
    da: 'だ', di: 'ぢ', du: 'づ', de: 'で', do: 'ど',
    ba: 'ば', bi: 'び', bu: 'ぶ', be: 'べ', bo: 'ぼ',
    pa: 'ぱ', pi: 'ぴ', pu: 'ぷ', pe: 'ぺ', po: 'ぽ',
    xa: 'ぁ', xi: 'ぃ', xu: 'ぅ', xe: 'ぇ', xo: 'ぉ', la: 'ぁ', li: 'ぃ', lu: 'ぅ', le: 'ぇ', lo: 'ぉ',
    xya: 'ゃ', xyu: 'ゅ', xyo: 'ょ', lya: 'ゃ', lyu: 'ゅ', lyo: 'ょ', xtu: 'っ', ltu: 'っ', xtsu: 'っ', xwa: 'ゎ',
    sha: 'しゃ', shu: 'しゅ', she: 'しぇ', sho: 'しょ',
    cha: 'ちゃ', chu: 'ちゅ', che: 'ちぇ', cho: 'ちょ',
    ja: 'じゃ', ju: 'じゅ', je: 'じぇ', jo: 'じょ',
    fa: 'ふぁ', fi: 'ふぃ', fe: 'ふぇ', fo: 'ふぉ',
    tsa: 'つぁ', thi: 'てぃ', dhi: 'でぃ', whi: 'うぃ', we: 'うぇ', wi: 'うぃ', vu: 'ゔ',
  };
  // 拗音：kya・sya・tya・nya・hya・mya・rya・gya・zya・jya・dya・bya・pya
  const y = { k: 'き', s: 'し', t: 'ち', c: 'ち', n: 'に', h: 'ひ', m: 'み', r: 'り', g: 'ぎ', z: 'じ', j: 'じ', d: 'ぢ', b: 'び', p: 'ぴ' };
  for (const [c, k] of Object.entries(y)) {
    t[c + 'ya'] = k + 'ゃ'; t[c + 'yu'] = k + 'ゅ'; t[c + 'yo'] = k + 'ょ'; t[c + 'ye'] = k + 'ぇ'; t[c + 'yi'] = k + 'ぃ';
  }
  return t;
})();
const ROMA_PREFIX = (() => {
  const s = new Set();
  for (const k of Object.keys(ROMA)) for (let i = 1; i <= k.length; i++) s.add(k.slice(0, i));
  return s;
})();

// 1文字打つ：{ kana, buf } → { kana, buf }。buf はまだかなになっていないローマ字
function feedRoma(kana, buf, ch) {
  ch = ch.toLowerCase();
  if (ch === '-') return { kana: flushRoma(kana, buf) + 'ー', buf: '' };
  if (/[0-9]/.test(ch)) return { kana: flushRoma(kana, buf) + ch, buf: '' };
  buf += ch;
  for (;;) {
    if (!buf) break;
    // "n" だけは次の字を見てから決める（na・nya・nn のため）。ほかは表にあればすぐかなにする
    if (ROMA[buf] && buf !== 'n') { kana += ROMA[buf]; buf = ''; break; }
    if (ROMA_PREFIX.has(buf)) break; // まだ続きがある
    // 子音が2つ重なった（kka・tta）：っ
    if (buf.length >= 2 && buf[0] === buf[1] && !'aiueon'.includes(buf[0])) { kana += 'っ'; buf = buf.slice(1); continue; }
    // n のあとに子音：ん
    if (buf[0] === 'n' && buf.length >= 2 && !'aiueoy'.includes(buf[1])) { kana += 'ん'; buf = buf.slice(1); continue; }
    // かなにならない字：そのまま捨てる
    buf = buf.slice(1);
  }
  return { kana, buf };
}
// 区切り（次の答えへ・答え合わせ）で、残ったローマ字を始末する
function flushRoma(kana, buf) { return kana + (buf === 'n' ? 'ん' : ''); }

// 比べる前にそろえる：全角→半角、カタカナ→ひらがな、空白や記号を外す
function normKana(s) {
  return String(s || '').normalize('NFKC')
    .replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s、。，．,.・「」『』（）()［］\[\]〔〕:：;；!！?？'"]/g, '');
}
const MISS_MAX = 3; // カード1枚で、打ちまちがいはここまで。超えたら ×

const ROMA_LIST = Object.entries(ROMA);
// 読み r が、打ったかな kana と、まだかなになっていないローマ字 buf の続きとしてありうるか
function prefixValid(r, kana, buf) {
  if (!r.startsWith(kana)) return false;
  const rest = r.slice(kana.length);
  if (!buf) return true;
  if (!rest) return false;
  for (const [k, v] of ROMA_LIST) if (k.startsWith(buf) && rest.startsWith(v)) return true;
  // っ を子音の重ねで打つ途中（kka の k）
  if (buf.length === 1 && rest[0] === 'っ' && rest.length > 1 && /[bcdfghjkmpqrstvwxyz]/.test(buf)) return prefixValid(r, kana + 'っ', buf);
  return false;
}
function typeable(card) { return !!(card.items && card.items.length && card.items.every(it => Array.isArray(it.yomi) && it.yomi.length)); }

// 1枚ぶんのゲームの状態
function newGame(card) {
  return {
    yomi: card.items.map(it => it.yomi.map(normKana).filter(Boolean)),
    found: card.items.map(() => false), order: [], kana: '', buf: '', miss: 0, swallowN: false, tail: null,
  };
}
// まだ見つけていない項目の読み：[{ j, r }]
function openYomi(g) { const a = []; g.yomi.forEach((ys, j) => { if (!g.found[j]) ys.forEach(r => a.push({ j, r })); }); return a; }
const anyValid = (g, kana, buf) => openYomi(g).some(o => prefixValid(o.r, kana, buf));
// 今打っているものが、ちょうど読みの1つになっているか（n の打ちかけは ん とみる）
function exactHit(g, kana, buf) {
  const t = flushRoma(kana, buf);
  if (buf && buf !== 'n') return null;
  return openYomi(g).find(o => o.r === t) || null;
}
// 見つけた。同じ項目のもっと長い読み（5ねん／5ねんかん）の残りは、続けて打っても受け流す（g.tail）
function take(g, j, viaN) {
  const t = flushRoma(g.kana, g.buf);
  const rest = g.yomi[j].filter(r => r.length > t.length && r.startsWith(t)).map(r => r.slice(t.length));
  g.found[j] = true; g.order.push(j); g.kana = ''; g.buf = ''; g.swallowN = !!viaN;
  g.tail = rest.length ? { list: rest, kana: '', buf: '' } : null;
}
const done = g => g.found.every(Boolean);
const lost = g => g.miss > MISS_MAX;

// 1文字打つ。返すのは起きたことの配列：{ ev: 'ok' } ／ { ev: 'miss' } ／ { ev: 'found', j }
function press(g, ch) {
  ch = String(ch).toLowerCase();
  if (g.swallowN) { g.swallowN = false; if (ch === 'n') return [{ ev: 'ok' }]; } // 「ん」を nn と打った2つ目
  if (g.tail) {
    const T = g.tail, c = feedRoma(T.kana, T.buf, ch);
    if ((c.kana !== T.kana || c.buf !== T.buf) && T.list.some(t => prefixValid(t, c.kana, c.buf))) {
      T.kana = c.kana; T.buf = c.buf;
      if (!c.buf && !T.list.some(t => t !== c.kana && t.startsWith(c.kana))) g.tail = null; // 打ち終えた
      return [{ ev: 'ok' }];
    }
    g.tail = null;
  }
  const c = feedRoma(g.kana, g.buf, ch);
  const moved = c.kana !== g.kana || c.buf !== g.buf;
  if (moved && anyValid(g, c.kana, c.buf)) {
    g.kana = c.kana; g.buf = c.buf;
    const hit = exactHit(g, c.kana, c.buf);
    // ほかの項目に続きのある読みがなければ、ここで見つけたことにする
    if (hit && !openYomi(g).some(o => o.j !== hit.j && o.r !== hit.r && prefixValid(o.r, c.kana, c.buf))) {
      take(g, hit.j, c.buf === 'n');
      return [{ ev: 'found', j: hit.j }];
    }
    return [{ ev: 'ok' }];
  }
  // 合わない字。今までのぶんがちょうど読みなら、それを見つけたことにして、この字を次の答えの頭として打ち直す
  const hit = (g.kana || g.buf) && exactHit(g, g.kana, g.buf);
  if (hit) { take(g, hit.j, false); return [{ ev: 'found', j: hit.j }, ...(done(g) ? [] : press(g, ch))]; }
  g.miss++;
  return [{ ev: 'miss' }];
}
// 確定（スペース）：今までのぶんがちょうど読みなら見つけたことにする
function commit(g) {
  const hit = (g.kana || g.buf) && exactHit(g, g.kana, g.buf);
  if (!hit) return [];
  take(g, hit.j, false);
  return [{ ev: 'found', j: hit.j }];
}
function backspace(g) {
  g.swallowN = false; g.tail = null;
  if (g.buf) g.buf = g.buf.slice(0, -1);
  else if (g.kana) g.kana = [...g.kana].slice(0, -1).join('');
}

if (typeof module !== 'undefined') module.exports = { feedRoma, flushRoma, normKana, typeable, newGame, press, commit, backspace, done, lost, MISS_MAX };
