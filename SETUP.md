# Between Us — Synced Edition: Setup

Two phones, one room. Answers sync live through Firebase's free tier.
One-time setup is about 5–10 minutes; no code changes beyond pasting one snippet.

## Step 1 — Create a Firebase project (free)

1. Go to https://console.firebase.google.com and sign in with any Google account
2. **Add project** → name it anything (e.g. `between-us`) → you can turn OFF
   Google Analytics when asked → Create
3. On the project's home screen, click the **`</>` (Web)** icon to register a web app.
   Nickname it anything; you do NOT need Firebase Hosting checked. Register.

## Step 2 — Paste your config

After registering, Firebase shows a code block containing
`const firebaseConfig = { apiKey: "...", ... }`.

Open **`firebase-config.js`** in this folder and replace the placeholder object
with yours, keeping the `export const firebaseConfig =` at the front. That's the
only code change. (This config is not a secret — it just names your project.
Access is controlled by the rules in step 3.)

## Step 3 — Turn on Firestore and set the rules

1. In the Firebase console sidebar: **Build → Firestore Database → Create database**
2. Pick a location near you → start in **production mode** → Enable
3. Go to the **Rules** tab, replace everything with this, and click **Publish**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Rooms can be read/written only by direct path — there is no way to
    // list or search rooms, so the unguessable room code is the key.
    match /rooms/{room} {
      allow get, create, update: if true;
      allow list, delete: if false;
    }
  }
}
```

What this means honestly: anyone who has your exact 12-character room code could
read and write your room, but nobody can discover codes — there are ~10^17
possibilities and listing is forbidden. For two people's private ritual that's a
reasonable lock. If you ever want bank-grade hardening (Firebase Anonymous Auth
with per-device membership), that's a later upgrade.

## Step 4 — Host the folder

Same as the offline version — any free static host, e.g.:

- **Netlify Drop**: drag this folder onto https://app.netlify.com/drop → done
- **GitHub Pages / Cloudflare Pages / Vercel**: upload to a repo and enable Pages

## Step 5 — Pair your phones

1. Both of you open the URL and **Add to Home Screen**
   (iPhone: Safari Share → Add to Home Screen · Android: Chrome install prompt)
2. One phone: **Start a new room** → enter both names → say whose phone it is
3. It shows a room code like `mkr3-x8wq-p2na` — read it out or send it
4. Other phone: **Join with a code** → enter it → tap your name

From then on you're synced: one of you draws the day's question and it appears on
both phones; each of you writes on your own phone; sealed answers genuinely never
appear on the other device; the moment the second answer is sealed, both open on
both screens.

## Good to know

- **Cost:** Firebase's free tier allows tens of thousands of reads/writes per day.
  Two people will use a rounding error of that. No card required.
- **Offline:** the app caches itself and your room locally; answers written
  offline sync when you reconnect. Drawing a new question needs a connection
  (it's coordinated between the phones).
- **The room code** lives at the bottom of the app on a paired phone. "Leave on
  this phone" only disconnects that device — the room and all answers stay in
  your Firebase project, and you can rejoin with the code.
- **Editing questions:** `questions.js`, same as before. You can now add, remove,
  reorder, or re-theme questions any time and saved answers stay attached — each
  question is keyed by a hash of its text. The one exception: **rewording** a
  question changes its key, so its old answers stay in the bank under the old
  wording rather than following the edit.
- **Deleting everything:** Firebase console → Firestore Database → delete the
  room document (or the whole project). It's your database; nothing is stored
  anywhere else.
