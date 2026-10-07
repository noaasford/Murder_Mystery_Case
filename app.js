import { auth, db, signInAnonymously } from "./firebase.js";
import {
  ref,
  get,
  set,
  update,
  onValue,
  push,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";

const $ = (id) => document.getElementById(id);

const VIEWS = ["homeView", "lobbyView", "gameView", "endView"];

let me = null;
let roomCode = null;
let room = null;
let unsub = null;
let chatUnsub = null;
let timerHandle = null;

let activeChat = "living";
let transitionLock = false;

let audioCtx = null;
let musicOn = true;
let musicTimer = null;

const INVESTIGATION_SECONDS = 10;
const DISCUSSION_SECONDS = 60;
const VOTING_SECONDS = 30;
const RESULT_SECONDS = 8;
const TRANSITION_LOCK_SECONDS = 6;

/* =========================================================
   ROLE SYSTEM
========================================================= */

const ROLE_INFO = {
  murderer: {
    label: "MURDERER",
    icon: "🔪",
    text: "Blend in. Eliminate the innocent side and survive the investigation."
  },

  detective: {
    label: "DETECTIVE",
    icon: "🕵️",
    text: "Investigate one living suspect each round. Your result is private."
  },

  investigator: {
    label: "INVESTIGATOR",
    icon: "🔎",
    text: "Analyze one suspect and uncover a private piece of information."
  },

  witness: {
    label: "WITNESS",
    icon: "👁️",
    text: "You personally witnessed something connected to the incident."
  },

  person_of_interest: {
    label: "PERSON OF INTEREST",
    icon: "🎭",
    text: "You are involved in the case and have a secret connection to the victim."
  },

  keyholder: {
    label: "KEYHOLDER",
    icon: "🔑",
    text: "You possess access information that may explain how someone entered the scene."
  },

  forensic: {
    label: "FORENSIC",
    icon: "🧪",
    text: "You understand the physical evidence and can uncover forensic information."
  },

  innocent: {
    label: "INNOCENT",
    icon: "👤",
    text: "Study the evidence, challenge alibis, and identify the murderer."
  }
};

/*
  Role composition scales with player count.

  Murderer:
  4–7  = 1
  8–14 = 2
  15–22 = 3
  23–30 = 4

  Other roles are added as the player count increases.
*/

function getRoleComposition(count) {
  const roles = [];

  const murderers =
    count <= 7 ? 1 :
    count <= 14 ? 2 :
    count <= 22 ? 3 : 4;

  roles.push(...Array(murderers).fill("murderer"));

  if (count >= 5) roles.push("detective");
  if (count >= 7) roles.push("witness");
  if (count >= 9) roles.push("investigator");
  if (count >= 10) roles.push("person_of_interest");
  if (count >= 12) roles.push("keyholder");
  if (count >= 14) roles.push("forensic");

  if (count >= 16) roles.push("witness");
  if (count >= 18) roles.push("person_of_interest");
  if (count >= 20) roles.push("investigator");
  if (count >= 22) roles.push("keyholder");
  if (count >= 24) roles.push("forensic");
  if (count >= 26) roles.push("witness");
  if (count >= 28) roles.push("person_of_interest");

  while (roles.length < count) {
    roles.push("innocent");
  }

  return roles.slice(0, count);
}

function murdererCount(count) {
  return count <= 7 ? 1 :
    count <= 14 ? 2 :
    count <= 22 ? 3 : 4;
}

/* =========================================================
   CASE DATA
========================================================= */

const EVIDENCE = [
  {
    type: "CASE CLUE",
    icon: "📌",
    title: "The West Corridor",
    text:
      "Someone moved through the west corridor without triggering the security alarm.",
    meta:
      "IMPLICATION · THE PERSON MAY HAVE KNOWN THE BUILDING"
  },

  {
    type: "PHYSICAL EVIDENCE",
    icon: "⌚",
    title: "Broken Silver Watch",
    text:
      "A damaged silver watch was found beneath the library table. Its hands stopped at 22:17.",
    meta:
      "OBJECT · STOPPED TIME 22:17"
  },

  {
    type: "WITNESS STATEMENT",
    icon: "👁️",
    title: "Statement #01",
    text:
      "A resident reported hearing two sets of footsteps before the west door slammed.",
    meta:
      "SOURCE · SECOND-FLOOR RESIDENT · RELIABILITY ★★★☆☆"
  },

  {
    type: "FORENSIC REPORT",
    icon: "🧪",
    title: "Preliminary Findings",
    text:
      "No forced entry was discovered. The estimated incident window is between 22:10 and 22:25.",
    meta:
      "FORENSICS · ACCESS APPEARS VOLUNTARY"
  },

  {
    type: "CCTV EVIDENCE",
    icon: "📹",
    title: "Camera 04 — West Hall",
    text:
      "A figure crosses the frame at 22:14 and pauses beside the service door.",
    meta:
      "SECURITY ARCHIVE · FACE NOT IDENTIFIABLE"
  },

  {
    type: "PHYSICAL EVIDENCE",
    icon: "🔑",
    title: "Service Key",
    text:
      "A brass service key was found on the floor. It was not listed as checked out.",
    meta:
      "OBJECT · UNREGISTERED ACCESS"
  },

  {
    type: "PHYSICAL EVIDENCE",
    icon: "🧤",
    title: "Black Fabric Fiber",
    text:
      "A dark fabric fiber was recovered from the library chair.",
    meta:
      "FORENSICS · SOURCE UNKNOWN"
  },

  {
    type: "DOCUMENT",
    icon: "📄",
    title: "Missing Visitor Log",
    text:
      "One page from the building's visitor register appears to have been removed.",
    meta:
      "DOCUMENT · POSSIBLE CONCEALMENT"
  }
];

const CRIME_SCENE_PHOTO = {
  type: "CRIME SCENE PHOTOGRAPH",
  icon: "📸",
  title: "Library — 22:17",
  text:
    "The scene contains three notable details: a displaced chair, a stopped clock, and a dark reflection near the west window.",
  meta:
    "PHOTOGRAPH · ORIGINAL SCENE DOCUMENTATION"
};

const NPC_TESTIMONIES = [
  {
    name: "Mrs. Evelyn",
    text:
      "I heard two people speaking in the corridor shortly before the library door closed.",
    reliability: "★★★☆☆"
  },

  {
    name: "Thomas Reed",
    text:
      "Someone passed me carrying something metallic. I couldn't identify the person.",
    reliability: "★★☆☆☆"
  },

  {
    name: "Security Officer Hale",
    text:
      "The west corridor alarm did not activate during the estimated incident window.",
    reliability: "★★★★☆"
  },

  {
    name: "Mara",
    text:
      "I saw someone standing near the library window, but the lights were too dim to identify them.",
    reliability: "★★★☆☆"
  }
];

const WITNESS_TESTIMONIES = [
  "You saw someone enter the library shortly before the incident.",
  "You saw a figure near the west corridor around 22:14.",
  "You noticed someone carrying a small metallic object.",
  "You heard two people arguing shortly before the library door closed.",
  "You saw someone leave the library and head toward the service corridor."
];

const POI_SECRETS = [
  "You were secretly meeting the victim shortly before the incident.",
  "You argued with the victim earlier that evening.",
  "You owe the victim money, but you did not kill them.",
  "You were in the building after hours and don't want anyone to know.",
  "You discovered something about the victim but kept it secret.",
  "You were the last known person to speak with the victim."
];

const KEYHOLDER_SECRETS = [
  "You know that the west service door requires a brass key.",
  "You noticed that a spare service key was missing before the incident.",
  "You know who normally has access to the west corridor.",
  "You saw the service-door key cabinet open earlier that evening."
];

const FORENSIC_SECRETS = [
  "The estimated incident window is approximately 22:10–22:25.",
  "The scene shows no obvious forced entry.",
  "The silver watch stopped at approximately 22:17.",
  "A dark fiber was found on the library chair."
];

/* =========================================================
   BASIC HELPERS
========================================================= */

function showView(id) {
  VIEWS.forEach((v) => {
    const el = $(v);
    if (el) el.classList.toggle("active", v === id);
  });
}

function err(id, msg = "") {
  const el = $(id);
  if (el) el.textContent = msg;
}

function normalizeName(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 20);
}

