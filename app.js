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
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut as fbSignOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getMessaging, getToken, isSupported as messagingSupported,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";
import { firebaseConfig, vapidKey } from "./firebase-config.js";

const { Q, QById, TOTAL, THEMES } = window;
const SCHEMA = 2; // 2 = stable text-hash question ids (1 = legacy positional ints)
const DAILY_LIMIT = 3; // questions you can draw/answer per day
const app = document.getElementById("app");
const LOCAL_KEY = "between-us:sync"; // { code, who } — this device's identity only

// ——— helpers ———
// The "day" is anchored to the room's home timezone (set by whoever created it),
// so two partners in different timezones always agree on what today's question is
// and when the day rolls over — instead of each device using its own local date.
const localTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return "UTC"; } };
const roomTz = () => (state && state.tz) || localTz();
const dateKeyInTz = (ms, tz) => {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
  } catch (e) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
};
const todayKey = () => dateKeyInTz(Date.now(), roomTz());
const dateKeyOf = (ms) => dateKeyInTz(ms, roomTz());
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
const pushConfigured = vapidKey && !vapidKey.startsWith("PASTE");
let db = null, auth = null, messaging = null;
const provider = new GoogleAuthProvider();
if (configured) {
  const fbApp = initializeApp(firebaseConfig);
  db = initializeFirestore(fbApp, { localCache: persistentLocalCache() });
  auth = getAuth(fbApp);
  // notifications are optional and not supported everywhere — set up lazily
  if (pushConfigured) {
    messagingSupported().then((ok) => {
      if (ok) { try { messaging = getMessaging(fbApp); render(); } catch (e) { console.error(e); } }
    }).catch(() => {});
  }
}

// ——— state ———
let local = null;          // { code, who: 'a'|'b' } — this device's room + identity
let state = null;          // live room document
let unsubscribe = null;
let user = null;           // signed-in Google account (null = signed out)
let authReady = false;     // has Firebase reported the initial auth state yet?
let roomResolved = false;  // have we finished deciding which room this account is in?
let pendingRoom = null;    // a code from a ?room= link, waiting for sign-in
let ui = { view: "today", picking: false, pickMode: "draw", editing: false, joinStep: null, joinNames: null, joinCode: null, online: true };
let lastSig = null; // signature of the last thing we rendered, to skip no-op re-renders
let editDraft = null; // { qid, text } — an in-progress answer, kept alive across re-renders
const seenCards = new Set(); // today's card ids we've already shown, so each animates in only once

const roomRef = () => doc(db, "rooms", local.code);
const userRef = () => doc(db, "users", user.uid); // account → room mapping
const readLocal = () => { try { return JSON.parse(localStorage.getItem(LOCAL_KEY)); } catch (e) { return null; } };

function subscribe() {
  if (unsubscribe) unsubscribe();
  unsubscribe = onSnapshot(roomRef(), { includeMetadataChanges: true }, (snap) => {
    if (!snap.exists()) {
      toast("This room no longer exists.");
      exitRoom();
      return;
    }
    state = snap.data();
    ui.online = !snap.metadata.fromCache;
    // A room from before stable ids stores everything under positional ints, which
    // this version can't index. Convert it once (needs a connection), and hold the
    // room screen back until it's done so nobody writes a mix of old & new ids.
    if ((state.schema || 1) < SCHEMA) {
      migrateToStableIds();
      app.innerHTML = `<div class="setup-wrap"><p class="bu-serif" style="font-style:italic; font-size:18px; color:var(--dim)">Updating your room… this takes a moment and needs a connection.</p></div>`;
      return;
    }
    // The creator waits on the share-code screen; the moment their partner joins
    // (fills in their name) drop them straight into the room too.
    if (ui.joinStep === "share" && state.names && state.names.b) {
      ui.joinStep = null;
      toast(`${state.names.b} joined — you're connected.`);
    }
    // Backfill a home timezone on rooms created before this existed — only the
    // creator writes it, so the two devices can't set conflicting values.
    if (!state.tz && local && local.who === "a") {
      updateDoc(roomRef(), { tz: localTz() }).catch(() => {});
    }
    render();
  }, (err) => {
    console.error(err);
    toast("Lost connection to the room — check SETUP.md step 3 (rules) if this persists.");
  });
}

