// 暗記カード
// 合い鍵（GitHub の fine-grained token）を入れると、非公開のリポジトリ（ankicard-data）の
//   cards/<科目>.json からカードを読み、記録を records/<日付>_<端末>.jsonl に足していく。
// 合い鍵がないとき（PC で試すとき）は ../data/cards/ を読み、記録はこのブラウザの中だけ。
// 記録はまずこのブラウザの中（localStorage）にため、裏で送る。解いている間は待たない。
// 2026-11-24：復習の間隔はやめた。カードごと・日ごとの「○ が付くまでに × を押した回数」で並べる。

const LOCAL_CARD_FILES = ['民法総則.json'];
const LOCAL_CARD_DIR = '../data/cards/';
const DEFAULT_REPO = 'Unisukeo/ankicard-data';
const KEY_EVENTS = 'ankicard.events';
const KEY_SETTINGS = 'ankicard.settings';
const KEY_DECKS = 'ankicard.decks';     // カードのファイル名 → {sha, deck}（電波がないときもこれで解く）
const KEY_RECSHA = 'ankicard.recsha';   // 記録のファイル名 → sha（変わったものだけ読み直す）

const $view = document.getElementById('view');
let CARDS = [];
let LOAD_ERROR = '';
let SESSION = null; // 解いている最中の並び

// ---------- 日付（?today=2026-11-30 で、日付を変えて試せる） ----------
const TODAY_OVERRIDE = new URLSearchParams(location.search).get('today');
function localDay(date = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}
function today() { return TODAY_OVERRIDE && /^\d{4}-\d{2}-\d{2}$/.test(TODAY_OVERRIDE) ? TODAY_OVERRIDE : localDay(); }
function md(d) { return `${+d.slice(5, 7)}/${+d.slice(8, 10)}`; }

// ---------- 保存 ----------
function loadJSON(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}
function settings() {
  const dev = /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : 'PC';
  return Object.assign({ device: dev, perSession: 20, sound: true, token: '', repo: DEFAULT_REPO }, loadJSON(KEY_SETTINGS, {}));
}
function saveSettings(s) { localStorage.setItem(KEY_SETTINGS, JSON.stringify(s)); }
const online = () => !!settings().token;
function events() { return loadJSON(KEY_EVENTS, []); }
function saveEvents(all) { localStorage.setItem(KEY_EVENTS, JSON.stringify(all)); }
function addEvent(e) {
  const all = events();
  const now = new Date();
  // 日付を変えて試しているときも、並び順が崩れないよう t は「その日付＋今の時刻」にする
  const t = TODAY_OVERRIDE ? `${today()}T${now.toISOString().slice(11)}` : now.toISOString();
  const device = settings().device;
  const id = `${t}_${device}_${Math.random().toString(36).slice(2, 7)}`;
  // _p：まだ送っていない印（送るときは外す）。日付を変えて試した記録は送らない
  const send = online() && !TODAY_OVERRIDE;
  all.push(Object.assign({ id, d: today(), t, device }, e, send ? { _p: 1 } : {}));
  saveEvents(all);
  if (send) schedulePush();
}
function state() { return replay(CARDS, events()); }

