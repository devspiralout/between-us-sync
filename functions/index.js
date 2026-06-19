// Between Us — push notifications.
// When a room document changes, detect a partner sealing a fresh answer and send
// the OTHER partner a nudge. We only ever send a name + "answered" — never the
// question text or the answer itself, so nothing private leaves the room.
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();

const APP_URL = "https://devspiralout.github.io/between-us-sync/";

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