// One-time upgrade for rooms created before stable ids: positional int id `i` is
// exactly the question at index i in the (unchanged) bank, so Q[i].id is its new
// stable id. Done in a transaction guarded by the schema field so two phones can't
// double-run it; if offline/contended it simply retries on the next snapshot.
async function migrateToStableIds() {
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(roomRef());
      if (!snap.exists()) return;
      const s = snap.data();
      if ((s.schema || 1) >= SCHEMA) return; // already migrated by the other device
      const idOf = (i) => (Q[i] ? Q[i].id : null);
      const notes = {};
      for (const [k, v] of Object.entries(s.notes || {})) {
        const id = idOf(Number(k));
        if (id) notes[id] = v;
      }
      const favs = [...new Set((s.favs || []).map(idOf).filter(Boolean))];
      const order = (s.order || []).map(idOf).filter(Boolean);
      const today = s.today || { date: todayKey(), cards: [] };
      const cards = (today.cards || []).map(idOf).filter(Boolean);
      tx.update(roomRef(), { notes, favs, order, today: { ...today, cards }, schema: SCHEMA });
    });
  } catch (e) {
    console.error("id migration deferred (will retry on next sync):", e);
  }
}

// ——— auth ———
function signIn(btn) {
  return withBusy(btn, async () => {
    try {
      await signInWithPopup(auth, provider); // onAuthStateChanged takes it from here
    } catch (e) {
      console.error(e);
      // closing the popup or double-tapping isn't really an error — stay quiet
      if (e.code === "auth/popup-closed-by-user" || e.code === "auth/cancelled-popup-request") return;
      // surface the actual Firebase reason so setup issues are diagnosable
      toast(`Sign-in failed: ${e.code || e.message || "unknown error"}`);
    }
  });
}

async function signOutUser() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  local = null; state = null; roomResolved = false; seenCards.clear();
  localStorage.removeItem(LOCAL_KEY);
  try { await fbSignOut(auth); } catch (e) { console.error(e); }
  render();
}

// link (or unlink) the signed-in account to a room, so any device they sign in on
// lands straight back in it — this is what removes the "remember the code" burden.
async function rememberRoom(code, who) {
  if (!user) return;
  try { await setDoc(userRef(), { room: code, who }); }
  catch (e) { console.error("couldn't link room to account:", e); }
}

// Decide what to show whenever the auth state settles or changes.
async function resolveAuth() {
  if (!user) { // signed out → clear everything, the gate renders
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    local = null; state = null; roomResolved = false; seenCards.clear();
    render();
    return;
  }
  if (local && unsubscribe) { roomResolved = true; render(); return; } // already in a room

  // 1) does this account already point at a room?
  try {
    const snap = await getDoc(userRef());
    if (snap.exists() && snap.data().room) {
      local = { code: snap.data().room, who: snap.data().who || "a" };
      localStorage.setItem(LOCAL_KEY, JSON.stringify(local));
      roomResolved = true;
      subscribe();
      render();
      return;
    }
  } catch (e) { console.error("room lookup failed:", e); }

  // 2) a device that used the app before accounts existed — adopt its saved room
  const legacy = readLocal();
  if (legacy && legacy.code) {
    local = legacy;
    roomResolved = true;
    rememberRoom(legacy.code, legacy.who || "a");
    subscribe();
    render();
    return;
  }

  // 3) arrived via a join link → go into the join flow now that we're signed in
  roomResolved = true;
  if (pendingRoom) {
    const code = pendingRoom; pendingRoom = null;
    lookupRoom(code);
    return;
  }
  // 4) brand new account, no room → show create / join
  render();
}

// the room was deleted out from under us (e.g. from the Firebase console):
// drop the account link so we stop trying to load it, and return to the welcome
async function exitRoom() {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  local = null; state = null; roomResolved = true; seenCards.clear();
  localStorage.removeItem(LOCAL_KEY);
  if (user) { try { await setDoc(userRef(), { room: null, who: null }); } catch (e) {} }
  ui = { ...ui, view: "today", joinStep: null, editing: false };
  render();
}

// ——— actions (all writes go to Firestore; the snapshot re-renders) ———
async function createRoom(name) {
  const code = makeCode();
  const fresh = {
    names: { a: name, b: "" }, // partner fills in their own name when they join
    order: shuffle(Q.map((q) => q.id)),
    pos: 0,
    cycle: 1,
    today: { date: todayKey(), cards: [] },
    streak: { count: 0, last: null },
    favs: [],
    notes: {},
    created: todayKey(),
    schema: SCHEMA,
    tz: localTz(), // the room's home timezone — anchors "today" for both partners
  };
  try {
    await setDoc(doc(db, "rooms", code), fresh);
    local = { code, who: "a" };
    localStorage.setItem(LOCAL_KEY, JSON.stringify(local));
    roomResolved = true;
    rememberRoom(code, "a"); // tie this room to the creator's account
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
    // fresh room: partner slot still empty → newcomer just names themselves (they're b).
    // already-claimed room: this is someone re-joining → let them pick which one they are.
    ui.joinStep = ui.joinNames.b ? "whoami" : "name";
    render();
  } catch (e) {
    console.error(e);
    toast("Couldn't reach the room — are you online?");
  }
}

