// ————————————————————————————————————————————————
// PASTE YOUR FIREBASE CONFIG HERE — see SETUP.md, step 2.
// It looks like this in the Firebase console:
//
//   const firebaseConfig = {
//     apiKey: "AIza....",
//     authDomain: "your-project.firebaseapp.com",
//     projectId: "your-project",
//     ...
//   };
//
// Replace the placeholder object below with yours.
// (This config is safe to ship in a web page — it identifies your
// project, it isn't a secret. Access is controlled by your rules.)
// ————————————————————————————————————————————————

export const firebaseConfig = {
  apiKey: "AIzaSyCp5L1xHDWuTKQHG0zr0qAv-qugjQqkWKk",
  authDomain: "between-us-8a7cf.firebaseapp.com",
  projectId: "between-us-8a7cf",
  storageBucket: "between-us-8a7cf.firebasestorage.app",
  messagingSenderId: "79650974050",
  appId: "1:79650974050:web:8d44b9b1499df53970643b"
};

// Web Push (notifications) public key. Firebase console → Project settings →
// Cloud Messaging → "Web Push certificates" → Generate key pair → paste the key
// string here. Like the config above, this is a PUBLIC key and safe to ship.
export const vapidKey = "BP_6s_3XItN9c0nnFkvGQ1hzoigLTOkFSLz6bW7EECJ47FRdFPBZq8tKOLx_QMsuki8m9LDTmukuC0C1dez69GE";