// ---------- カード ----------
// 判例の印（カードの hanrei：{ status: "確認済み"|"未確認", cases: [...] }）
function hanreiNote(c) {
  const h = c.hanrei; if (!h) return '';
  const ok = h.status === '確認済み';
  const cases = (h.cases || []).map(esc).join('・');
  return `<div class="hanrei ${ok ? 'ok' : 'unchecked'}"><b>判例</b>${cases ? ` ${cases}` : ''}<span class="hs">${ok ? 'ぐーぐるが確認済み' : 'AI が照らした（未確認）'}</span></div>`;
}
function cardsFromDecks(decks) {
  const all = [];
  for (const name of Object.keys(decks).sort()) {
    const deck = decks[name].deck;
    for (const c of deck.cards || []) all.push(Object.assign({ deck: deck.deck, file: name }, c, { topic: c.topic || c.question }));
  }
  return all;
}
async function loadLocalCards() {
  const decks = {};
  for (const f of LOCAL_CARD_FILES) {
    const res = await fetch(LOCAL_CARD_DIR + encodeURIComponent(f), { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${f} が読めない（${res.status}）`);
    decks[f] = { sha: '', deck: await res.json() };
  }
  return decks;
}

// ---------- GitHub ----------
const SYNC = { state: 'idle', msg: '', at: null };
function gh(path, opts = {}) {
  const s = settings();
  return fetch(`https://api.github.com/repos/${s.repo}/${path}`, {
    method: opts.method || 'GET',
    body: opts.body,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${s.token}`,
      Accept: opts.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
}
function ghError(res, what) {
  if (res.status === 401) return new Error('合い鍵が違うか、期限が切れている');
  if (res.status === 404) return new Error(`${what} が見つからない（リポジトリの名前か、合い鍵の範囲を確かめて）`);
  if (res.status === 403) return new Error('合い鍵に書き込みの許可がないか、回数の上限');
  return new Error(`${what}：GitHub が ${res.status} を返した`);
}
function b64encode(text) {
  const b = new TextEncoder().encode(text);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64decode(b64) { return new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0))); }

async function listDir(dir) {
  const res = await gh(`contents/${dir}`);
  if (res.status === 404) return [];
  if (!res.ok) throw ghError(res, dir);
  return (await res.json()).filter(f => f.type === 'file');
}
async function pullCards() {
  const old = loadJSON(KEY_DECKS, {});
  const next = {};
  for (const f of (await listDir('cards')).filter(f => f.name.endsWith('.json'))) {
    if (old[f.name] && old[f.name].sha === f.sha) { next[f.name] = old[f.name]; continue; }
    const res = await gh(`contents/cards/${encodeURIComponent(f.name)}`, { raw: true });
    if (!res.ok) throw ghError(res, `cards/${f.name}`);
    next[f.name] = { sha: f.sha, deck: JSON.parse(await res.text()) };
  }
  localStorage.setItem(KEY_DECKS, JSON.stringify(next));
  CARDS = cardsFromDecks(next);
  LOAD_ERROR = '';
}
function mergeEvents(lines) {
  const all = events();
  const have = new Set(all.map(e => e.id));
  let added = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e.id && !have.has(e.id)) { all.push(e); have.add(e.id); added++; }
    } catch { /* 読めない行は飛ばす */ }
  }
  if (added) saveEvents(all);
  return added;
}
async function pullRecords() {
  const shas = loadJSON(KEY_RECSHA, {});
  for (const f of (await listDir('records')).filter(f => f.name.endsWith('.jsonl'))) {
    if (shas[f.name] === f.sha) continue;
    const res = await gh(`contents/records/${encodeURIComponent(f.name)}`, { raw: true });
    if (!res.ok) throw ghError(res, `records/${f.name}`);
    mergeEvents((await res.text()).split('\n'));
    shas[f.name] = f.sha;
  }
  localStorage.setItem(KEY_RECSHA, JSON.stringify(shas));
}
function stripPending(e) { const { _p, ...rest } = e; return rest; }
// まだ送っていない記録を、日付・端末ごとのファイルに足す（前の行は書き換えない）
async function pushRecords() {
  const pending = events().filter(e => e._p);
  if (!pending.length) return;
  const groups = {};
  for (const e of pending) {
    const name = `${e.d}_${String(e.device).replace(/[\\/:*?"<>|\s]/g, '')}.jsonl`;
    (groups[name] = groups[name] || []).push(e);
  }
  const shas = loadJSON(KEY_RECSHA, {});
  for (const [name, list] of Object.entries(groups)) {
    const path = `contents/records/${encodeURIComponent(name)}`;
    for (let attempt = 0; ; attempt++) {
      const cur = await gh(path);
      let text = '', sha;
      if (cur.ok) { const j = await cur.json(); sha = j.sha; text = b64decode(j.content || ''); }
      else if (cur.status !== 404) throw ghError(cur, `records/${name}`);
      const have = new Set(text.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l).id; } catch { return null; } }));
      const add = list.filter(e => !have.has(e.id)).map(e => JSON.stringify(stripPending(e)));
      if (!add.length) break;
      if (text && !text.endsWith('\n')) text += '\n';
      text += add.join('\n') + '\n';
      const body = { message: `記録 ${name}（${add.length}件）`, content: b64encode(text) };
      if (sha) body.sha = sha;
      const res = await gh(path, { method: 'PUT', body: JSON.stringify(body) });
      if (res.ok) { shas[name] = (await res.json()).content.sha; break; }
      if ((res.status === 409 || res.status === 422) && attempt < 2) continue; // ほかの端末と重なった：読み直してもう一度
      throw ghError(res, `records/${name}`);
    }
  }
  localStorage.setItem(KEY_RECSHA, JSON.stringify(shas));
  const sentIds = new Set(pending.map(e => e.id));
  saveEvents(events().map(e => (sentIds.has(e.id) ? stripPending(e) : e)));
}
let syncing = null;
function sync({ cards = true } = {}) {
  if (!online()) return Promise.resolve();
  if (syncing) return syncing;
  SYNC.state = 'busy'; showSync();
  syncing = (async () => {
    try {
      await pushRecords();
      if (cards) await pullCards();
      await pullRecords();
      SYNC.state = 'ok'; SYNC.msg = ''; SYNC.at = new Date();
    } catch (err) {
      const net = err instanceof TypeError || navigator.onLine === false; // つながらないときは fetch が TypeError を出す
      SYNC.state = net ? 'offline' : 'err';
      SYNC.msg = net ? '電波がないか、GitHub につながらない（記録はこの中にためてある）' : String(err.message || err);
    } finally {
      syncing = null; showSync();
    }
  })();
  return syncing;
}
let pushTimer = null;
function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => sync({ cards: false }), 4000);
  showSync();
}
function showSync() {
  const el = document.getElementById('sync');
  if (!el) return;
  if (!online()) { el.textContent = ''; el.className = 'sync'; return; }
  const n = events().filter(e => e._p).length;
  const text = SYNC.state === 'busy' ? '送受信中…'
    : SYNC.state === 'err' ? '同期できない'
    : SYNC.state === 'offline' ? '電波なし'
    : n ? `未送信 ${n}` : '同期済み';
  el.textContent = text;
  el.className = `sync ${SYNC.state === 'err' ? 'bad' : n || SYNC.state === 'offline' ? 'wait' : 'good'}`;
  el.title = SYNC.msg || (SYNC.at ? `最後に同期：${SYNC.at.toLocaleTimeString()}` : '');
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && online() && events().some(e => e._p)) sync({ cards: false });
});
window.addEventListener('online', () => { if (online()) sync(); });

// ---------- カードを読む（最初） ----------
async function loadCards() {
  LOAD_ERROR = '';
  if (online()) {
    CARDS = cardsFromDecks(loadJSON(KEY_DECKS, {})); // まず取っておいたもので出す。新しいものは sync で
    return;
  }
  if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) { LOAD_ERROR = 'NEED_TOKEN'; return; } // 公開のページ：合い鍵がないと読めない
  try { CARDS = cardsFromDecks(await loadLocalCards()); }
  catch (err) { LOAD_ERROR = String(err.message || err); }
}