function joinAs(who) {
  local = { code: ui.joinCode, who };
  localStorage.setItem(LOCAL_KEY, JSON.stringify(local));
  roomResolved = true;
  rememberRoom(ui.joinCode, who);
  ui.joinStep = null;
  subscribe();
  render(); // show "finding your room…" right away while the first snapshot loads
}

// newcomer joining a fresh room: they take slot b and write their own name
async function joinAsNew(name) {
  try {
    await updateDoc(doc(db, "rooms", ui.joinCode), { "names.b": name.trim() || "Your partner" });
  } catch (e) {
    console.error(e);
    toast("Couldn't save your name — try again.");
    return;
  }
  local = { code: ui.joinCode, who: "b" };
  localStorage.setItem(LOCAL_KEY, JSON.stringify(local));
  roomResolved = true;
  rememberRoom(ui.joinCode, "b");
  ui.joinStep = null;
  subscribe();
  render(); // show "finding your room…" right away while the first snapshot loads
}

// draw a NEW question for today (the first, or the next after the current one is
// done). Capped at DAILY_LIMIT per day, and you must finish the current card first.
async function reveal(theme) {
  ui.picking = false;
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(roomRef());
      const s = snap.data();
      const t = todayKey();
      let { order, pos, cycle } = s;
      const today = (s.today && s.today.date === t) ? s.today : { date: t, cards: [] };
      // safety guards (the UI already prevents these, but two phones could race)
      if (today.cards.length >= DAILY_LIMIT) return;
      const last = today.cards[today.cards.length - 1];
      if (last != null && !(s.notes && s.notes[last] && s.notes[last].revealed)) return;
      if (pos >= order.length) {
        order = shuffle(Q.map((q) => q.id));
        pos = 0;
        cycle += 1;
      } else {
        // questions added to the bank since this room's order was built aren't in
        // it yet — mix any newcomers into the not-yet-asked tail (leaving already
        // asked questions untouched) so they join the rotation right away.
        const known = new Set(order);
        const missing = Q.map((q) => q.id).filter((id) => !known.has(id));
        if (missing.length) order = [...order.slice(0, pos), ...shuffle([...order.slice(pos), ...missing])];
      }
      if (theme) {
        const idx = order.slice(pos).findIndex((id) => QById[id] && QById[id].theme === theme);
        if (idx > 0) {
          order = [...order];
          const [picked] = order.splice(pos + idx, 1);
          order.splice(pos, 0, picked);
        }
      }
      const qid = order[pos];
      pos += 1;
      tx.update(roomRef(), { order, pos, cycle, today: { date: t, cards: [...today.cards, qid] } });
    });
  } catch (e) {
    console.error(e);
    toast("Couldn't draw a question — you need to be online for this one.");
    render(); // the draw failed; reflect the reset picking state
  }
}

// swap the current (unanswered) card for a different one, without using up a draw.
// The replaced question goes back into the not-yet-asked pool so it can return.
async function redraw(theme) {
  ui.picking = false;
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(roomRef());
      const s = snap.data();
      const t = todayKey();
      const today = (s.today && s.today.date === t) ? s.today : { date: t, cards: [] };
      if (!today.cards.length) return;
      const lastIdx = today.cards.length - 1;
      const lastQid = today.cards[lastIdx];
      const n = (s.notes || {})[lastQid] || {};
      if (n.a || n.b) return; // already answered — can't redraw it away
      let { order, pos } = s;
      if (pos < 1 || pos > order.length) return;
      order = [...order];
      // fold in any newly-added questions first
      const known = new Set(order);
      const missing = Q.map((q) => q.id).filter((id) => !known.has(id));
      if (missing.length) order = [...order.slice(0, pos), ...shuffle([...order.slice(pos), ...missing])];
      if (pos >= order.length) return; // nothing left to swap to
      // pick a different not-yet-asked card (optionally matching a theme) and swap
      // it into the just-drawn slot; the old card slides into the future pool.
      let j = pos + Math.floor(Math.random() * (order.length - pos));
      if (theme) {
        const idx = order.slice(pos).findIndex((id) => QById[id] && QById[id].theme === theme);
        if (idx >= 0) j = pos + idx;
      }
      [order[pos - 1], order[j]] = [order[j], order[pos - 1]];
      const cards = [...today.cards];
      cards[lastIdx] = order[pos - 1];
      tx.update(roomRef(), { order, today: { date: t, cards } });
    });
  } catch (e) {
    console.error(e);
    toast("Couldn't redraw just now — try again.");
    render();
  }
}