function normalizedName(name) {
  return normalizeName(name).toLowerCase();
}

function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  return Array.from({ length: 6 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join("");
}

function shuffle(array) {
  return [...array].sort(() => Math.random() - 0.5);
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[c]));
}

function getPlayers() {
  return room?.players || {};
}

function getAlivePlayers() {
  return Object.entries(getPlayers())
    .filter(([, player]) => player?.alive);
}

function getRole(uid) {
  return room?.privateRoles?.[uid]?.role || "innocent";
}

function getMyPlayer() {
  return room?.players?.[me?.uid];
}

/* =========================================================
   AUTH
========================================================= */

async function authIn() {
  try {
    if (!auth.currentUser) {
      await signInAnonymously(auth);
    }

    me = auth.currentUser;

    if (!me) {
      throw new Error("Anonymous authentication failed.");
    }

    const connection = $("connection");

    if (connection) {
      connection.textContent = "● Online";
      connection.classList.add("online");
    }

    return me;
  } catch (e) {
    const connection = $("connection");

    if (connection) {
      connection.textContent = "Auth error";
      connection.classList.remove("online");
    }

    throw e;
  }
}

/* =========================================================
   ROOM CREATION
========================================================= */

async function createRoom() {
  const name = normalizeName($("nameInput")?.value);

  err("homeError");

  if (!name) {
    err("homeError", "Enter your name first.");
    return;
  }

  await authIn();

  let newCode = randomCode();
  let exists = true;

  for (let i = 0; i < 5 && exists; i++) {
    const snapshot = await get(ref(db, `rooms/${newCode}`));

    exists = snapshot.exists();

    if (exists) {
      newCode = randomCode();
    }
  }

  if (exists) {
    err("homeError", "Could not create a case. Try again.");
    return;
  }

  roomCode = newCode;

  const player = {
    name,
    alive: true,
    joinedAt: serverTimestamp()
  };

  await set(ref(db, `rooms/${newCode}`), {
    hostUid: me.uid,

    status: "lobby",
    phase: "lobby",
    round: 0,

    maxPlayers: 30,

    createdAt: serverTimestamp(),

    players: {
      [me.uid]: player
    },

    public: {
      clueIndex: 0,
      victimUid: "",
      pendingVictimUid: "",
      eliminatedUid: "",
      eliminatedRole: "",
      lastResult: null
    }
  });

  localStorage.setItem("mm_room", newCode);
  localStorage.setItem("mm_uid", me.uid);

  playClick();
  listenRoom(newCode);
}

