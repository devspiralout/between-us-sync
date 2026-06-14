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

## Step 3 — Turn on Google sign-in

The app signs you in with Google so your room follows you to any device — no
codes to remember — and so only signed-in people can touch your data.

1. In the Firebase console sidebar: **Build → Authentication → Get started**
2. Under **Sign-in method**, pick **Google** → toggle **Enable** → choose a
   project support email → **Save**
3. Go to **Authentication → Settings → Authorized domains → Add domain** and add
   the domain you'll host on (e.g. `yourname.github.io`). `localhost` is already
   listed, which covers local testing.

## Step 4 — Turn on Firestore and set the rules

1. In the Firebase console sidebar: **Build → Firestore Database → Create database**
2. Pick a location near you → start in **production mode** → Enable
3. Go to the **Rules** tab, replace everything with this, and click **Publish**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Rooms are reachable only by their unguessable code (no listing), and now
    // only by someone who is signed in.
    match /rooms/{room} {
      allow get, create, update: if request.auth != null;
      allow list, delete: if false;
    }
    // Each person's account → room link. Readable/writable only by that account.
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

What this means honestly: you must be signed in to read or write anything, and
rooms still can't be listed or discovered — the unguessable code is only needed
once, to pair. Your account remembers your room after that. (A further hardening
step would lock each room to its two specific accounts; the rules above already
require sign-in, which closes the main gap.)

## Step 5 — Host the folder

Same as the offline version — any free static host, e.g.:

- **Netlify Drop**: drag this folder onto https://app.netlify.com/drop → done
- **GitHub Pages / Cloudflare Pages / Vercel**: upload to a repo and enable Pages

Whatever domain you land on, make sure it's in the **Authorized domains** list
from Step 3 — otherwise Google sign-in will refuse to run there.

## Step 6 — Pair your phones

1. Both of you open the URL and **Add to Home Screen**
   (iPhone: Safari Share → Add to Home Screen · Android: Chrome install prompt)
2. Both of you tap **Sign in with Google** the first time
3. One phone: **Start a new room** → enter your name → you get a join link
4. Send your partner the link (or read them the room code)
5. Partner: tap the link (or **Join with a code**) → enter their name

From then on you're synced — and because you're each signed in, either of you can
open the app on any device, sign in, and land right back in your room with no
code. One of you draws the day's question and it appears on both phones; each
writes on their own phone; sealed answers genuinely never appear on the other
device; the moment the second answer is sealed, both open on both screens.

## Good to know

- **Cost:** Firebase's free tier allows tens of thousands of reads/writes per day.
  Two people will use a rounding error of that. No card required.
- **Offline:** the app caches itself and your room locally; answers written
  offline sync when you reconnect. Drawing a new question needs a connection
  (it's coordinated between the phones).
- **Signing out / new devices:** "Sign out" (bottom of the app) just ends this
  device's session — your room and all answers stay safe. Sign back in with the
  same Google account on any device and you land right back in your room; no code
  needed. The room code is only for the one-time pairing, and still lives at the
  bottom of the app if you ever need to re-share it.
- **Editing questions:** `questions.js`, same as before. You can now add, remove,
  reorder, or re-theme questions any time and saved answers stay attached — each
  question is keyed by a hash of its text. The one exception: **rewording** a
  question changes its key, so its old answers stay in the bank under the old
  wording rather than following the edit.
- **Deleting everything:** Firebase console → Firestore Database → delete the
  room document (or the whole project). It's your database; nothing is stored
  anywhere else.