async function sealAnswer(qid, text) {
  const draft = text.trim();
  editDraft = { qid, text: draft }; // so the error path can repopulate the box
  // Leave edit mode BEFORE the write. Firestore applies the write to the local
  // cache and fires the snapshot optimistically; if we were still in edit mode at
  // that point it would rebuild the open textarea (one flicker) and then rebuild
  // again into the sealed view (a second). Exiting first means that single
  // optimistic snapshot paints the sealed state directly — no double flicker.
  ui.editing = false;
  try {
    await updateDoc(roomRef(), { [`notes.${qid}.${local.who}`]: draft });
  } catch (e) {
    console.error(e);
    toast("Couldn't seal the answer — try again.");
    ui.editing = qid; // reopen the editor so the answer isn't lost
    render();
    return;
  }
  editDraft = null; // sealed successfully — drop the working copy
  render();
}

async function revealEarly(qid) {
  try {
    await updateDoc(roomRef(), { [`notes.${qid}.revealed`]: true, [`notes.${qid}.revealedAt`]: Date.now() });
  } catch (e) { toast("Couldn't open it just now — try again."); }
}

async function toggleFav(id) {
  const op = (state.favs || []).includes(id) ? arrayRemove(id) : arrayUnion(id);
  try {
    await updateDoc(roomRef(), { favs: op });
  } catch (e) { toast("Couldn't update kept questions — try again."); }
}

// Ask for notification permission, get this device's push token, and store it on
// the room under this partner's slot so the Cloud Function can reach them.
async function enableNotifications() {
  if (!messaging) { toast("Notifications aren't available on this device or browser."); return; }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { toast("Notifications stay off — you can turn them on later."); render(); return; }
    const reg = await navigator.serviceWorker.ready;
    const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: reg });
    if (!token) { toast("Couldn't register for notifications — try again."); return; }
    await updateDoc(roomRef(), { [`tokens.${local.who}`]: token });
    toast("Notifications on — your partner's answers will nudge you.");
    render();
  } catch (e) {
    console.error(e);
    toast("Couldn't turn on notifications — try again.");
  }
}

// stop this device receiving notifications (clears its token from the room)
async function disableNotifications() {
  try {
    await updateDoc(roomRef(), { [`tokens.${local.who}`]: null });
    toast("Notifications off for this device.");
    render();
  } catch (e) { console.error(e); toast("Couldn't turn notifications off — try again."); }
}

async function saveName(name) {
  const clean = (name || "").trim();
  if (!clean) { toast("Add a name first."); return; }
  try { await updateDoc(roomRef(), { [`names.${local.who}`]: clean }); toast("Name saved."); }
  catch (e) { console.error(e); toast("Couldn't save your name — try again."); }
}

async function setRemindHour(h) {
  try { await updateDoc(roomRef(), { remindHour: h }); }
  catch (e) { console.error(e); toast("Couldn't update the reminder — try again."); }
}

