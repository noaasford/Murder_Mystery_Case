// Paste the Firebase Web App config from Firebase Console here.
// See README.md for the exact setup steps.

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyC9Z-Otk1EdXmCdr3I7nivCruzNZcYaRHk",
  authDomain: "murder-mystery-game-153df.firebaseapp.com",
  databaseURL: "https://murder-mystery-game-153df-default-rtdb.asia-southeast1.firebasedatabase.app/",
  projectId: "murder-mystery-game-153df",
  storageBucket: "murder-mystery-game-153df.firebasestorage.app",
  messagingSenderId: "490623463821",
  appId: "1:490623463821:web:6bd16ec1c4af71b8b0cdc4"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

export { app, auth, db, signInAnonymously };
