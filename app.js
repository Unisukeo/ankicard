// 暗記カード
// 合い鍵（GitHub の fine-grained token）を入れると、非公開のリポジトリ（ankicard-data）の
//   cards/<科目>.json からカードを読み、記録を records/<日付>_<端末>.jsonl に足していく。
// 合い鍵がないとき（PC で試すとき）は ../data/cards/ を読み、記録はこのブラウザの中だけ。
// 記録はまずこのブラウザの中（localStorage）にため、裏で送る。解いている間は待たない。
// 2026-11-24：復習の間隔はやめた。カードごと・日ごとの「○ が付くまでに × を押した回数」で並べる。

const LOCAL_CARD_FILES = ['見本.json'];
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
      SYNC.state = navigator.onLine === false ? 'offline' : 'err';
      SYNC.msg = String(err.message || err);
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
const SE = {
  // さわったとき：ポコン
  pop() {
    const ac = ctx(); if (!ac) return;
    tone(ac, { from: 1100, to: 520, len: 0.09, vol: 0.22 });
    tone(ac, { at: 0.045, from: 700, to: 380, len: 0.11, vol: 0.16 });
  },
  // ○：ピンポーン＋キラキラ
  correct() {
    const ac = ctx(); if (!ac) return;
    tone(ac, { from: 1318.5, len: 0.35, type: 'triangle', vol: 0.3 });
    tone(ac, { at: 0.16, from: 1046.5, len: 0.6, type: 'triangle', vol: 0.3 });
    [1568, 2093, 2637, 3136, 4186].forEach((f, i) => tone(ac, { at: 0.3 + i * 0.05, from: f, len: 0.18, vol: 0.07 }));
    [523.25, 659.25, 783.99].forEach(f => tone(ac, { at: 0.16, from: f, len: 0.7, type: 'sine', vol: 0.08 }));
  },
  // ×：ブブー
  wrong() {
    const ac = ctx(); if (!ac) return;
    tone(ac, { from: 180, len: 0.16, type: 'square', vol: 0.08 });
    tone(ac, { at: 0.2, from: 150, len: 0.32, type: 'square', vol: 0.08 });
  },
};
// ボタン・リンク・チップにさわったら「ポコン」（○・× のボタンは別の音）
document.addEventListener('pointerdown', e => {
  const el = e.target.closest('button, a, summary, select, input[type=checkbox]');
  if (!el || el.dataset.se === 'none') return;
  SE.pop();
}, true);

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
    fx.innerHTML = `<div class="burst">${bits}</div><svg viewBox="0 0 200 200"><circle cx="100" cy="100" r="74"/></svg>`;
  } else {
    fx.innerHTML = `<svg viewBox="0 0 200 200"><path d="M50 50 L150 150 M150 50 L50 150"/></svg>`;
  }
  document.body.appendChild(fx);
  setTimeout(() => fx.remove(), kind === 'o' ? 900 : 600);
}