const hourLabel = (h) => {
  const ap = h < 12 ? "AM" : "PM";
  let hr = h % 12; if (hr === 0) hr = 12;
  return `${hr}:00 ${ap}`;
};

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
  const theirName = state.names[them] || "Your partner";
  const myColor = me === "a" ? "var(--amber)" : "var(--rose)";
  const theirColor = me === "a" ? "var(--rose)" : "var(--amber)";
  const n = (state.notes || {})[qid] || {};

  // writing mode (always writing as yourself on this device)
  if (ui.editing === qid) {
    // preserve what's being typed across re-renders (e.g. partner just wrote
    // something), instead of falling back to the last saved value
    const draftVal = (editDraft && editDraft.qid === qid) ? editDraft.text : (n[me] || "");
    return `
      <div class="rise">
        <p class="player-label" style="color:var(--amber); margin-bottom:8px">Just you — ${esc(theirName)} can't see this yet</p>
        <textarea id="draft-${qid}" rows="4"
          placeholder="Sealed until you've both answered…">${esc(draftVal)}</textarea>
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

  // both have answered, but not opened yet — hold for the reveal (the suspense)
  if (n[me] && n[them]) {
    return `
      <p class="hint">You've both answered. Open them together whenever you're ready.</p>
      <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center">
        <button class="btn-small seal-action" data-action="reveal-both" data-qid="${qid}">✦ Reveal both answers</button>
        <button class="btn-ghost" data-action="edit" data-qid="${qid}">rewrite mine</button>
      </div>`;
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
    <div class="qcard${animate ? " rise" : ""}">
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
function loadingView(msg) {
  return `<div class="setup-wrap"><p class="bu-serif" style="font-style:italic; font-size:18px; color:var(--dim)">${esc(msg)}</p></div>`;
}

function signedOutView() {
  return `
    <div class="setup-wrap">
      <div class="setup rise" style="text-align:center">
        <h1 class="bu-serif">Between Us</h1>
        <p>One question a day, answered apart, revealed together.${pendingRoom
          ? " Sign in to join your partner's room."
          : " Sign in once and your room follows you to any device — no codes to remember."}</p>
        <button class="btn-primary" data-action="sign-in">Sign in with Google</button>
      </div>
    </div>`;
}

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
          <p>What's your name? You'll get a link to send your partner — they'll add their own name when they join.</p>
          <label class="player-label" style="color:var(--amber)">Your name</label>
          <input type="text" id="name-a" placeholder="e.g. Sam" autocomplete="off">
          <button class="btn-primary" data-action="create-room">Create our room</button>
          <button class="btn-ghost" style="display:block; margin:14px auto 0" data-action="back-welcome">back</button>
        </div>
      </div>`;
  }
  if (ui.joinStep === "name") {
    return `
      <div class="setup-wrap">
        <div class="setup rise">
          <h1 class="bu-serif">You're in.</h1>
          <p>Last thing — what's your name? ${esc(ui.joinNames.a)} will see it.</p>
          <label class="player-label" style="color:var(--rose)">Your name</label>
          <input type="text" id="join-name" placeholder="e.g. Alex" autocomplete="off">
          <button class="btn-primary" data-action="join-name">Join ${esc(ui.joinNames.a)}</button>
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
        <p>Send your partner the link to join — or read them the code below.</p>
        <button class="btn-primary" data-action="share-link">Share the join link</button>
        <p class="bu-serif" style="font-size:28px; font-style:normal; letter-spacing:0.08em; color:var(--amber); margin:16px 0 4px">${prettyCode(local.code)}</p>
        <button class="btn-ghost" data-action="copy-code">copy code instead</button>
        <p style="margin-top:18px">The link and code are the key to the room — share them only with them.
        The code also lives at the bottom of the app if you need it again.</p>
        <button class="btn-primary" data-action="dismiss-share">To today's question</button>
      </div>
    </div>`;
}

