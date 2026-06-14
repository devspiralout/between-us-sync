// ————————————————————————————————————————————————
// BETWEEN US — synced edition
// Two phones, one room. State lives in Firestore and updates
// live on both devices. Each phone knows which partner it
// belongs to, so sealed answers are never shown to the other.
// ————————————————————————————————————————————————
/* global window, document, localStorage, crypto */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  initializeFirestore, persistentLocalCache,
  doc, getDoc, setDoc, updateDoc, onSnapshot, runTransaction,
  arrayUnion, arrayRemove,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const { Q, TOTAL, THEMES } = window;
const app = document.getElementById("app");
const LOCAL_KEY = "between-us:sync"; // { code, who } — this device's identity only

// ——— helpers ———
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const dayBefore = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
};
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// room codes: 12 chars, unambiguous alphabet, shown in groups of 4
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const makeCode = () => {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
};
const prettyCode = (c) => c.replace(/(.{4})(?=.)/g, "$1-");
const cleanCode = (c) => c.toLowerCase().replace(/[^a-z0-9]/g, "");

function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

// ——— firebase ———
const configured = firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("PASTE");
let db = null;
if (configured) {
  const fbApp = initializeApp(firebaseConfig);
  db = initializeFirestore(fbApp, { localCache: persistentLocalCache() });
}

// ——— state ———
let local = null; // { code, who: 'a'|'b' }
try { local = JSON.parse(localStorage.getItem(LOCAL_KEY)); } catch (e) { /* none yet */ }
let state = null;          // live room document
let unsubscribe = null;
let ui = { view: "today", picking: false, drawingMore: false, editing: false, justRevealed: false, joinStep: null, joinNames: null, joinCode: null, online: true };

const roomRef = () => doc(db, "rooms", local.code);

function subscribe() {
  if (unsubscribe) unsubscribe();
  unsubscribe = onSnapshot(roomRef(), { includeMetadataChanges: true }, (snap) => {
    if (!snap.exists()) {
      toast("This room no longer exists.");
      leaveRoom();
      return;
    }
    state = snap.data();
    ui.online = !snap.metadata.fromCache;
    healReveals();
    render();
  }, (err) => {
    console.error(err);
    toast("Lost connection to the room — check SETUP.md step 3 (rules) if this persists.");
  });
}

// if both answers exist but revealed never got set (e.g. both sealed at the
// same moment on different phones), either device repairs it
function healReveals() {
  for (const [qid, n] of Object.entries(state.notes || {})) {
    if (n && n.a && n.b && !n.revealed) {
      updateDoc(roomRef(), { [`notes.${qid}.revealed`]: true }).catch(() => {});
    }
  }
}

function leaveRoom() {
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  local = null;
  state = null;
  localStorage.removeItem(LOCAL_KEY);
  ui = { ...ui, view: "today", joinStep: null, editing: false };
  render();
}

// ——— actions (all writes go to Firestore; the snapshot re-renders) ———
async function createRoom(nameA, nameB, who) {
  const code = makeCode();
  const fresh = {
    names: { a: nameA, b: nameB },
    order: shuffle(Q.map((q) => q.id)),
    pos: 0,
    cycle: 1,
    today: { date: todayKey(), cards: [] },
    streak: { count: 0, last: null },
    favs: [],
    notes: {},
    created: todayKey(),
  };
  try {
    await setDoc(doc(db, "rooms", code), fresh);
    local = { code, who };
    localStorage.setItem(LOCAL_KEY, JSON.stringify(local));
    ui.joinStep = "share"; // show the code once, prominently
    subscribe();
  } catch (e) {
    console.error(e);
    toast("Couldn't create the room — is your Firebase config and rules set up? (SETUP.md)");
  }
}

async function lookupRoom(code) {
  try {
    const snap = await getDoc(doc(db, "rooms", code));
    if (!snap.exists()) {
      toast("No room with that code — check it character by character.");
      return;
    }
    ui.joinCode = code;
    ui.joinNames = snap.data().names;
    ui.joinStep = "whoami";
    render();
  } catch (e) {
    console.error(e);
    toast("Couldn't reach the room — are you online?");
  }
}

function joinAs(who) {
  local = { code: ui.joinCode, who };
  localStorage.setItem(LOCAL_KEY, JSON.stringify(local));
  ui.joinStep = null;
  subscribe();
}