// ---------- 小物 ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const byId = id => CARDS.find(c => c.id === id);
function setNav(name) {
  document.querySelectorAll('header a').forEach(a => a.classList.toggle('on', a.dataset.nav === name));
  $view.classList.toggle('wide', name === 'list');
}
function render(html, keepScroll) { $view.innerHTML = html; if (!keepScroll) window.scrollTo(0, 0); }
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
    <div class="counts">
      <div class="count"><b>${hot}</b><span>× あり（最近3日）</span></div>
      <div class="count"><b>${fresh.length}</b><span>まだ解いていない</span></div>
      <div class="count"><b>${doneToday}</b><span>今日 ○</span></div>
    </div>
    <button class="primary big" id="attn" ${solved.length ? '' : 'disabled'}>要注意の順に解く<small>${Math.min(set.perSession, solved.length)}枚</small></button>
    ${top.length ? `<div class="toplist">${top.map(c => `<a href="#card/${encodeURIComponent(c.id)}">${scoreBadge(st[c.id])}<span class="tp">${esc(c.topic)}</span></a>`).join('')}</div>` : ''}
    <button class="big" id="fresh" ${fresh.length ? '' : 'disabled'} style="margin-top:10px">まだ解いていないのを解く<small>${Math.min(set.perSession, fresh.length)}枚</small></button>
    <h2>分野から選ぶ</h2>
    ${fieldTree(st)}
    ${flagged.length ? `<button class="chip" id="flagged" style="margin-top:4px">「直して」を付けたカードを解く<small>${flagged.length}</small></button>` : ''}
    <p class="muted">カード ${CARDS.length}枚 ・ 1回に ${set.perSession}枚まで ・ 今日 ${md(today())}</p>
  `);
  document.getElementById('attn').onclick = () => startSession('要注意の順', solved.slice(0, set.perSession));
  document.getElementById('fresh').onclick = () => startSession('まだ解いていない', fresh.slice(0, set.perSession));
  const fb = document.getElementById('flagged');
  if (fb) fb.onclick = () => startSession('「直して」', flagged.sort(byAttention(st)));
  bindTreeToggles();
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
          <button class="solve-field" data-subject="${esc(subj)}" data-field="${esc(field)}">「${esc(field)}」を解く（${cards.length}枚）</button>
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
function startSession(label, list) {
  if (!list.length) return;
  SESSION = { label, queue: list.map(c => ({ id: c.id, again: false })), pos: 0, shown: false, o: 0, x: 0, total: list.length, busy: false };
  location.hash = '#solve';
}
function viewSolve() {
  setNav('');
  if (!SESSION) return (location.hash = '#home');
  const S = SESSION;
  if (S.pos >= S.queue.length) {
    render(`<div class="panel done">
      <div class="big-mark">○</div>
      <p><b>「${esc(S.label)}」おわり</b></p>
      <p class="muted">${S.total}枚 ・ 1回目で ○ ${S.o}枚 ・ × のあと やり直し ${S.x}枚</p>
      <a class="btn primary" href="#home">ホームへ</a>
    </div>`);
    SESSION = null; if (online()) sync({ cards: false }); return;
  }
  const item = S.queue[S.pos], c = byId(item.id);
  const s = state()[c.id];
  const n = c.show_count ? `（${c.items.length}つ）` : '';
  render(`
    <div class="progress"><span>${esc(S.label)}</span><span>のこり ${S.queue.length - S.pos}枚</span></div>
    <div class="qcard" id="qcard">
      <div class="meta">${esc(c.subject)} › ${esc(c.field)} › <b>${esc(c.topic)}</b>${item.again ? '<span class="retry-tag">やり直し</span>' : ''}</div>
      <div class="q">${esc(c.question)}<span class="n">${n}</span></div>
      <div class="dates" style="margin-top:8px">${s.solved ? recentChips(s) : '<span class="muted">はじめて</span>'}</div>
      <div id="ans" ${S.shown ? '' : 'hidden'}>
        <ol class="items">${c.items.map(it => `<li>${esc(it.text)}${it.basis ? `<span class="basis">${esc(it.basis)}</span>` : ''}</li>`).join('')}</ol>
        ${c.memo ? `<div class="memo">${esc(c.memo)}</div>` : ''}
      </div>
    </div>
    <div id="bar">
      ${S.shown
        ? `<div class="answer-bar"><button class="o" id="bo" data-se="none">○<small>全部わかった</small></button><button class="x" id="bx" data-se="none">×<small>1つでもわからない</small></button></div>`
        : `<button class="primary big" id="show" style="margin-top:16px">答えを見る</button>`}
    </div>
    <div class="keys">${S.shown ? '○ … 1 か O ／ × … 2 か X' : '答えを見る … スペース'}</div>
    <div class="subacts"><a href="#home" id="quit">やめる</a><a href="#card/${encodeURIComponent(c.id)}">このカードの記録・「直して」</a></div>
  `);
  const show = document.getElementById('show');
  if (show) show.onclick = () => { S.shown = true; viewSolve(); };
  const bo = document.getElementById('bo'), bx = document.getElementById('bx');
  if (bo) bo.onclick = () => answer('o');
  if (bx) bx.onclick = () => answer('x');
  document.getElementById('quit').onclick = () => { SESSION = null; };
}
function answer(result) {
  const S = SESSION; if (!S || !S.shown || S.busy) return;
  const item = S.queue[S.pos];
  addEvent({ type: 'answer', card: item.id, result, mode: S.label });
  if (result === 'o') {
    SE.correct(); bigMark('o');
    if (!item.again) S.o++;
  } else {
    SE.wrong(); bigMark('x');
    document.getElementById('qcard')?.classList.add('shake');
    if (!item.again) S.x++;
    S.queue.push({ id: item.id, again: true }); // ○ が付くまで、最後にもう1回
  }
  // 演出を少し見せてから次へ
  S.busy = true;
  setTimeout(() => { S.busy = false; S.pos++; S.shown = false; viewSolve(); }, result === 'o' ? 450 : 380);
}
document.addEventListener('keydown', e => {
  if (location.hash !== '#solve' || !SESSION || e.ctrlKey || e.metaKey || e.altKey) return;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
  const k = e.key.toLowerCase();
  if (!SESSION.shown && (k === ' ' || k === 'enter')) { e.preventDefault(); SE.pop(); SESSION.shown = true; viewSolve(); }
  else if (SESSION.shown && (k === '1' || k === 'o')) { e.preventDefault(); answer('o'); }
  else if (SESSION.shown && (k === '2' || k === 'x')) { e.preventDefault(); answer('x'); }
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
      <div class="row"><button id="t1" data-se="none">○ の音と演出</button><button id="t2" data-se="none">× の音</button><button id="t3">ポコン</button></div>
      <div class="row"><label>この端末の名前 <input type="text" id="dev" value="${esc(s.device)}" style="width:8em"></label><span class="muted">記録のファイル名に使う（例：PC、iPhone）</span></div>
    </div>
    <h2>合い鍵（GitHub）</h2>
    <div class="panel">
      <div class="row"><label>リポジトリ <input type="text" id="repo" value="${esc(s.repo)}" style="width:16em" autocapitalize="off" autocorrect="off" spellcheck="false"></label></div>
      <div class="row"><label>合い鍵 <input type="password" id="tok" value="${esc(s.token)}" placeholder="github_pat_…" style="width:16em" autocomplete="off" autocapitalize="off" spellcheck="false"></label></div>
      <div class="row"><button class="primary" id="savetok">保存して同期</button><button id="syncnow" ${s.token ? '' : 'disabled'}>今すぐ同期</button></div>
      <p class="muted" id="syncmsg" style="margin:4px 0 0">${s.token ? esc(SYNC.state === 'err' ? `同期できない：${SYNC.msg}` : SYNC.at ? `最後に同期：${SYNC.at.toLocaleString()}` : '') : '合い鍵がないときは、このブラウザの中だけで動く（PC で試す形）'}</p>
    </div>
    <h2>記録</h2>
    <div class="panel">
      <p style="margin-top:0">このブラウザにたまっている記録：${ev.length}件</p>
      <div class="row"><button id="export">記録を書き出す（.jsonl）</button></div>
      <div class="row"><button id="wipe" style="color:var(--fix)">記録を全部消す</button><span class="muted">試しに解いたぶんを消すとき</span></div>
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
  document.getElementById('export').onclick = () => {
    const blob = new Blob([ev.map(e => JSON.stringify(e)).join('\n') + (ev.length ? '\n' : '')], { type: 'application/x-ndjson' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${today()}_${settings().device}.jsonl`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  document.getElementById('wipe').onclick = () => {
    if (!confirm(`記録 ${ev.length}件を全部消す？（元に戻せない）`)) return;
    localStorage.removeItem(KEY_EVENTS); viewSettings();
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
  if (online()) {
    await sync();
    const h = location.hash;
    if (!SESSION && (h === '' || h === '#home' || h === '#list')) route(); // 新しいカード・記録で出し直す
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