function todayView() {
  const t = todayKey();
  const cards = (state.today && state.today.date === t) ? state.today.cards : [];

  // the day's very first draw
  if (cards.length === 0) {
    return `
      <div class="waiting">
        <div class="glow" aria-hidden="true"></div>
        <p class="lead bu-serif">Today's question is waiting.</p>
        <p class="count">${DAILY_LIMIT} questions a day · ${state.pos} of ${TOTAL} asked${state.cycle > 1 ? ` · round ${state.cycle}` : ""}</p>
        ${ui.picking
          ? chipsHtml("reveal-theme") +
            `<button class="btn-ghost" style="font-size:13px; margin-top:16px" data-action="stop-picking">never mind — surprise us</button>`
          : `<div class="actions">
               <button class="btn-primary" data-action="reveal">Turn the card over</button>
               <button class="btn-ghost" style="font-size:13px" data-action="start-picking">or choose tonight's theme</button>
             </div>`}
      </div>`;
  }

  const cardsHtml = cards
    .map((id) => QById[id])
    .filter(Boolean)
    .map((q) => {
      const isNew = !seenCards.has(q.id); // animate a card in only the first time it appears
      seenCards.add(q.id);
      return cardHtml(q, isNew);
    })
    .join("");

  // what comes next depends on the state of the current (last) card
  const lastQid = cards[cards.length - 1];
  const n = (state.notes || {})[lastQid] || {};
  const answeredAtAll = Boolean(n.a || n.b);
  const done = Boolean(n.revealed);

  let action;
  if (!answeredAtAll) {
    // nobody's committed yet → you can swap this card out (not stack a new one)
    action = ui.picking
      ? chipsHtml("redraw-theme") +
        `<button class="btn-ghost" style="font-size:13px; margin-top:16px" data-action="stop-picking">never mind</button>`
      : `<button class="btn-outline" style="margin-top:22px" data-action="redraw">↻ Not this one — redraw</button>
         <button class="btn-ghost" style="display:block; margin:10px auto 0; font-size:13px" data-action="start-repicking">or redraw by theme</button>`;
  } else if (!done) {
    // in progress — finish it before the next
    action = `<p class="hint" style="margin-top:18px">Both answer and reveal this one before the next.</p>`;
  } else if (cards.length < DAILY_LIMIT) {
    action = ui.picking
      ? chipsHtml("reveal-theme") +
        `<button class="btn-ghost" style="font-size:13px; margin-top:16px" data-action="stop-picking">never mind</button>`
      : `<button class="btn-outline" style="margin-top:22px" data-action="reveal">Draw the next question</button>
         <button class="btn-ghost" style="display:block; margin:10px auto 0; font-size:13px" data-action="start-picking">or choose a theme</button>`;
  } else {
    action = `<p class="lead bu-serif" style="font-size:19px; margin-top:24px">That's all three for today. ✦</p>
              <p class="hint" style="text-align:center">Come back tomorrow for the next.</p>`;
  }

  return `
    ${cardsHtml}
    <div class="center">
      ${action}
      <p class="progress-line">${cards.length} of ${DAILY_LIMIT} today · ${state.pos} of ${TOTAL} asked${state.cycle > 1 ? ` · round ${state.cycle}` : ""}</p>
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
  return favs.map((id) => QById[id]).filter(Boolean).map((q) => cardHtml(q, false)).join("");
}

// Our Story — every question you've both opened, newest first. Notes carry a
// revealedAt timestamp from the moment they opened; older notes from before
// that field existed have no date and fall to the bottom in draw order.
function archiveView() {
  const notes = state.notes || {};
  const entries = Object.keys(notes)
    .filter((qid) => notes[qid] && notes[qid].revealed && QById[qid])
    .map((qid) => ({ id: qid, at: notes[qid].revealedAt || 0 }));
  if (entries.length === 0) {
    return `
      <div class="empty">
        <p class="lead bu-serif">Your story starts here.</p>
        <p>Every question you both answer opens and stays — a growing record of
        the two of you, kept on both your phones.</p>
      </div>`;
  }
  const orderIndex = new Map((state.order || []).map((id, i) => [id, i]));
  entries.sort((x, y) => (y.at - x.at) || ((orderIndex.get(y.id) ?? -1) - (orderIndex.get(x.id) ?? -1)));
  const fmt = (ms) => new Date(ms).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
  return `<p class="archive-intro">${entries.length} ${entries.length === 1 ? "question" : "questions"} answered together · newest first</p>` +
    entries.map((e) =>
      `${e.at ? `<p class="archive-date">${fmt(e.at)}</p>` : ""}${cardHtml(QById[e.id], false)}`
    ).join("");
}

function settingsView() {
  const me = local.who;
  const myName = state.names[me] || "";
  const supported = Boolean(messaging) && typeof Notification !== "undefined";
  const perm = (typeof Notification !== "undefined") ? Notification.permission : "unsupported";
  const hasToken = Boolean(state.tokens && state.tokens[me]);
  const rh = (typeof state.remindHour === "number") ? state.remindHour : 18;

  let notif;
  if (!supported) {
    notif = `<p class="hint">Not available on this device or browser. On iPhone, add the app to your Home Screen (iOS 16.4+) first.</p>`;
  } else if (perm === "denied") {
    notif = `<p class="hint">Blocked — turn them back on for this app in your device's settings.</p>`;
  } else if (perm === "granted" && hasToken) {
    notif = `<p class="set-status"><span style="color:var(--sage)">🔔 On for this device</span></p>
             <button class="btn-ghost" data-action="disable-notifs">turn off on this device</button>`;
  } else {
    notif = `<button class="btn-small" data-action="enable-notifs">Turn on notifications</button>`;
  }

  const opts = [`<option value="-1" ${rh < 0 ? "selected" : ""}>Off</option>`]
    .concat([...Array(24).keys()].map((h) => `<option value="${h}" ${h === rh ? "selected" : ""}>${hourLabel(h)}</option>`))
    .join("");

  return `
    <div class="settings-screen rise">
      <div class="settings-head">
        <h2 class="bu-serif">Settings</h2>
        <button class="btn-ghost" data-action="close-settings">done</button>
      </div>

      <section class="set-block">
        <label class="player-label">Your name</label>
        <div style="display:flex; gap:8px; margin-top:6px">
          <input type="text" id="set-name" value="${esc(myName)}" autocomplete="off" style="flex:1">
          <button class="btn-small" data-action="save-name">Save</button>
        </div>
      </section>

      <section class="set-block">
        <label class="player-label">Notifications</label>
        <div style="margin-top:8px">${notif}</div>
      </section>

      <section class="set-block">
        <label class="player-label">Daily reminder</label>
        <p class="hint" style="margin:6px 0 8px">A nudge if you haven't drawn the day's question, in your room's timezone.</p>
        <select id="set-remind" data-action="set-remind">${opts}</select>
      </section>

      <section class="set-block">
        <label class="player-label">Your room</label>
        <p class="set-status">code <span class="bu-serif" style="letter-spacing:0.06em; color:var(--amber)">${prettyCode(local.code)}</span></p>
        <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:8px">
          <button class="btn-small" data-action="share-link">Share join link</button>
          <button class="btn-ghost" data-action="copy-code">copy code</button>
        </div>
      </section>

      <section class="set-block" style="border:none">
        <button class="btn-ghost" data-action="sign-out">sign out on this device</button>
      </section>
    </div>`;
}