async function reveal(theme) {
  ui.picking = false;
  ui.drawingMore = false;
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(roomRef());
      const s = snap.data();
      const t = todayKey();
      let { order, pos, cycle } = s;
      const today = (s.today && s.today.date === t) ? s.today : { date: t, cards: [] };
      if (pos >= order.length) {
        order = shuffle(Q.map((q) => q.id));
        pos = 0;
        cycle += 1;
      }
      if (theme) {
        const idx = order.slice(pos).findIndex((id) => Q[id].theme === theme);
        if (idx > 0) {
          order = [...order];
          const [picked] = order.splice(pos + idx, 1);
          order.splice(pos, 0, picked);
        }
      }
      const qid = order[pos];
      pos += 1;
      let streak = s.streak;
      if (streak.last !== t) {
        streak = { count: streak.last === dayBefore(t) ? streak.count + 1 : 1, last: t };
      }
      tx.update(roomRef(), { order, pos, cycle, streak, today: { date: t, cards: [...today.cards, qid] } });
    });
    ui.justRevealed = true;
  } catch (e) {
    console.error(e);
    toast("Couldn't draw a question — you need to be online for this one.");
  }
}

async function sealAnswer(qid, text) {
  try {
    await updateDoc(roomRef(), { [`notes.${qid}.${local.who}`]: text.trim() });
    ui.editing = false;
  } catch (e) {
    console.error(e);
    toast("Couldn't seal the answer — it's still in the box, try again.");
    return;
  }
  render();
}

async function revealEarly(qid) {
  try {
    await updateDoc(roomRef(), { [`notes.${qid}.revealed`]: true });
  } catch (e) { toast("Couldn't open it just now — try again."); }
}

async function toggleFav(id) {
  const op = (state.favs || []).includes(id) ? arrayRemove(id) : arrayUnion(id);
  try {
    await updateDoc(roomRef(), { favs: op });
  } catch (e) { toast("Couldn't update kept questions — try again."); }
}

// ——— templates ———
const heartSvg = (filled) => `
  <svg width="20" height="20" viewBox="0 0 24 24" fill="${filled ? "var(--rose)" : "none"}"
       stroke="${filled ? "var(--rose)" : "var(--faded)"}" stroke-width="1.6" aria-hidden="true">
    <path d="M12 21s-7.5-4.9-10-9.6C.4 8 2.3 4.5 5.8 4.1c2-.2 3.9.8 5 2.5h2.4c1.1-1.7 3-2.7 5-2.5 3.5.4 5.4 3.9 3.8 7.3C19.5 16.1 12 21 12 21z" transform="scale(.92) translate(1,0)"/>
  </svg>`;

const wordsHtml = (text) =>
  text.split(" ").map((w, i) =>
    `<span class="word" style="animation-delay:${(0.15 + i * 0.05).toFixed(2)}s">${esc(w)}&nbsp;</span>`
  ).join("");

const chipsHtml = (action) =>
  `<div class="chips rise">` +
  Object.entries(THEMES).map(([key, t]) =>
    `<button class="chip" data-action="${action}" data-theme="${key}"
       style="border:1px solid ${t.color}44; color:${t.color}">${esc(t.label)}</button>`
  ).join("") +
  `</div>`;

