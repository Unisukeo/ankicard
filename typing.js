// 暗記カード：打ち込み型の答え合わせ（2026-11-26〜）
//   ローマ字 → ひらがな、打った答えとカードの「正解にする言い方」（items[].keys）の突き合わせ。
//   画面には触らない。node でも読める（試すとき）。
//
// カードの形：items[] に keys（ひらがなの短い言葉の配列）があると、そのカードは打ち込み型で出る。
//   打った答えに keys のどれかが入っていれば、その項目に当たり。答えの順番は問わない。
//   1つの答えは1つの項目にしか当たらない。全部の項目に当たれば ○。
//   keys の頭が数字のとき（例："5ねん"）は、すぐ前が数字なら当たりにしない（"15ねん" を "5ねん" と見ない）。

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
function hasKey(ans, key) {
  const a = normKana(ans), k = normKana(key);
  if (!k) return false;
  let i = a.indexOf(k);
  while (i >= 0) {
    if (!(/^[0-9]/.test(k) && i > 0 && /[0-9]/.test(a[i - 1]))) return true;
    i = a.indexOf(k, i + 1);
  }
  return false;
}
function typeable(card) { return !!(card.items && card.items.length && card.items.every(it => Array.isArray(it.keys) && it.keys.length)); }

// 打った答え（配列）とカードの項目を突き合わせる。返すのは
//   { ok, hit: [答えごとに当たった項目の番号 or -1], got: [項目ごとに当てた答えの番号 or -1] }
function grade(card, answers) {
  const items = card.items;
  const can = answers.map(a => items.map((it, j) => (normKana(a) ? it.keys.some(k => hasKey(a, k)) : false)).map((v, j) => (v ? j : -1)).filter(j => j >= 0));
  const got = items.map(() => -1);
  // 二部マッチング（答えをできるだけ多くの項目に当てる）
  const tryA = (i, seen) => {
    for (const j of can[i]) {
      if (seen[j]) continue;
      seen[j] = true;
      if (got[j] < 0 || tryA(got[j], seen)) { got[j] = i; return true; }
    }
    return false;
  };
  answers.forEach((_, i) => tryA(i, {}));
  const hit = answers.map(() => -1);
  got.forEach((i, j) => { if (i >= 0) hit[i] = j; });
  return { ok: got.every(i => i >= 0), hit, got };
}

if (typeof module !== 'undefined') module.exports = { feedRoma, flushRoma, normKana, hasKey, grade, typeable };