// Streak = consecutive days (in the room's timezone, ending today or yesterday)
// on which a question was *both-answered and opened*. Derived from the revealedAt
// timestamps so both devices always agree and there's nothing to keep in sync.
function computeStreak() {
  const days = new Set();
  for (const n of Object.values(state.notes || {})) {
    if (n && n.a && n.b && n.revealedAt) days.add(dateKeyOf(n.revealedAt));
  }
  if (!days.size) return 0;
  let cursor = todayKey();
  if (!days.has(cursor)) {            // nothing today yet — the streak can still be alive from yesterday
    cursor = dayBefore(cursor);
    if (!days.has(cursor)) return 0;
  }
  let count = 0;
  while (days.has(cursor)) { count++; cursor = dayBefore(cursor); }
  return count;
}

function render() {
  // Firestore (esp. with metadata changes) fires the snapshot repeatedly with
  // identical data — local write, then server ack. Rebuilding innerHTML each time
  // re-creates every node and replays entrance animations, which reads as flicker.
  // If nothing the view depends on changed, skip the rebuild entirely.
  const notifState = (typeof Notification !== "undefined" ? Notification.permission : "") + (messaging ? "+" : "");
  const sig = JSON.stringify([todayKey(), local, state, ui, user ? user.uid : null, authReady, roomResolved, pendingRoom, notifState]);
  if (sig === lastSig) return;
  lastSig = sig;

  // Before we tear down the DOM, grab the text/caret of an open answer box so a
  // re-render (e.g. the partner just wrote something) doesn't wipe what you're typing.
  let caretPos = null;
  const taPrev = app.querySelector("textarea");
  if (taPrev && ui.editing !== false) { editDraft = { qid: ui.editing, text: taPrev.value }; caretPos = taPrev.selectionStart; }

  if (!configured) { app.innerHTML = configMissingView(); return; }
  if (!authReady) { app.innerHTML = loadingView("…"); return; }
  if (!user) { app.innerHTML = signedOutView(); return; }
  if (!roomResolved) { app.innerHTML = loadingView("finding your room…"); return; }
  if (!local) { app.innerHTML = welcomeView(); return; }
  if (!state) { app.innerHTML = loadingView("finding your room…"); return; }
  if (ui.joinStep === "share") { app.innerHTML = shareCodeView(); return; }

  const sc = computeStreak();
  const streak = sc > 0
    ? `<span class="streak">✦ ${sc} ${sc === 1 ? "day" : "days"} in a row</span>` : "";
  const keptLabel = `Kept${(state.favs || []).length ? ` · ${state.favs.length}` : ""}`;
  const storyCount = Object.values(state.notes || {}).filter((n) => n && n.revealed).length;
  const storyLabel = `Our Story${storyCount ? ` · ${storyCount}` : ""}`;
  const main = ui.view === "settings" ? settingsView()
    : ui.view === "story" ? archiveView()
    : ui.view === "kept" ? keptView()
    : todayView();
  app.innerHTML = `
    <header>
      <h1>Between Us</h1>
      <div style="display:flex; gap:14px; align-items:center">
        ${streak}
        <button class="btn-ghost gear" data-action="open-settings" aria-label="Settings" title="Settings">⚙</button>
      </div>
    </header>
    <nav>
      <button class="${ui.view === "today" ? "active" : ""}" data-action="nav" data-view="today">Today</button>
      <button class="${ui.view === "story" ? "active" : ""}" data-action="nav" data-view="story">${storyLabel}</button>
      <button class="${ui.view === "kept" ? "active" : ""}" data-action="nav" data-view="kept">${keptLabel}</button>
    </nav>
    <main>${main}</main>
    ${ui.online ? "" : `<p class="progress-line" style="margin:0 0 18px">offline — changes will sync when you're back</p>`}`;
  const ta = app.querySelector("textarea");
  if (ta && ui.editing !== false) {
    ta.focus();
    if (caretPos != null) { try { ta.setSelectionRange(caretPos, caretPos); } catch (e) {} }
  }
}

// Subtle "working…" state for buttons that hit the network: dim + pulse and lock
// out repeat taps while the request is in flight. If the action re-renders on
// success the button is gone, so restoring is a harmless no-op; on failure (no
// re-render) the button comes back so it can be tried again.
async function withBusy(btn, fn) {
  if (btn) { btn.disabled = true; btn.classList.add("busy"); }
  try {
    await fn();
  } finally {
    if (btn && btn.isConnected) { btn.disabled = false; btn.classList.remove("busy"); }
  }
}