function answersHtml(qid) {
  const me = local.who;
  const them = me === "a" ? "b" : "a";
  const myName = state.names[me];
  const theirName = state.names[them];
  const myColor = me === "a" ? "var(--amber)" : "var(--rose)";
  const theirColor = me === "a" ? "var(--rose)" : "var(--amber)";
  const n = (state.notes || {})[qid] || {};

  // writing mode (always writing as yourself on this device)
  if (ui.editing === qid) {
    return `
      <div class="rise">
        <p class="player-label" style="color:var(--amber); margin-bottom:8px">Just you — ${esc(theirName)} can't see this yet</p>
        <textarea id="draft-${qid}" rows="4"
          placeholder="Sealed until you've both answered…">${esc(n[me] || "")}</textarea>
        <div style="display:flex; gap:12px; margin-top:10px; align-items:center">
          <button class="btn-small seal-action" data-action="seal" data-qid="${qid}">Seal your answer</button>
          <button class="btn-ghost" data-action="cancel-edit">cancel</button>
        </div>
      </div>`;
  }

  // revealed — both open
  if (n.revealed) {
    const block = (p, name, color, mine) =>
      n[p]
        ? `<div class="answer-block">
             <div class="answer-head">
               <span class="player-label" style="color:${color}">${esc(name)}</span>
               ${mine ? `<button class="btn-ghost" style="font-size:11.5px" data-action="edit" data-qid="${qid}">edit</button>` : ""}
             </div>
             <p class="answer-text">${esc(n[p])}</p>
           </div>`
        : `<div class="answer-block">
             <span class="player-label" style="color:var(--dim)">${esc(name)}</span><br>
             ${mine
               ? `<button class="btn-ghost" style="margin-top:4px" data-action="edit" data-qid="${qid}">✎ add yours anyway</button>`
               : `<p class="hint" style="margin-top:4px">hasn't written one</p>`}
           </div>`;
    return block(me, myName, myColor, true) + block(them, theirName, theirColor, false);
  }

  // sealed / waiting
  const mine = n[me]
    ? `<button class="btn-small sealed" data-action="edit" data-qid="${qid}" title="Rewrite your sealed answer">✓ You've answered — sealed</button>`
    : `<button class="btn-small" data-action="edit" data-qid="${qid}">Write your answer</button>`;
  const theirs = n[them]
    ? `<span class="btn-small sealed" style="cursor:default">✓ ${esc(theirName)} has answered</span>`
    : `<span class="btn-small" style="cursor:default; opacity:.55">${esc(theirName)} hasn't yet</span>`;
  const early = n[me] && !n[them]
    ? `<button class="btn-ghost" style="margin-top:10px" data-action="reveal-early" data-qid="${qid}">open with just your answer</button>` : "";
  return `
    <p class="hint">You each answer on your own phone — answers stay sealed until you've both written, then open together.</p>
    <div style="display:flex; gap:10px; flex-wrap:wrap">${mine}${theirs}</div>
    ${early}`;
}

function cardHtml(q, animate) {
  const t = THEMES[q.theme];
  const fav = (state.favs || []).includes(q.id);
  return `
    <div class="qcard rise">
      <div class="top">
        <span class="eyebrow" style="color:${t.color}">${esc(t.label)}</span>
        <button class="heart-btn" data-action="fav" data-qid="${q.id}"
          aria-label="${fav ? "Remove from kept questions" : "Keep this question"}">${heartSvg(fav)}</button>
      </div>
      <p class="qtext">${animate ? wordsHtml(q.text) : esc(q.text)}</p>
      <div class="answers">${answersHtml(q.id)}</div>
    </div>`;
}

// ——— screens ———
function configMissingView() {
  return `
    <div class="setup-wrap">
      <div class="setup rise">
        <h1 class="bu-serif">Between Us</h1>
        <p>One step left: this synced edition needs your Firebase project's config pasted into
        <strong>firebase-config.js</strong>. Open <strong>SETUP.md</strong> in this folder —
        it's about five minutes of clicking, all free.</p>
      </div>
    </div>`;
}

function welcomeView() {
  if (ui.joinStep === "create") {
    return `
      <div class="setup-wrap">
        <div class="setup rise">
          <h1 class="bu-serif">Start your room</h1>
          <p>Enter both names, then say which one is you — this phone will be theirs.</p>
          <label class="player-label" style="color:var(--amber)">First name</label>
          <input type="text" id="name-a" placeholder="e.g. Sam" autocomplete="off">
          <label class="player-label" style="color:var(--rose)">Second name</label>
          <input type="text" id="name-b" placeholder="e.g. Alex" autocomplete="off">
          <label class="player-label" style="color:var(--faded)">This phone belongs to</label>
          <div style="display:flex; gap:10px; margin-top:4px">
            <button class="btn-small" id="who-a" data-action="pick-who" data-who="a">the first</button>
            <button class="btn-small" id="who-b" data-action="pick-who" data-who="b">the second</button>
          </div>
          <button class="btn-primary" data-action="create-room">Create our room</button>
          <button class="btn-ghost" style="display:block; margin:14px auto 0" data-action="back-welcome">back</button>
        </div>
      </div>`;
  }
  if (ui.joinStep === "join") {
    return `
      <div class="setup-wrap">
        <div class="setup rise">
          <h1 class="bu-serif">Join your room</h1>
          <p>Type the code from your partner's phone (dashes optional).</p>
          <label class="player-label" style="color:var(--amber)">Room code</label>
          <input type="text" id="join-code" placeholder="xxxx-xxxx-xxxx" autocomplete="off" autocapitalize="off">
          <button class="btn-primary" data-action="lookup">Find the room</button>
          <button class="btn-ghost" style="display:block; margin:14px auto 0" data-action="back-welcome">back</button>
        </div>
      </div>`;
  }
  if (ui.joinStep === "whoami") {
    return `
      <div class="setup-wrap">
        <div class="setup rise">
          <h1 class="bu-serif">Found it.</h1>
          <p>And which one are you?</p>
          <div style="display:flex; gap:10px; margin-top:4px">
            <button class="btn-small" data-action="join-as" data-who="a">I'm ${esc(ui.joinNames.a)}</button>
            <button class="btn-small" data-action="join-as" data-who="b">I'm ${esc(ui.joinNames.b)}</button>
          </div>
          <button class="btn-ghost" style="display:block; margin:18px auto 0" data-action="back-welcome">back</button>
        </div>
      </div>`;
  }
  return `
    <div class="setup-wrap">
      <div class="setup rise">
        <h1 class="bu-serif">Between Us</h1>
        <p>One question a day. You each answer on your own phone — answers stay sealed
        until you've both written, then open together, wherever you are.</p>
        <button class="btn-primary" data-action="show-create">Start a new room</button>
        <button class="btn-small" style="width:100%; margin-top:12px; padding:12px 0" data-action="show-join">Join with a code</button>
      </div>
    </div>`;
}

function shareCodeView() {
  return `
    <div class="setup-wrap">
      <div class="setup rise" style="text-align:center">
        <h1 class="bu-serif">Your room is ready.</h1>
        <p>Have ${esc(state.names[local.who === "a" ? "b" : "a"])} open the app on their phone,
        tap "Join with a code", and enter:</p>
        <p class="bu-serif" style="font-size:28px; font-style:normal; letter-spacing:0.08em; color:var(--amber); margin:6px 0 4px">${prettyCode(local.code)}</p>
        <button class="btn-ghost" data-action="copy-code">copy code</button>
        <p style="margin-top:18px">This code is the key to the room — share it only with them.
        It also lives at the bottom of the app if you need it again.</p>
        <button class="btn-primary" data-action="dismiss-share">To today's question</button>
      </div>
    </div>`;
}

function todayView() {
  const t = todayKey();
  const cards = (state.today && state.today.date === t) ? state.today.cards : [];
  if (cards.length === 0) {
    return `
      <div class="waiting">
        <div class="glow" aria-hidden="true"></div>
        <p class="lead bu-serif">Today's question is waiting.</p>
        <p class="count">Question ${Math.min(state.pos + 1, TOTAL)} of ${TOTAL}${state.cycle > 1 ? ` · round ${state.cycle}` : ""}</p>
        ${ui.picking
          ? chipsHtml("reveal-theme") +
            `<button class="btn-ghost" style="font-size:13px; margin-top:16px" data-action="stop-picking">never mind — surprise us</button>`
          : `<div class="actions">
               <button class="btn-primary" data-action="reveal">Turn the card over</button>
               <button class="btn-ghost" style="font-size:13px" data-action="start-picking">or choose tonight's theme</button>
             </div>`}
      </div>`;
  }
  const cardsHtml = cards.map((id, i) =>
    cardHtml(Q[id], ui.justRevealed && i === cards.length - 1)
  ).join("");
  const more = ui.drawingMore
    ? `<p class="hint" style="margin:4px 0 0">From anywhere, or a theme?</p>
       <div style="margin-top:10px"><button class="btn-small" data-action="reveal">Surprise us</button></div>
       ${chipsHtml("reveal-theme")}
       <button class="btn-ghost" style="margin-top:14px" data-action="stop-drawing">actually, this is enough for tonight</button>`
    : `<button class="btn-outline" data-action="start-drawing">Draw another</button>`;
  return `
    ${cardsHtml}
    <div class="center">
      ${more}
      <p class="progress-line">${state.pos} of ${TOTAL} asked${state.cycle > 1 ? ` · round ${state.cycle}` : ""} — no repeats until you've heard them all</p>
    </div>`;
}

function keptView() {
  const favs = state.favs || [];
  if (favs.length === 0) {
    return `
      <div class="empty">
        <p class="lead bu-serif">Nothing kept yet.</p>
        <p>Tap the heart on a question that lands, and it will live here — on both your phones.</p>
      </div>`;
  }
  return favs.map((id) => cardHtml(Q[id], false)).join("");
}

function render() {
  if (!configured) { app.innerHTML = configMissingView(); return; }
  if (!local) { app.innerHTML = welcomeView(); return; }
  if (!state) {
    app.innerHTML = `<div class="setup-wrap"><p class="bu-serif" style="font-style:italic; font-size:18px; color:var(--dim)">finding your room…</p></div>`;
    return;
  }
  if (ui.joinStep === "share") { app.innerHTML = shareCodeView(); return; }

  const streak = state.streak.count > 0
    ? `<span class="streak">✦ ${state.streak.count} ${state.streak.count === 1 ? "day" : "days"} in a row</span>` : "";
  const keptLabel = `Kept${(state.favs || []).length ? ` · ${state.favs.length}` : ""}`;
  app.innerHTML = `
    <header>
      <h1>Between Us</h1>
      ${streak}
    </header>
    <nav>
      <button class="${ui.view === "today" ? "active" : ""}" data-action="nav" data-view="today">Today</button>
      <button class="${ui.view === "kept" ? "active" : ""}" data-action="nav" data-view="kept">${keptLabel}</button>
    </nav>
    <main>${ui.view === "today" ? todayView() : keptView()}</main>
    <p class="progress-line" style="margin:0 0 18px">
      ${ui.online ? "" : "offline — changes will sync when you're back · "}you're ${esc(state.names[local.who])} · room ${prettyCode(local.code)} ·
      <button class="btn-ghost" style="font-size:11.5px" data-action="leave">leave on this phone</button>
    </p>`;
  const ta = app.querySelector("textarea");
  if (ta && ui.editing !== false) ta.focus();
}

// ——— events ———
app.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const { action, qid, theme, view, who } = btn.dataset;
  switch (action) {
    case "show-create": ui.joinStep = "create"; ui.pickedWho = "a"; render(); markWho(); break;
    case "show-join": ui.joinStep = "join"; render(); break;
    case "back-welcome": ui.joinStep = null; render(); break;
    case "pick-who": ui.pickedWho = who; markWho(); break;
    case "create-room": {
      const a = document.getElementById("name-a").value.trim() || "Player one";
      const b = document.getElementById("name-b").value.trim() || "Player two";
      createRoom(a, b, ui.pickedWho || "a");
      break;
    }
    case "lookup": lookupRoom(cleanCode(document.getElementById("join-code").value)); break;
    case "join-as": joinAs(who); break;
    case "copy-code": navigator.clipboard?.writeText(prettyCode(local.code)).then(() => toast("Copied.")); break;
    case "dismiss-share": ui.joinStep = null; render(); break;
    case "leave":
      if (window.confirm("Disconnect this phone from the room? Your shared answers stay safe in the room — you can rejoin with the code.")) leaveRoom();
      break;
    case "nav": ui.view = view; ui.editing = false; ui.justRevealed = false; render(); break;
    case "reveal": reveal(); break;
    case "reveal-theme": reveal(theme); break;
    case "start-picking": ui.picking = true; render(); break;
    case "stop-picking": ui.picking = false; render(); break;
    case "start-drawing": ui.drawingMore = true; ui.justRevealed = false; render(); break;
    case "stop-drawing": ui.drawingMore = false; render(); break;
    case "fav": toggleFav(Number(qid)); break;
    case "edit": ui.editing = Number(qid); ui.justRevealed = false; render(); break;
    case "cancel-edit": ui.editing = false; render(); break;
    case "seal": {
      const text = document.getElementById(`draft-${qid}`).value;
      if (!text.trim()) return;
      sealAnswer(Number(qid), text);
      break;
    }
    case "reveal-early": revealEarly(Number(qid)); break;
  }
});

function markWho() {
  const a = document.getElementById("who-a");
  const b = document.getElementById("who-b");
  if (!a || !b) return;
  a.classList.toggle("sealed", ui.pickedWho === "a");
  b.classList.toggle("sealed", ui.pickedWho !== "a");
}

// roll the day over when the app returns from the background
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state) { ui.justRevealed = false; render(); }
});

// ——— boot ———
if (configured && local) subscribe();
render();