/* =========================================================
   JOIN ROOM
========================================================= */

async function joinRoom() {
  const name = normalizeName($("nameInput")?.value);
  const codeInput = $("roomInput")?.value || "";
  const code = codeInput.trim().toUpperCase();

  err("homeError");

  if (!name) {
    err("homeError", "Enter your name first.");
    return;
  }

  if (!/^[A-Z0-9]{6}$/.test(code)) {
    err("homeError", "Enter a valid 6-character room code.");
    return;
  }

  await authIn();

  const roomRef = ref(db, `rooms/${code}`);
  const snapshot = await get(roomRef);

  if (!snapshot.exists()) {
    err("homeError", "Case not found.");
    return;
  }

  const data = snapshot.val();
  const players = data.players || {};

  if (data.status !== "lobby") {
    err("homeError", "This case has already started.");
    return;
  }

  if (Object.keys(players).length >= 30) {
    err("homeError", "This case is full.");
    return;
  }

  const duplicate = Object.entries(players).some(
    ([uid, player]) =>
      uid !== me.uid &&
      normalizedName(player?.name) === normalizedName(name)
  );

  if (duplicate) {
    err(
      "homeError",
      "That name is already in this case. Choose another name."
    );
    return;
  }

  await set(
    ref(db, `rooms/${code}/players/${me.uid}`),
    {
      name,
      alive: true,
      joinedAt: serverTimestamp()
    }
  );

  roomCode = code;

  localStorage.setItem("mm_room", code);
  localStorage.setItem("mm_uid", me.uid);

  playClick();
  listenRoom(code);
}

/* =========================================================
   ROOM LISTENER
========================================================= */

function listenRoom(code) {
  if (unsub) unsub();

  if (chatUnsub) {
    chatUnsub();
    chatUnsub = null;
  }

  roomCode = code;

  unsub = onValue(
    ref(db, `rooms/${code}`),
    (snapshot) => {
      if (!snapshot.exists()) {
        room = null;

        showView("homeView");

        err("homeError", "Case no longer exists.");

        return;
      }

      room = snapshot.val();

      render();
    },
    (error) => {
      console.error(error);
      err("homeError", error.message || "Unable to read the case.");
    }
  );
}

/* =========================================================
   MAIN RENDER
========================================================= */

function render() {
  if (!room) return;

  const players = room.players || {};
  const list = Object.entries(players);

  if ($("roomCodeLabel")) {
    $("roomCodeLabel").textContent = roomCode || "—";
  }

  if (room.status === "lobby") {
    renderLobby(list);
    return;
  }

  if (room.status === "playing") {
    renderGame();
    return;
  }

  if (room.status === "ended") {
    renderEnd();
  }
}

/* =========================================================
   LOBBY
========================================================= */

function renderLobby(list) {
  showView("lobbyView");

  if ($("playerCount")) {
    $("playerCount").textContent = `${list.length}/30`;
  }

  if ($("playerList")) {
    $("playerList").innerHTML = list
      .map(([uid, player]) => `
        <div class="player-row">
          <span class="avatar">
            ${esc(String(player.name || "?").slice(0, 1).toUpperCase())}
          </span>

          <span>${esc(player.name)}</span>

          ${
            uid === room.hostUid
              ? '<span class="host-label">HOST</span>'
              : ""
          }
        </div>
      `)
      .join("");
  }

  const startBtn = $("startBtn");

  if (!startBtn) return;

  const isHost = me?.uid === room.hostUid;
  const count = list.length;

  startBtn.disabled = !isHost || count < 4;

  if (!isHost) {
    startBtn.textContent = "Waiting for host…";
  } else if (count < 4) {
    startBtn.textContent =
      `Need ${4 - count} more player(s)`;
  } else {
    startBtn.textContent =
      "Start investigation";
  }
}