// ——— events ———
app.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  const { action, qid, theme, view, who } = btn.dataset;
  switch (action) {
    case "sign-in": signIn(btn); break;
    case "show-create": ui.joinStep = "create"; render(); break;
    case "show-join": ui.joinStep = "join"; render(); break;
    case "back-welcome": ui.joinStep = null; render(); break;
    case "create-room": {
      const name = document.getElementById("name-a").value.trim() || "You";
      withBusy(btn, () => createRoom(name));
      break;
    }
    case "lookup": withBusy(btn, () => lookupRoom(cleanCode(document.getElementById("join-code").value))); break;
    case "join-as": joinAs(who); break;
    case "join-name": withBusy(btn, () => joinAsNew(document.getElementById("join-name").value)); break;
    case "share-link": shareJoin(); break;
    case "copy-code": navigator.clipboard?.writeText(prettyCode(local.code)).then(() => toast("Copied.")); break;
    case "dismiss-share": ui.joinStep = null; render(); break;
    case "open-settings": ui.view = "settings"; ui.editing = false; ui.picking = false; render(); break;
    case "close-settings": ui.view = "today"; render(); break;
    case "save-name": withBusy(btn, () => saveName(document.getElementById("set-name").value)); break;
    case "enable-notifs": withBusy(btn, () => enableNotifications()); break;
    case "disable-notifs": withBusy(btn, () => disableNotifications()); break;
    case "sign-out":
      if (window.confirm("Sign out on this device? Your room and all your answers stay safe — sign back in any time, on any device, to return. No code needed.")) signOutUser();
      break;
    case "nav": ui.view = view; ui.editing = false; editDraft = null; render(); break;
    case "reveal": withBusy(btn, () => reveal()); break;
    case "reveal-theme": withBusy(btn, () => reveal(theme)); break;
    case "redraw": withBusy(btn, () => redraw()); break;
    case "redraw-theme": withBusy(btn, () => redraw(theme)); break;
    case "start-picking": ui.picking = true; ui.pickMode = "draw"; render(); break;
    case "start-repicking": ui.picking = true; ui.pickMode = "redraw"; render(); break;
    case "stop-picking": ui.picking = false; render(); break;
    case "fav": toggleFav(qid); break;
    case "edit": editDraft = null; ui.editing = qid; render(); break;
    case "cancel-edit": ui.editing = false; editDraft = null; render(); break;
    case "seal": {
      const text = document.getElementById(`draft-${qid}`).value;
      if (!text.trim()) return;
      withBusy(btn, () => sealAnswer(qid, text));
      break;
    }
    case "reveal-early": withBusy(btn, () => revealEarly(qid)); break;
    case "reveal-both": withBusy(btn, () => revealEarly(qid)); break;
  }
});

// the daily-reminder dropdown
app.addEventListener("change", (e) => {
  const el = e.target.closest("[data-action]");
  if (el && el.dataset.action === "set-remind") setRemindHour(Number(el.value));
});

// Enter-to-submit: on a single-line input, Enter fires that screen's primary
// button; in the multi-line answer box, Enter is a newline, so ⌘/Ctrl+Enter seals.
app.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.isComposing) return;
  const t = e.target;
  if (t.tagName === "INPUT") {
    e.preventDefault();
    const scope = t.closest(".setup") || app;
    scope.querySelector(".btn-primary[data-action]")?.click();
  } else if (t.tagName === "TEXTAREA" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    app.querySelector('[data-action="seal"]')?.click();
  }
});

// build a deep link the partner can tap to land straight on the join screen
function joinUrl() {
  return `${location.origin}${location.pathname}?room=${local.code}`;
}
function shareJoin() {
  const url = joinUrl();
  const text = `Join me on Between Us — one question a day, answered apart, revealed together. Tap to join: ${url}`;
  if (navigator.share) {
    navigator.share({ title: "Between Us", text, url }).catch(() => {});
  } else {
    navigator.clipboard?.writeText(url).then(() => toast("Join link copied."));
  }
}

// roll the day over when the app returns from the background (the render
// signature includes today's date, so this picks up a midnight crossover)
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state) render();
});

// ——— boot ———
// A "?room=CODE" link gets stashed and handled after sign-in (in resolveAuth),
// then stripped from the URL so a refresh doesn't re-trigger it.
const urlRoom = new URLSearchParams(location.search).get("room");
if (urlRoom) {
  pendingRoom = cleanCode(urlRoom);
  history.replaceState(null, "", location.pathname);
}

// Firebase restores the signed-in user asynchronously; render a loading state
// until it reports back, then resolveAuth decides where to send us.
if (configured && auth) {
  onAuthStateChanged(auth, (u) => { user = u || null; authReady = true; resolveAuth(); });
}

render();
