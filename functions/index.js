// Between Us — push notifications.
// When a room document changes, detect a partner sealing a fresh answer and send
// the OTHER partner a nudge. We only ever send a name + "answered" — never the
// question text or the answer itself, so nothing private leaves the room.
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");
const { getFirestore } = require("firebase-admin/firestore");

initializeApp();

const APP_URL = "https://devspiralout.github.io/between-us-sync/";
const REMIND_HOUR = 18; // send the daily nudge at 6pm in each room's home timezone

exports.notifyOnAnswer = onDocumentUpdated("rooms/{room}", async (event) => {
  const before = event.data.before.data() || {};
  const after = event.data.after.data() || {};

  const beforeNotes = before.notes || {};
  const afterNotes = after.notes || {};
  const names = after.names || {};
  const tokens = after.tokens || {};

  // find each answer that just appeared and notify the partner who didn't write it
  const sends = [];
  for (const [qid, n] of Object.entries(afterNotes)) {
    const prev = beforeNotes[qid] || {};
    for (const who of ["a", "b"]) {
      if (n[who] && !prev[who]) {
        const other = who === "a" ? "b" : "a";
        const token = tokens[other];
        if (!token) continue; // partner hasn't turned on notifications
        const sealerName = names[who] || "Your partner";
        const bothIn = Boolean(n.a) && Boolean(n.b);
        const body = bothIn
          ? `${sealerName} answered too — you can open tonight's question together.`
          : `${sealerName} answered today's question — your turn.`;
        sends.push({ token, body });
      }
    }
  }

  await Promise.all(sends.map((m) =>
    getMessaging().send({
      token: m.token,
      data: { title: "Between Us", body: m.body, url: APP_URL },
      webpush: { headers: { Urgency: "high", TTL: "86400" }, fcmOptions: { link: APP_URL } },
    }).catch((err) => console.error("push failed:", err && err.code)) // ignore stale/invalid tokens
  ));
});

// Daily reminder: runs hourly and, for each room, sends a nudge at REMIND_HOUR in
// that room's home timezone — but only if they haven't drawn today's question yet.
// A per-room `lastRemind` date keeps it to once a day.
exports.dailyReminder = onSchedule("every 60 minutes", async () => {
  const db = getFirestore();
  const now = new Date();
  const rooms = await db.collection("rooms").get();

  await Promise.all(rooms.docs.map(async (doc) => {
    const r = doc.data();
    const tz = r.tz || "UTC";
    let parts;
    try {
      parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz, hour: "2-digit", hour12: false,
        year: "numeric", month: "2-digit", day: "2-digit",
      }).formatToParts(now);
    } catch (e) { return; }
    const val = (type) => (parts.find((p) => p.type === type) || {}).value;
    const hour = parseInt(val("hour"), 10) % 24;
    const todayKey = `${val("year")}-${val("month")}-${val("day")}`;

    const remindHour = (typeof r.remindHour === "number") ? r.remindHour : REMIND_HOUR;
    if (remindHour < 0) return;         // reminders turned off for this room
    if (hour !== remindHour) return;
    if (r.lastRemind === todayKey) return; // already nudged today

    // if they've already started today's questions, no nudge needed — just mark it
    const drewToday = r.today && r.today.date === todayKey && (r.today.cards || []).length > 0;
    if (drewToday) { await doc.ref.update({ lastRemind: todayKey }); return; }

    const tokens = Object.values(r.tokens || {}).filter(Boolean);
    await Promise.all(tokens.map((token) =>
      getMessaging().send({
        token,
        data: { title: "Between Us", body: "A new day — today's question is waiting.", url: APP_URL },
        webpush: { headers: { Urgency: "normal", TTL: "43200" }, fcmOptions: { link: APP_URL } },
      }).catch((err) => console.error("reminder push failed:", err && err.code))
    ));
    await doc.ref.update({ lastRemind: todayKey });
  }));
});