// ---------- 音 ----------
let audioCtx = null;
function ctx() {
  if (!settings().sound) return null;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  } catch { return null; }
}
// 1つの音：周波数を from → to に動かしながら、すっと消える
function tone(ac, { at = 0, from, to = from, len = 0.15, type = 'sine', vol = 0.2 }) {
  const o = ac.createOscillator(), g = ac.createGain();
  const t0 = ac.currentTime + at;
  o.type = type;
  o.frequency.setValueAtTime(from, t0);
  if (to !== from) o.frequency.exponentialRampToValueAtTime(to, t0 + len * 0.8);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
  o.connect(g).connect(ac.destination); o.start(t0); o.stop(t0 + len + 0.03);
}
// 効果音ラボ（https://soundeffect-lab.info/ ）の音（2026-11-26 ぐーぐるが選んだ）。
// 規約で再配布が禁止なので、音のファイルは公開のこのリポジトリには置かず、非公開の ankicard-data の se/ に置く。
// 合い鍵で読んで、この端末の Cache に取っておく（電波がなくても鳴る）。読めないときは、下の作った音で鳴らす。
const SE_FILES = {
  tick: 'cursor9',        // キーを打つ：カーソル移動9
  pop: 'decision2',       // ボタン：決定ボタンを押す2
  big: 'decision3',       // 大きな選択（解き始める・保存して同期）：決定ボタンを押す3
  check: 'news-title3',   // 答え合わせ：ニュースタイトル表示3
  correct: 'correct3',    // ○：クイズ正解3
  wrong: 'incorrect2',    // ×：クイズ不正解2
  finish: 'levelup1',     // 解き終わった：レベルアップ
};
const SE_VOL = { tick: 0.5, pop: 0.6, big: 0.7, check: 0.7, correct: 0.8, wrong: 0.8, finish: 0.8 };
const SE_CACHE = 'ankicard-se';
const KEY_SE = 'ankicard.se'; // 音の名前 → sha（取っておいたものを探す）
const SE_BUF = {};            // 音の名前 → { buf, off }（off：頭の無音を飛ばす秒数）
async function loadSE() {
  try {
    const ac = audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const map = loadJSON(KEY_SE, {});
    let list = null;
    if (online()) { try { list = await listDir('se'); } catch { /* 電波がない：取っておいたものを使う */ } }
    const cache = 'caches' in window ? await caches.open(SE_CACHE) : null;
    for (const [name, file] of Object.entries(SE_FILES)) {
      try {
        let data = null;
        if (online()) {
          const f = list && list.find(x => x.name === `${file}.mp3`);
          const sha = f ? f.sha : map[file];
          if (!sha) continue;
          const key = `se-cache/${sha}.mp3`;
          const hit = cache && await cache.match(key);
          if (hit) data = await hit.arrayBuffer();
          else if (f) {
            const res = await gh(`contents/se/${encodeURIComponent(f.name)}`, { raw: true });
            if (!res.ok) continue;
            data = await res.arrayBuffer();
            if (cache) await cache.put(key, new Response(data.slice(0), { headers: { 'Content-Type': 'audio/mpeg' } }));
            map[file] = sha;
          }
        } else if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
          const res = await fetch(`../data/se/${file}.mp3`); // PC で試すとき
          if (res.ok) data = await res.arrayBuffer();
        }
        if (!data) continue;
        const buf = await new Promise((ok, ng) => ac.decodeAudioData(data, ok, ng));
        // 頭の無音を飛ばす（押してすぐ鳴るように）
        const ch = buf.getChannelData(0);
        let i = 0; while (i < ch.length && Math.abs(ch[i]) < 0.01) i++;
        SE_BUF[name] = { buf, off: i < ch.length ? Math.max(0, i / buf.sampleRate - 0.003) : 0 };
      } catch { /* この音だけ作った音で鳴らす */ }
    }
    localStorage.setItem(KEY_SE, JSON.stringify(map));
  } catch { /* 音がなくても動く */ }
}
// 取ってきた音を鳴らす。なければ false
function playSE(name) {
  const ac = ctx(), b = SE_BUF[name]; if (!ac || !b) return false;
  const s = ac.createBufferSource(), g = ac.createGain();
  s.buffer = b.buf; g.gain.value = SE_VOL[name] ?? 0.7;
  s.connect(g).connect(ac.destination); s.start(0, b.off);
  return { s, g, len: b.buf.duration - b.off };
}
const SE = {
  // さわったとき：ポコン
  pop() {
    if (playSE('pop')) return;
    const ac = ctx(); if (!ac) return;
    tone(ac, { from: 1100, to: 520, len: 0.09, vol: 0.22 });
    tone(ac, { at: 0.045, from: 700, to: 380, len: 0.11, vol: 0.16 });
  },
  // 大きな選択（解き始める など）
  big() { if (!playSE('big')) SE.pop(); },
  // ○：ピンポーン＋キラキラ
  correct() {
    if (playSE('correct')) return;
    const ac = ctx(); if (!ac) return;
    tone(ac, { from: 1318.5, len: 0.35, type: 'triangle', vol: 0.3 });
    tone(ac, { at: 0.16, from: 1046.5, len: 0.6, type: 'triangle', vol: 0.3 });
    [1568, 2093, 2637, 3136, 4186].forEach((f, i) => tone(ac, { at: 0.3 + i * 0.05, from: f, len: 0.18, vol: 0.07 }));
    [523.25, 659.25, 783.99].forEach(f => tone(ac, { at: 0.16, from: f, len: 0.7, type: 'sine', vol: 0.08 }));
  },
  // キーボードのキー：コッ（小さく短く）
  tick() {
    if (playSE('tick')) return;
    const ac = ctx(); if (!ac) return;
    tone(ac, { from: 1900, to: 1300, len: 0.045, type: 'triangle', vol: 0.1 });
  },
  // ×：ブブー
  wrong() {
    if (playSE('wrong')) return;
    const ac = ctx(); if (!ac) return;
    tone(ac, { from: 180, len: 0.16, type: 'square', vol: 0.08 });
    tone(ac, { at: 0.2, from: 150, len: 0.32, type: 'square', vol: 0.08 });
  },
  // 答え合わせ：鳴らした音を返す（○× を出すときに小さくして止める）
  check() { return playSE('check') || (SE.pop(), null); },
  // 解き終わった
  finish() { if (!playSE('finish')) SE.correct(); },
};
// 鳴っている音を、すっと小さくして止める
function fadeOut(p, sec = 0.08) {
  if (!p || !audioCtx) return;
  try { const t = audioCtx.currentTime; p.g.gain.setValueAtTime(p.g.gain.value, t); p.g.gain.linearRampToValueAtTime(0, t + sec); p.s.stop(t + sec + 0.02); } catch { /* もう止まっている */ }
}
// ボタン・リンク・チップにさわったら「ポコン」。data-se="big" は大きな選択の音、"none" は鳴らさない（○・× などは別の音）
document.addEventListener('pointerdown', e => {
  const el = e.target.closest('button, a, summary, select, input[type=checkbox]');
  if (!el || el.dataset.se === 'none') return;
  if (el.dataset.se === 'big') SE.big(); else SE.pop();
}, true);

// ---------- Clawd（アイコンと同じ絵。座標は 512×512） ----------
// face：'normal'（まばたき）・'smile'（^ ^）・'xx'（> <）
// sign：'o'・'x'・null（札を両手で上げる）／ arms：'down'・'up'（札がないとき）
function clawd({ face = 'normal', sign = null, arms = 'down', cls = '' } = {}) {
  const B = '#D97757', K = '#1F1A17';
  const rect = (x, y, w, h, fill, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${extra}/>`;
  let g = `<ellipse cx="256" cy="468" rx="126" ry="10" fill="${K}" opacity="0.1"/>`;
  let view = '100 225 312 262';
  if (sign) {
    view = '80 40 352 447';
    g += rect(127, 190, 8, 26, '#9A7356') + rect(377, 190, 8, 26, '#9A7356');
    g += `<rect x="96" y="54" width="320" height="140" rx="12" fill="#fff" stroke="${K}" stroke-width="8"/>`;
    g += sign === 'o'
      ? `<circle cx="256" cy="124" r="46" fill="none" stroke="#E53935" stroke-width="16"/>`
      : `<path d="M220 88L292 160M292 88L220 160" stroke="#1E63C8" stroke-width="17" stroke-linecap="round"/>`;
    g += rect(119, 210, 25, 102, B) + rect(369, 210, 25, 102, B);
  } else if (arms === 'up') {
    g += rect(119, 267, 25, 55, B) + rect(369, 267, 25, 55, B);
  } else {
    g += rect(119, 304, 25, 55, B) + rect(369, 304, 25, 55, B);
  }
  for (const x of [144, 194, 294, 344]) g += rect(x, 397, 25, 69, B);
  g += rect(144, 250, 225, 162, B);
  const line = pts => `<polyline points="${pts}" fill="none" stroke="${K}" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (face === 'smile') {
    g += `<ellipse cx="166" cy="354" rx="16" ry="8" fill="#EE9C86"/><ellipse cx="347" cy="354" rx="16" ry="8" fill="#EE9C86"/>`;
    g += line('162,334 183,304 204,334') + line('309,334 330,304 351,334');
  } else if (face === 'xx') {
    g += line('165,300 199,318 165,336') + line('348,300 314,318 348,336');
  } else {
    g += rect(176, 296, 17, 40, K, ' class="eye"') + rect(320, 296, 17, 40, K, ' class="eye"');
  }
  return `<svg class="clawd ${cls}" viewBox="${view}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${g}</svg>`;
}

// ---------- 演出 ----------
function bigMark(kind) {
  const fx = document.createElement('div');
  fx.className = `fx fx-${kind}`;
  if (kind === 'o') {
    const colors = ['#e53935', '#ffb300', '#43a047', '#1e88e5', '#d81b60', '#fdd835'];
    let bits = '';
    for (let i = 0; i < 26; i++) {
      const ang = (i / 26) * Math.PI * 2 + Math.random() * 0.3, dist = 140 + Math.random() * 120;
      bits += `<i style="--dx:${Math.cos(ang) * dist}px;--dy:${Math.sin(ang) * dist}px;--r:${Math.random() * 720 - 360}deg;background:${colors[i % colors.length]};animation-delay:${Math.random() * 0.08}s"></i>`;
    }
    fx.innerHTML = `<div class="burst">${bits}</div><svg class="mark" viewBox="0 0 200 200"><circle cx="100" cy="100" r="74"/></svg>`
      + `<div class="pop">${clawd({ face: 'smile', sign: 'o' })}</div>`;
  } else {
    fx.innerHTML = `<svg class="mark" viewBox="0 0 200 200"><path d="M50 50 L150 150 M150 50 L50 150"/></svg>`
      + `<div class="pop">${clawd({ face: 'xx', sign: 'x' })}</div>`;
  }
  document.body.appendChild(fx);
  setTimeout(() => fx.remove(), kind === 'o' ? 1000 : 800);
}

// ---------- 小物 ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const byId = id => CARDS.find(c => c.id === id);
function setNav(name) {
  document.querySelectorAll('header a').forEach(a => a.classList.toggle('on', a.dataset.nav === name));
  $view.classList.toggle('wide', name === 'list');
}
function render(html, keepScroll) { document.body.classList.remove('kb-on'); $view.innerHTML = html; if (!keepScroll) window.scrollTo(0, 0); }
// 1日ぶんの記録の表示：11/24 ○ ／ 11/24 ×2→○ ／ 11/24 ×3（○まだ）
function dayChip(r) {
  const cls = r.x === 0 ? 'o' : r.o ? 'r' : 'x';
  const txt = r.x === 0 ? '○' : r.o ? `×${r.x}→○` : `×${r.x}（○まだ）`;
  return `<span class="d ${cls}" title="${r.d}">${md(r.d)} ${txt}</span>`;
}
function recentChips(s) { return s.recent.length ? s.recent.map(dayChip).join('') : '<span class="muted">まだ</span>'; }
function scoreBadge(s) { return s.solved ? `<span class="score ${s.score ? 'hot' : ''}" title="最近3日の × の合計">×${s.score}</span>` : '<span class="score new">新</span>'; }
// 科目 → 分野 → カード の入れ子
function tree() {
  const m = new Map();
  for (const c of CARDS) {
    const s = c.subject || '（科目なし）';
    if (!m.has(s)) m.set(s, new Map());
    const f = m.get(s);
    if (!f.has(c.field)) f.set(c.field, []);
    f.get(c.field).push(c);
  }
  return m;
}

// ---------- ホーム ----------
function viewHome() {
  setNav('home');
  if (LOAD_ERROR === 'NEED_TOKEN') return render(`<div class="panel"><b>はじめに</b><p>カードは非公開のリポジトリにあるので、合い鍵が要る。<a href="#settings">設定</a>の「合い鍵」に入れて「保存して同期」を押してね。</p></div>`);
  if (LOAD_ERROR) return render(`<div class="err">カードが読めなかった：${esc(LOAD_ERROR)}</div>`);
  if (!CARDS.length) return render(`<div class="panel">${online() ? (SYNC.state === 'busy' || SYNC.state === 'idle' ? 'カードを読み込み中…' : `カードが読めなかった：${esc(SYNC.msg || 'cards/ にカードがない')}<br><a href="#settings">設定</a>で合い鍵を確かめて`) : 'カードがない'}</div>`);
  const st = state(), set = settings();
  const solved = CARDS.filter(c => st[c.id].solved).sort(byAttention(st));
  const hot = solved.filter(c => st[c.id].score > 0).length;
  const fresh = CARDS.filter(c => !st[c.id].solved);
  const doneToday = CARDS.filter(c => st[c.id].days[today()]?.o).length;
  const flagged = CARDS.filter(c => st[c.id].flag);
  const top = solved.slice(0, 3);
  render(`
    <div class="greet">${clawd({ cls: 'mini' })}<div class="bubble">${esc(greeting(hot, fresh.length, doneToday))}</div></div>
    <div class="counts">
      <div class="count"><b>${hot}</b><span>× あり（最近3日）</span></div>
      <div class="count"><b>${fresh.length}</b><span>まだ解いていない</span></div>
      <div class="count"><b>${doneToday}</b><span>今日 ○</span></div>
    </div>
    <button class="primary big" id="attn" data-se="big" ${solved.length ? '' : 'disabled'}>要注意の順に解く<small>${Math.min(set.perSession, solved.length)}枚</small></button>
    ${top.length ? `<div class="toplist">${top.map(c => `<a href="#card/${encodeURIComponent(c.id)}">${scoreBadge(st[c.id])}<span class="tp">${esc(c.topic)}</span></a>`).join('')}</div>` : ''}
    <button class="big" id="fresh" data-se="big" ${fresh.length ? '' : 'disabled'} style="margin-top:10px">まだ解いていないのを解く<small>${Math.min(set.perSession, fresh.length)}枚</small></button>
    <h2>分野から選ぶ</h2>
    ${fieldTree(st)}
    ${flagged.length ? `<button class="chip" id="flagged" data-se="big" style="margin-top:4px">「直して」を付けたカードを解く<small>${flagged.length}</small></button>` : ''}
    <p class="muted">カード ${CARDS.length}枚 ・ 1回に ${set.perSession}枚まで ・ 今日 ${md(today())}</p>
  `);
  document.getElementById('attn').onclick = () => startSession('要注意の順', solved.slice(0, set.perSession));
  document.getElementById('fresh').onclick = () => startSession('まだ解いていない', fresh.slice(0, set.perSession));
  const fb = document.getElementById('flagged');
  if (fb) fb.onclick = () => startSession('「直して」', flagged.sort(byAttention(st)));
  bindTreeToggles();
}
function greeting(hot, fresh, done) {
  if (done && !hot && !fresh) return `今日は ${done}枚 ○！ ばっちり`;
  if (done) return `今日は ${done}枚 ○。いい調子！`;
  if (hot) return `× が残ってるのが ${hot}枚。いっしょにやろう`;
  if (fresh) return `まだ解いてないのが ${fresh}枚あるよ`;
  return 'きょうも1枚ずつ';
}
// 科目を開くと分野が並び、分野を開くと論点（カード）が並ぶ
const OPEN = new Set(loadJSON('ankicard.open', []));
function fieldTree(st) {
  const t = tree();
  return `<div class="tree">${[...t].map(([subj, fields]) => {
    const all = [...fields.values()].flat();
    const sum = all.reduce((n, c) => n + st[c.id].score, 0);
    const key = subj;
    return `<details class="subj" data-key="${esc(key)}" ${OPEN.has(key) ? 'open' : ''}>
      <summary><span class="nm">${esc(subj)}</span><span class="muted">${all.length}枚</span>${sum ? `<span class="score hot">×${sum}</span>` : ''}</summary>
      ${[...fields].map(([field, cards]) => {
        const fkey = `${subj}/${field}`;
        const fsum = cards.reduce((n, c) => n + st[c.id].score, 0);
        const sorted = cards.slice().sort(byAttention(st));
        return `<details class="fld" data-key="${esc(fkey)}" ${OPEN.has(fkey) ? 'open' : ''}>
          <summary><span class="nm">${esc(field)}</span><span class="muted">${cards.length}</span>${fsum ? `<span class="score hot">×${fsum}</span>` : ''}</summary>
          <ul class="topics">${sorted.map(c => `<li><a href="#card/${encodeURIComponent(c.id)}">${scoreBadge(st[c.id])}<span class="tp">${esc(c.topic)}</span></a><div class="dates">${recentChips(st[c.id])}</div></li>`).join('')}</ul>
          <button class="solve-field" data-se="big" data-subject="${esc(subj)}" data-field="${esc(field)}">「${esc(field)}」を解く（${cards.length}枚）</button>
        </details>`;
      }).join('')}
    </details>`;
  }).join('')}</div>`;
}
function bindTreeToggles() {
  $view.querySelectorAll('details[data-key]').forEach(d => d.addEventListener('toggle', () => {
    if (d.open) OPEN.add(d.dataset.key); else OPEN.delete(d.dataset.key);
    localStorage.setItem('ankicard.open', JSON.stringify([...OPEN]));
  }));
  $view.querySelectorAll('.solve-field').forEach(b => b.onclick = () => {
    const st = state();
    const list = CARDS.filter(c => c.subject === b.dataset.subject && c.field === b.dataset.field).sort(byAttention(st));
    startSession(b.dataset.field, list);
  });
}

// ---------- 解く ----------
// カードの項目に keys（正解にする言い方）があれば打ち込み型、なければ自分で ○× を押す形（2026-11-26〜）。
// どちらも、カードが出てから「答え合わせ」（打ち込み型）か「答えを見る」までの秒数を sec に記録する。
const SEC_LIMIT = 180; // これより長いのは、手を止めていたとみなして記録しない
function startSession(label, list) {
  if (!list.length) return;
  SESSION = { label, queue: list.map(c => ({ id: c.id, again: false })), pos: 0, o: 0, x: 0, total: list.length, busy: false };
  beginCard(SESSION);
  location.hash = '#solve';
}
// 1枚ごとの状態を作り直す
function beginCard(S) {
  const item = S.queue[S.pos], c = item && byId(item.id);
  S.shown = false; S.sec = null; S.t0 = performance.now(); S.hidAt = null;
  S.typing = !!(c && typeable(c));
  S.fixed = !!(c && c.show_count);
  S.slots = S.typing ? (S.fixed ? c.items.map(() => '') : ['']) : [];
  S.active = 0; S.buf = ''; S.graded = null; S.self = false;
}
function elapsedSec(S) {
  const sec = Math.round((performance.now() - S.t0) / 1000);
  return sec <= SEC_LIMIT ? sec : null;
}
// 画面を閉じていた時間は数えない
document.addEventListener('visibilitychange', () => {
  const S = SESSION; if (!S) return;
  if (document.visibilityState === 'hidden') S.hidAt = performance.now();
  else if (S.hidAt) { S.t0 += performance.now() - S.hidAt; S.hidAt = null; }
});
function itemsHTML(c, got) {
  return `<ol class="items">${c.items.map((it, j) => {
    const cls = got ? (got[j] >= 0 ? 'got' : 'missed') : '';
    return `<li class="${cls}">${esc(it.text)}${it.basis ? `<span class="basis">${esc(it.basis)}</span>` : ''}</li>`;
  }).join('')}</ol>`;
}
function viewSolve() {
  setNav('');
  if (!SESSION) return (location.hash = '#home');
  const S = SESSION;
  if (S.pos >= S.queue.length) {
    render(`<div class="panel done">
      <div class="done-clawd"><div class="sparkle">${'<i></i>'.repeat(6)}</div>${clawd({ face: 'smile', arms: 'up', cls: 'hop' })}</div>
      <p><b>「${esc(S.label)}」おわり</b></p>
      <p class="muted">${S.total}枚 ・ 1回目で ○ ${S.o}枚 ・ × のあと やり直し ${S.x}枚</p>
      <a class="btn primary" href="#home">ホームへ</a>
    </div>`);
    SE.finish();
    SESSION = null; if (online()) sync({ cards: false }); return;
  }
  const item = S.queue[S.pos], c = byId(item.id);
  if (!c) { S.pos++; beginCard(S); return viewSolve(); } // カードが消えていたら飛ばす
  const s = state()[c.id];
  const n = c.show_count ? `（${c.items.length}つ）` : '';
  const head = `
    <div class="progress"><span>${esc(S.label)}</span><span>のこり ${S.queue.length - S.pos}枚</span></div>
    <div class="qcard" id="qcard">
      <div class="meta">${esc(c.subject)} › ${esc(c.field)} › <b>${esc(c.topic)}</b>${item.again ? '<span class="retry-tag">やり直し</span>' : ''}</div>
      <div class="q">${esc(c.question)}<span class="n">${n}</span></div>
      <div class="dates" style="margin-top:8px">${s.solved ? recentChips(s) : '<span class="muted">はじめて</span>'}</div>`;
  const foot = `<div class="subacts"><a href="#home" id="quit">やめる</a><a href="#card/${encodeURIComponent(c.id)}">このカードの記録・「直して」</a></div>`;
  if (S.typing) {
    const g = S.graded;
    render(`${head}
        <div class="slots" id="slots">${slotsHTML(S)}</div>
        ${g ? `<div class="judge ${g.ok ? 'o' : 'x'}">${g.ok ? '○ 全部当たり！' : `× ${c.items.length - g.got.filter(i => i >= 0).length}つ足りない`}${S.sec != null ? `<span class="muted" style="font-weight:400;font-size:13px;margin-left:8px">${S.sec}秒</span>` : ''}</div>
          ${itemsHTML(c, g.got)}${c.memo ? `<div class="memo">${esc(c.memo)}</div>` : ''}${hanreiNote(c)}` : ''}
      </div>
      ${g ? `<div class="answer-bar"><button class="next" id="bn">次へ</button>${g.ok ? '' : '<button class="self" id="bs" data-se="none">合ってた<small>○ にする</small></button>'}</div>
        <div class="keys">次へ … Enter</div>` : `<div class="keys">ローマ字で打つ ・ 次の答え … Enter か スペース ・ 答え合わせ … Shift+Enter</div>`}
      ${foot}
      ${g ? '' : keyboardHTML(S)}`, !!g);
    if (!g) { document.body.classList.add('kb-on'); bindKeyboard(); }
    else {
      document.getElementById('bn').onclick = () => nextTyped();
      const bs = document.getElementById('bs');
      if (bs) bs.onclick = () => { if (S.busy) return; S.self = true; SE.correct(); bigMark('o'); S.busy = true; setTimeout(() => { S.busy = false; nextTyped(); }, 450); };
    }
    document.getElementById('quit').onclick = () => { SESSION = null; };
    return;
  }
  render(`${head}
      <div id="ans" ${S.shown ? '' : 'hidden'}>
        ${itemsHTML(c)}
        ${c.memo ? `<div class="memo">${esc(c.memo)}</div>` : ''}
        ${hanreiNote(c)}
      </div>
    </div>
    <div id="bar">
      ${S.shown
        ? `<div class="answer-bar"><button class="o" id="bo" data-se="none">○<small>全部わかった</small></button><button class="x" id="bx" data-se="none">×<small>1つでもわからない</small></button></div>`
        : `<button class="primary big" id="show" style="margin-top:16px">答えを見る</button>`}
    </div>
    <div class="keys">${S.shown ? '○ … 1 か O ／ × … 2 か X' : '答えを見る … スペース'}</div>
    ${foot}
  `);
  const show = document.getElementById('show');
  if (show) show.onclick = () => showAnswer();
  const bo = document.getElementById('bo'), bx = document.getElementById('bx');
  if (bo) bo.onclick = () => answer('o');
  if (bx) bx.onclick = () => answer('x');
  document.getElementById('quit').onclick = () => { SESSION = null; };
}
function showAnswer() { const S = SESSION; if (!S || S.shown) return; S.sec = elapsedSec(S); S.shown = true; viewSolve(); }
// 記録して次のカードへ（× のカードは最後にもう1回）
function record(result, extra) {
  const S = SESSION, item = S.queue[S.pos];
  addEvent(Object.assign({ type: 'answer', card: item.id, result, mode: S.label }, S.sec != null ? { sec: S.sec } : {}, extra));
  if (result === 'o') { if (!item.again) S.o++; }
  else { if (!item.again) S.x++; S.queue.push({ id: item.id, again: true }); }
}
function advance() { const S = SESSION; S.pos++; beginCard(S); viewSolve(); }
// 自分で ○× を押す形
function answer(result) {
  const S = SESSION; if (!S || S.typing || !S.shown || S.busy) return;
  record(result);
  if (result === 'o') { SE.correct(); bigMark('o'); }
  else { SE.wrong(); bigMark('x'); document.getElementById('qcard')?.classList.add('shake'); }
  // 演出を少し見せてから次へ
  S.busy = true;
  setTimeout(() => { S.busy = false; advance(); }, result === 'o' ? 450 : 380);
}

// ----- 打ち込み型 -----
function slotsHTML(S) {
  const g = S.graded;
  return S.slots.map((t, i) => {
    const on = !g && i === S.active;
    const cls = g ? (g.hit[i] >= 0 ? 'hit' : 'miss') : on ? 'on' : '';
    const mk = g ? `<span class="mk">${g.hit[i] >= 0 ? '○' : '×'}</span>` : '';
    const to = g && g.hit[i] >= 0 ? `<span class="to">→ ${g.hit[i] + 1}</span>` : '';
    return `<div class="slot ${cls}" data-slot="${i}"><span class="no">${i + 1}</span><span class="tx">${esc(t)}${on ? `<span class="buf">${esc(S.buf)}</span><span class="caret"></span>` : ''}</span>${to}${mk}</div>`;
  }).join('');
}
function updateSlots() {
  const el = document.getElementById('slots'); if (!el) return;
  el.innerHTML = slotsHTML(SESSION);
  el.querySelector('.slot.on')?.scrollIntoView({ block: 'nearest' });
}
const KB_ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl-', 'zxcvbnm'];
function keyboardHTML() {
  const key = (k, label = k, cls = '') => `<button class="k ${cls}" data-k="${k}" data-se="none" tabindex="-1">${label}</button>`;
  return `<div id="kb" aria-label="キーボード">
    ${KB_ROWS.map((r, i) => `<div class="kb-row ${i === 0 ? 'num' : i === 3 ? 'r3' : ''}">${[...r].map(k => key(k, k === '-' ? 'ー' : k)).join('')}${i === 3 ? key('BS', '⌫', 'bs') : ''}</div>`).join('')}
    <div class="kb-row">${key('NEXT', '次の答え', 'next')}${key('GO', '答え合わせ', 'go')}</div>
  </div>`;
}
function bindKeyboard() {
  const kb = document.getElementById('kb');
  kb.addEventListener('pointerdown', e => {
    const b = e.target.closest('.k'); if (!b) return;
    e.preventDefault();
    b.classList.add('pressed'); setTimeout(() => b.classList.remove('pressed'), 110);
    if (b.dataset.k !== 'GO') SE.tick();
    typeKey(b.dataset.k);
  });
  document.getElementById('slots').addEventListener('click', e => {
    const el = e.target.closest('.slot'); if (!el) return;
    const S = SESSION; flushSlot(S); S.active = +el.dataset.slot; updateSlots();
  });
}
function flushSlot(S) { S.slots[S.active] = flushRoma(S.slots[S.active], S.buf); S.buf = ''; }
function typeKey(k) {
  const S = SESSION; if (!S || !S.typing || S.graded || S.busy) return;
  if (k === 'GO') return gradeTyped();
  if (k === 'BS') {
    if (S.buf) S.buf = S.buf.slice(0, -1);
    else if (S.slots[S.active]) S.slots[S.active] = [...S.slots[S.active]].slice(0, -1).join('');
    else if (S.active > 0) { if (!S.fixed && S.active === S.slots.length - 1) S.slots.pop(); S.active--; }
  } else if (k === 'NEXT') {
    flushSlot(S);
    if (S.active < S.slots.length - 1) S.active++;
    else if (!S.fixed && S.slots[S.active] && S.slots.length < 20) { S.slots.push(''); S.active++; }
  } else {
    const r = feedRoma(S.slots[S.active], S.buf, k);
    S.slots[S.active] = r.kana; S.buf = r.buf;
  }
  updateSlots();
}
const CHECK_WAIT = 0.9; // 答え合わせの音を聞かせてから ○× を出すまでの秒数（音がもっと短ければその長さ）
function gradeTyped() {
  const S = SESSION; if (S.busy) return;
  const c = byId(S.queue[S.pos].id);
  flushSlot(S); updateSlots();
  S.sec = elapsedSec(S);
  const g = grade(c, S.slots.map(t => t.trim()));
  // 答え合わせの音 → ドキドキの間 → ○×
  const p = SE.check();
  const wait = p ? Math.min(p.len, CHECK_WAIT) : 0;
  S.busy = true;
  document.getElementById('kb')?.classList.add('wait');
  setTimeout(() => {
    S.busy = false;
    fadeOut(p);
    S.graded = g;
    if (g.ok) { SE.correct(); bigMark('o'); }
    else { SE.wrong(); bigMark('x'); }
    viewSolve();
    if (!g.ok) document.getElementById('qcard')?.classList.add('shake');
  }, wait * 1000);
}
function nextTyped() {
  const S = SESSION; if (!S || !S.graded) return;
  const result = S.graded.ok || S.self ? 'o' : 'x';
  record(result, { typed: S.slots.slice(), judge: S.self ? 'self' : 'auto' });
  advance();
}

document.addEventListener('keydown', e => {
  if (location.hash !== '#solve' || !SESSION || e.ctrlKey || e.metaKey || e.altKey) return;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
  const S = SESSION, k = e.key.toLowerCase();
  if (S.typing) {
    if (S.graded) { if (k === 'enter' || k === ' ') { e.preventDefault(); if (!S.busy) nextTyped(); } return; }
    if (k === 'enter' && (e.shiftKey || (S.fixed && S.active === S.slots.length - 1) || (!S.fixed && !S.slots[S.active] && !S.buf && S.slots.length > 1))) { e.preventDefault(); typeKey('GO'); }
    else if (k === 'enter' || k === ' ') { e.preventDefault(); typeKey('NEXT'); }
    else if (k === 'backspace') { e.preventDefault(); typeKey('BS'); }
    else if (/^[a-z0-9\-']$/.test(k)) { e.preventDefault(); if (!S.busy) SE.tick(); typeKey(k); }
    return;
  }
  if (!S.shown && (k === ' ' || k === 'enter')) { e.preventDefault(); SE.pop(); showAnswer(); }
  else if (S.shown && (k === '1' || k === 'o')) { e.preventDefault(); answer('o'); }
  else if (S.shown && (k === '2' || k === 'x')) { e.preventDefault(); answer('x'); }
});

// ---------- カードの記録 ----------
function viewCard(id) {
  setNav('');
  const c = byId(id);
  if (!c) return render(`<div class="err">カードが見つからない：${esc(id)}</div>`);
  const s = state()[id];
  const back = SESSION ? `<a class="btn" href="#solve">← 解くにもどる</a>` : `<a class="btn" href="javascript:history.back()">← もどる</a>`;
  render(`
    <div class="row">${back}</div>
    <div class="qcard">
      <div class="meta">${esc(c.subject)} › ${esc(c.field)} ・ ${esc(c.id)}</div>
      <div class="topic-name">${esc(c.topic)}</div>
      <div class="q">${esc(c.question)}</div>
      <ol class="items">${c.items.map(it => `<li>${esc(it.text)}${it.basis ? `<span class="basis">${esc(it.basis)}</span>` : ''}</li>`).join('')}</ol>
      ${c.memo ? `<div class="memo">${esc(c.memo)}</div>` : ''}
        ${hanreiNote(c)}
    </div>
    <h2>記録</h2>
    <div class="panel">
      <dl class="kv">
        <dt>最近3日の ×</dt><dd>${s.solved ? `${s.score}回` : 'まだ解いていない'}</dd>
        <dt>解いた日</dt><dd>${s.history.length}日</dd>
      </dl>
      <h3>日ごと（新しい順。○ が付くまでに × を押した回数）</h3>
      ${s.history.length ? `<div class="dates">${s.history.map(dayChip).join('')}</div>` : '<p class="muted">まだない</p>'}
    </div>
    <h2>「直して」</h2>
    <div class="panel">
      <label class="row"><input type="checkbox" id="flag" ${s.flag ? 'checked' : ''}> このカードを直してほしい</label>
      <textarea id="memo" placeholder="どこを直すか（なくてもよい）">${esc(s.memo)}</textarea>
      <div class="row"><button id="saveflag">保存</button><span class="muted" id="flagmsg"></span></div>
    </div>
  `);
  document.getElementById('saveflag').onclick = () => {
    const on = document.getElementById('flag').checked, memo = document.getElementById('memo').value.trim();
    if (on === s.flag && memo === s.memo) return;
    addEvent({ type: 'flag', card: id, on, memo });
    document.getElementById('flagmsg').textContent = '保存した';
    s.flag = on; s.memo = memo;
  };
}

// ---------- 一覧（PC 向け） ----------
const LIST_FILTER = { field: '', flag: false, sort: 'attn' };
function viewList() {
  setNav('list');
  const st = state();
  const fields = [...new Set(CARDS.map(c => `${c.subject} › ${c.field}`))];
  let rows = CARDS.filter(c =>
    (!LIST_FILTER.field || `${c.subject} › ${c.field}` === LIST_FILTER.field) &&
    (!LIST_FILTER.flag || st[c.id].flag));
  if (LIST_FILTER.sort === 'attn') rows = rows.slice().sort(byAttention(st));
  render(`
    <div class="filters">
      <select id="fs"><option value="attn" ${LIST_FILTER.sort === 'attn' ? 'selected' : ''}>要注意の順</option><option value="file" ${LIST_FILTER.sort === 'file' ? 'selected' : ''}>分野の順</option></select>
      <select id="ff"><option value="">分野：すべて</option>${fields.map(f => `<option ${f === LIST_FILTER.field ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select>
      <label><input type="checkbox" id="fflag" ${LIST_FILTER.flag ? 'checked' : ''}> 「直して」だけ</label>
      <span class="muted">${rows.length}枚</span>
    </div>
    <table>
      <thead><tr><th>最近3日の ×</th><th>分野</th><th>論点</th><th>最近3日（○ が付くまでの × の回数）</th><th>解いた日数</th></tr></thead>
      <tbody>${rows.map(c => {
        const s = st[c.id];
        return `<tr>
          <td>${scoreBadge(s)}</td>
          <td>${esc(c.subject)} › ${esc(c.field)}</td>
          <td><a href="#card/${encodeURIComponent(c.id)}">${esc(c.topic)}</a>${s.flag ? ` <span class="flag">直して</span>` : ''}</td>
          <td><div class="dates">${recentChips(s)}</div></td>
          <td>${s.history.length}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>
  `);
  document.getElementById('fs').onchange = e => { LIST_FILTER.sort = e.target.value; viewList(); };
  document.getElementById('ff').onchange = e => { LIST_FILTER.field = e.target.value; viewList(); };
  document.getElementById('fflag').onchange = e => { LIST_FILTER.flag = e.target.checked; viewList(); };
}

// ---------- 設定 ----------
function viewSettings() {
  setNav('settings');
  const s = settings();
  const ev = events();
  render(`
    <h2>設定</h2>
    <div class="panel">
      <div class="row"><label>1回に解く枚数 <input type="number" id="ps" min="1" max="500" value="${s.perSession}" style="width:5em"> 枚まで</label><span class="muted">要注意の順・まだ解いていない、のとき</span></div>
      <div class="row"><label><input type="checkbox" id="snd" ${s.sound ? 'checked' : ''}> 音を出す（さわったとき・○・×）</label></div>
      <div class="row" style="flex-wrap:wrap"><button id="t1" data-se="none">○ と演出</button><button id="t2" data-se="none">×</button><button id="t3" data-se="none">キー</button><button id="t4">ボタン</button><button id="t5" data-se="big">大きな選択</button><button id="t6" data-se="none">答え合わせ</button><button id="t7" data-se="none">解き終わり</button></div>
      <p class="muted" style="margin:0">音：効果音ラボ（${Object.keys(SE_BUF).length}/${Object.keys(SE_FILES).length} 読めた。読めない音は作った音で鳴る）</p>
      <div class="row"><label>この端末の名前 <input type="text" id="dev" value="${esc(s.device)}" style="width:8em"></label><span class="muted">記録のファイル名に使う（例：PC、iPhone）</span></div>
    </div>
    <h2>合い鍵（GitHub）</h2>
    <div class="panel">
      <div class="row"><label>リポジトリ <input type="text" id="repo" value="${esc(s.repo)}" style="width:16em" autocapitalize="off" autocorrect="off" spellcheck="false"></label></div>
      <div class="row"><label>合い鍵 <input type="password" id="tok" value="${esc(s.token)}" placeholder="github_pat_…" style="width:16em" autocomplete="off" autocapitalize="off" spellcheck="false"></label></div>
      <div class="row"><button class="primary" id="savetok" data-se="big">保存して同期</button><button id="syncnow" ${s.token ? '' : 'disabled'}>今すぐ同期</button></div>
      <p class="muted" id="syncmsg" style="margin:4px 0 0">${s.token ? esc(SYNC.state === 'err' ? `同期できない：${SYNC.msg}` : SYNC.at ? `最後に同期：${SYNC.at.toLocaleString()}` : '') : '合い鍵がないときは、このブラウザの中だけで動く（PC で試す形）'}</p>
    </div>
    <h2>記録</h2>
    <div class="panel">
      <p style="margin-top:0">このブラウザにたまっている記録：${ev.length}件</p>
      <div class="row"><button id="export">記録を書き出す（.jsonl）</button></div>
      <div class="row"><button id="wipe" style="color:var(--fix)">${s.token ? 'この端末の記録を消して、GitHub から読み直す' : '記録を全部消す'}</button></div>
      <p class="muted" style="margin:0">${s.token ? 'GitHub にある記録は消えない（消すときは AI に頼む）。この端末の中を GitHub と同じにするとき' : '試しに解いたぶんを消すとき'}</p>
    </div>
  `);
  const save = () => saveSettings(Object.assign(settings(), {
    perSession: Math.max(1, parseInt(document.getElementById('ps').value, 10) || 20),
    sound: document.getElementById('snd').checked,
    device: document.getElementById('dev').value.trim() || 'PC',
  }));
  ['ps', 'snd', 'dev'].forEach(id => document.getElementById(id).onchange = save);
  const after = () => { viewSettings(); };
  document.getElementById('savetok').onclick = async () => {
    const tok = document.getElementById('tok').value.trim(), repo = document.getElementById('repo').value.trim() || DEFAULT_REPO;
    const was = settings().token;
    saveSettings(Object.assign(settings(), { token: tok, repo }));
    if (tok && !was) {
      // 合い鍵なしで試した記録は送らない（PC の試しのぶん）。カードも GitHub から読み直す
      localStorage.removeItem(KEY_EVENTS); localStorage.removeItem(KEY_RECSHA); localStorage.removeItem(KEY_DECKS); CARDS = [];
    }
    if (!tok) { await loadCards(); return after(); }
    document.getElementById('syncmsg').textContent = '同期中…';
    await sync(); after();
  };
  document.getElementById('syncnow').onclick = async () => { document.getElementById('syncmsg').textContent = '同期中…'; await sync(); after(); };
  document.getElementById('t1').onclick = () => { SE.correct(); bigMark('o'); };
  document.getElementById('t2').onclick = () => { SE.wrong(); bigMark('x'); };
  document.getElementById('t3').onclick = () => SE.tick();
  document.getElementById('t6').onclick = () => SE.check();
  document.getElementById('t7').onclick = () => SE.finish();
  document.getElementById('export').onclick = () => {
    const blob = new Blob([ev.map(e => JSON.stringify(e)).join('\n') + (ev.length ? '\n' : '')], { type: 'application/x-ndjson' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${today()}_${settings().device}.jsonl`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  document.getElementById('wipe').onclick = async () => {
    if (!settings().token) {
      if (!confirm(`記録 ${ev.length}件を全部消す？（元に戻せない）`)) return;
      localStorage.removeItem(KEY_EVENTS); return viewSettings();
    }
    const n = ev.filter(e => e._p).length;
    if (!confirm(`この端末の記録を消して、GitHub から読み直す？${n ? `\nまだ送っていない記録 ${n}件は消える。` : ''}`)) return;
    localStorage.removeItem(KEY_EVENTS); localStorage.removeItem(KEY_RECSHA);
    document.getElementById('syncmsg').textContent = '読み直し中…';
    await sync({ cards: false }); viewSettings();
  };
}

// ---------- 画面の切り替え ----------
function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h === 'solve') return viewSolve();
  if (h.startsWith('card/')) return viewCard(h.slice(5));
  if (h === 'list') return viewList();
  if (h === 'settings') return viewSettings();
  if (SESSION && h === 'home') SESSION = null;
  return viewHome();
}
window.addEventListener('hashchange', route);

(async () => {
  if (TODAY_OVERRIDE) document.getElementById('banner').innerHTML = `<div class="banner">試しの日付：${esc(today())}（?today= を外すと今日に戻る）</div>`;
  await loadCards();
  route();
  showSync();
  if (!online()) loadSE();
  if (online()) {
    await sync();
    loadSE(); // 音は合い鍵で非公開のリポジトリから（取っておいたものがあれば、それを使う）
    const h = location.hash;
    if (!SESSION && (h === '' || h === '#home' || h === '#list')) route(); // 新しいカード・記録で出し直す
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
