import { auth, db, signInAnonymously } from "./firebase.js";
import {
  ref, get, set, update, onValue, push, remove, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-database.js";

const $ = (id) => document.getElementById(id);
const views = ["homeView", "lobbyView", "gameView", "endView"];

let me = null;
let roomCode = null;
let room = null;
let unsub = null;
let timerHandle = null;

const ROLE_INFO = {
  murderer: {
    label: "MURDERER",
    icon: "🔪",
    text: "Blend in. During investigation, secretly choose one living player as your target."
  },
  detective: {
    label: "DETECTIVE",
    icon: "🔎",
    text: "You are trying to identify the murderer. Choose one living suspect to investigate."
  },
  investigator: {
    label: "INVESTIGATOR",
    icon: "🕵️",
    text: "You have access to a special clue. Investigate one living suspect each round."
  },
  witness: {
    label: "WITNESS",
    icon: "👁️",
    text: "You noticed something important. Your clue can help the group narrow down suspects."
  },
  innocent: {
    label: "INNOCENT",
    icon: "👤",
    text: "You have no special power. Discuss, collect clues, and vote wisely."
  }
};

const CLUES = [
  "A dark coat was seen near the library shortly before the incident.",
  "The culprit knew the building's layout unusually well.",
  "A witness remembers hearing two sets of footsteps.",
  "Someone changed their story after the first clue was revealed.",
  "The evidence suggests the culprit had access to the west corridor.",
  "A small detail in the room was deliberately moved.",
  "The person responsible was not alone immediately before the incident."
];

function showView(id) {
  views.forEach(v => $(v).classList.toggle("active", v === id));
}

function setError(id, msg = "") {
  $(id).textContent = msg;
}

function normalizeName(name) {
  return name.trim().replace(/\s+/g, " ").slice(0, 20);
}

function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

function murdererCount(n) {
  if (n <= 7) return 1;
  if (n <= 14) return 2;
  if (n <= 22) return 3;
  return 4;
}

function specialRoles(n) {
  // Returns remaining special roles after murderers.
  const out = [];
  if (n >= 5) out.push("detective");
  if (n >= 8) out.push("investigator");
  if (n >= 10) out.push("witness");
  if (n >= 18) out.push("witness");
  return out;
}

async function ensureAuth() {
  try {
    if (!auth.currentUser) await signInAnonymously(auth);
    me = auth.currentUser;
    $("connection").textContent = "● Online";
    $("connection").classList.add("online");
  } catch (e) {
    $("connection").textContent = "Auth error";
    throw e;
  }
}

async function createRoom() {
  const name = normalizeName($("nameInput").value);
  setError("homeError");
  if (!name) return setError("homeError", "Enter your name first.");
  await ensureAuth();

  let code = randomCode();
  let exists = true;
  for (let i = 0; i < 5 && exists; i++) {
    const snap = await get(ref(db, `rooms/${code}`));
    exists = snap.exists();
    if (exists) code = randomCode();
  }
  if (exists) return setError("homeError", "Could not create a room. Try again.");

  roomCode = code;
  const player = {
    name,
    alive: true,
    joinedAt: serverTimestamp()
  };

  await set(ref(db, `rooms/${code}`), {
    hostUid: me.uid,
    status: "lobby",
    phase: "lobby",
    round: 0,
    maxPlayers: 30,
    createdAt: serverTimestamp(),
    players: { [me.uid]: player },
    public: { clueIndex: 0, victimUid: "", winner: "" }
  });

  localStorage.setItem("mm_room", code);
  localStorage.setItem("mm_uid", me.uid);
  listenRoom(code);
}

async function joinRoom() {
  const name = normalizeName($("nameInput").value);
  const code = $("roomInput").value.trim().toUpperCase();
  setError("homeError");
  if (!name) return setError("homeError", "Enter your name first.");
  if (!/^[A-Z0-9]{6}$/.test(code)) return setError("homeError", "Enter a valid 6-character room code.");
  await ensureAuth();

  const roomRef = ref(db, `rooms/${code}`);
  const snap = await get(roomRef);
  if (!snap.exists()) return setError("homeError", "Room not found.");
  const data = snap.val();
  const players = data.players || {};
  if (Object.keys(players).length >= 30) return setError("homeError", "This room is full.");
  if (data.status !== "lobby") return setError("homeError", "This game has already started.");

  await set(ref(db, `rooms/${code}/players/${me.uid}`), {
    name,
    alive: true,
    joinedAt: serverTimestamp()
  });
  roomCode = code;
  localStorage.setItem("mm_room", code);
  localStorage.setItem("mm_uid", me.uid);
  listenRoom(code);
}

function listenRoom(code) {
  if (unsub) unsub();
  roomCode = code;
  unsub = onValue(ref(db, `rooms/${code}`), snap => {
    if (!snap.exists()) {
      showView("homeView");
      setError("homeError", "Room no longer exists.");
      return;
    }
    room = snap.val();
    render();
  });
}

function render() {
  $("roomCodeLabel").textContent = roomCode || "—";
  const players = room.players || {};
  const list = Object.entries(players);

  if (room.status === "lobby") {
    showView("lobbyView");
    $("playerCount").textContent = `${list.length}/30`;
    $("playerList").innerHTML = list.map(([uid, p]) => `
      <div class="player-row">
        <span class="avatar">${escapeHtml(p.name.slice(0,1).toUpperCase())}</span>
        <span>${escapeHtml(p.name)}</span>
        ${uid === room.hostUid ? '<span class="host-label">HOST</span>' : ""}
      </div>
    `).join("");
    $("startBtn").disabled = me?.uid !== room.hostUid || list.length < 4;
    if (me?.uid !== room.hostUid) $("startBtn").textContent = "Waiting for host…";
    else $("startBtn").textContent = list.length < 4 ? `Need ${4-list.length} more player(s)` : "Start game";
    return;
  }

  if (room.status === "playing") {
    showView("gameView");
    renderGame();
    return;
  }

  if (room.status === "ended") {
    showView("endView");
    renderEnd();
  }
}

function renderGame() {
  const phase = room.phase || "investigation";
  const players = room.players || {};
  const mePlayer = players[me.uid];
  const role = room.privateRoles?.[me.uid]?.role || "innocent";

  const phaseNames = {
    investigation: ["INVESTIGATION", "The case is open."],
    voting: ["VOTING", "Choose your suspect."],
    result: ["RESULT", "The vote is in."]
  };
  $("phaseEyebrow").textContent = phaseNames[phase]?.[0] || phase.toUpperCase();
  $("phaseTitle").textContent = phaseNames[phase]?.[1] || "The case continues.";

  const roleInfo = ROLE_INFO[role] || ROLE_INFO.innocent;
  $("roleCard").innerHTML = `
    <div class="role-icon">${roleInfo.icon}</div>
    <div>
      <div class="eyebrow">YOUR SECRET ROLE</div>
      <h3>${roleInfo.label}</h3>
      <p>${roleInfo.text}</p>
    </div>
  `;

  const clueIndex = Number(room.public?.clueIndex || 0);
  const clue = CLUES[Math.min(clueIndex, CLUES.length - 1)];
  $("clueCard").innerHTML = `
    <div class="card-title"><span>CASE CLUE #${clueIndex + 1}</span></div>
    <p class="clue">${escapeHtml(clue)}</p>
  `;

  const alive = Object.entries(players).filter(([,p]) => p.alive);
  $("aliveCount").textContent = `${alive.length} alive`;
  $("suspectList").innerHTML = alive.map(([uid,p]) => `
    <div class="suspect-row ${uid === me.uid ? "me" : ""}">
      <span class="status-dot"></span>${escapeHtml(p.name)}
    </div>
  `).join("");

  renderAction(phase, role, mePlayer);
  $("hostControls").classList.toggle("hidden", me.uid !== room.hostUid);
  startTimer();
}

function renderAction(phase, role, mePlayer) {
  const actionCard = $("actionCard");
  if (!mePlayer?.alive) {
    actionCard.innerHTML = `<div class="dead-box">You are out of the investigation. You can still watch the game.</div>`;
    return;
  }

  const alive = Object.entries(room.players || {}).filter(([uid,p]) => p.alive && uid !== me.uid);

  if (phase === "investigation") {
    if (role === "murderer") {
      actionCard.innerHTML = `
        <div class="card-title"><span>SECRET ACTION</span><span class="pill red">MURDERER</span></div>
        <p>Choose a living target. Only your secret action is recorded.</p>
        <div class="choice-grid">${alive.map(([uid,p]) => `
          <button class="choice-btn" data-action="target" data-uid="${uid}">${escapeHtml(p.name)}</button>
        `).join("")}</div>
      `;
      bindChoiceButtons();
    } else if (role === "detective" || role === "investigator") {
      actionCard.innerHTML = `
        <div class="card-title"><span>SECRET INVESTIGATION</span><span class="pill">PRIVATE</span></div>
        <p>Choose one suspect to investigate. The result is shown only to you.</p>
        <div class="choice-grid">${alive.map(([uid,p]) => `
          <button class="choice-btn" data-action="inspect" data-uid="${uid}">${escapeHtml(p.name)}</button>
        `).join("")}</div>
        <div id="privateResult" class="private-result"></div>
      `;
      bindChoiceButtons();
    } else {
      actionCard.innerHTML = `
        <div class="card-title"><span>YOUR TASK</span></div>
        <p>Discuss the clue with your group. When the host opens voting, choose who you suspect.</p>
      `;
    }
  } else if (phase === "voting") {
    actionCard.innerHTML = `
      <div class="card-title"><span>CAST YOUR VOTE</span><span class="pill">ONE VOTE</span></div>
      <p>Your vote is private until the host resolves the round.</p>
      <div class="choice-grid">${alive.map(([uid,p]) => `
        <button class="choice-btn" data-action="vote" data-uid="${uid}">${escapeHtml(p.name)}</button>
      `).join("")}</div>
    `;
    bindChoiceButtons();
  } else {
    const result = room.public?.lastResult || {};
    actionCard.innerHTML = `
      <div class="result-box">
        <div class="eyebrow">ROUND RESULT</div>
        <h3>${escapeHtml(result.message || "The host is reviewing the result.")}</h3>
        ${result.inspectedName ? `<p>Your investigation: <b>${escapeHtml(result.inspectedName)}</b> was ${result.inspectedRole === "murderer" ? "a murderer." : "not a murderer."}</p>` : ""}
      </div>
    `;
  }
}

function bindChoiceButtons() {
  document.querySelectorAll(".choice-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const action = btn.dataset.action;
      const uid = btn.dataset.uid;
      try {
        if (action === "target") {
          await set(ref(db, `rooms/${roomCode}/privateActions/${me.uid}`), { type: "target", targetUid: uid });
          btn.parentElement.querySelectorAll("button").forEach(b => b.classList.remove("selected"));
          btn.classList.add("selected");
        }
        if (action === "inspect") {
          await set(ref(db, `rooms/${roomCode}/privateActions/${me.uid}`), { type: "inspect", targetUid: uid });
          const target = room.players?.[uid];
          const targetRole = room.privateRoles?.[uid]?.role || "unknown";
          const box = $("privateResult");
          if (box) box.innerHTML = `<b>Private result:</b> ${escapeHtml(target?.name || "Player")} is ${targetRole === "murderer" ? "a MURDERER." : "not a murderer."}`;
        }
        if (action === "vote") {
          await set(ref(db, `rooms/${roomCode}/votes/${me.uid}`), { targetUid: uid });
          btn.parentElement.querySelectorAll("button").forEach(b => b.classList.remove("selected"));
          btn.classList.add("selected");
        }
      } catch (e) {
        setError("hostError", e.message);
      }
    });
  });
}

async function startGame() {
  setError("lobbyError");
  if (me.uid !== room.hostUid) return;
  const entries = Object.entries(room.players || {});
  if (entries.length < 4) return setError("lobbyError", "At least 4 players are required.");
  if (entries.length > 30) return setError("lobbyError", "Maximum is 30 players.");

  const roles = [];
  roles.push(...Array(murdererCount(entries.length)).fill("murderer"));
  roles.push(...specialRoles(entries.length));
  while (roles.length < entries.length) roles.push("innocent");

  const shuffledRoles = shuffle(roles);
  const updates = {
    status: "playing",
    phase: "investigation",
    round: 1,
    "public/clueIndex": 0,
    "public/victimUid": "",
    "public/lastResult": null
  };

  entries.forEach(([uid], i) => {
    updates[`privateRoles/${uid}`] = { role: shuffledRoles[i] };
  });

  await update(ref(db, `rooms/${roomCode}`), updates);
}

async function hostResolveNight() {
  if (me.uid !== room.hostUid) return;
  const actions = room.privateActions || {};
  const targets = Object.entries(actions).filter(([,a]) => a.type === "target");
  const targetCounts = {};
  targets.forEach(([,a]) => {
    if (room.players?.[a.targetUid]?.alive) targetCounts[a.targetUid] = (targetCounts[a.targetUid] || 0) + 1;
  });
  const targetUid = Object.entries(targetCounts).sort((a,b) => b[1]-a[1])[0]?.[0] || "";

  const updates = {
    phase: "result",
    "public/clueIndex": Math.min(Number(room.public?.clueIndex || 0) + 1, CLUES.length - 1),
    "public/victimUid": targetUid,
    "public/lastResult/message": targetUid
      ? `${room.players[targetUid].name} has been removed from the case.`
      : "No secret target was selected this round."
  };
  if (targetUid) updates[`players/${targetUid}/alive`] = false;

  await update(ref(db, `rooms/${roomCode}`), updates);
}

async function openVoting() {
  if (me.uid !== room.hostUid) return;
  await update(ref(db, `rooms/${roomCode}`), {
    phase: "voting",
    "public/lastResult": null
  });
}

async function resolveVote() {
  if (me.uid !== room.hostUid) return;
  const votes = room.votes || {};
  const counts = {};
  Object.values(votes).forEach(v => {
    if (v?.targetUid && room.players?.[v.targetUid]?.alive) counts[v.targetUid] = (counts[v.targetUid] || 0) + 1;
  });
  const top = Object.entries(counts).sort((a,b) => b[1]-a[1]);
  if (!top.length) {
    return update(ref(db, `rooms/${roomCode}`), {
      phase: "result",
      "public/lastResult/message": "No votes were cast."
    });
  }

  const highest = top[0][1];
  const winners = top.filter(([,n]) => n === highest).map(([uid]) => uid);
  if (winners.length > 1) {
    return update(ref(db, `rooms/${roomCode}`), {
      phase: "result",
      "public/lastResult/message": "The vote was tied. Nobody was removed."
    });
  }

  const accused = winners[0];
  const role = room.privateRoles?.[accused]?.role;
  await update(ref(db, `rooms/${roomCode}`), {
    phase: "result",
    [`players/${accused}/alive`]: false,
    "public/lastResult/message": `${room.players[accused].name} was voted out.`
  });
}

async function newRound() {
  if (me.uid !== room.hostUid) return;
  const alive = Object.values(room.players || {}).filter(p => p.alive).length;
  const aliveMurderers = Object.entries(room.players || {}).filter(([uid,p]) =>
    p.alive && room.privateRoles?.[uid]?.role === "murderer"
  ).length;

  if (aliveMurderers === 0) return endGame("INNOCENTS WIN", "All murderers have been identified.");
  if (aliveMurderers >= alive - aliveMurderers) return endGame("MURDERERS WIN", "The murderers now control the investigation.");

  await update(ref(db, `rooms/${roomCode}`), {
    phase: "investigation",
    round: Number(room.round || 1) + 1,
    votes: null,
    privateActions: null,
    "public/lastResult": null,
    "public/victimUid": ""
  });
}

async function endGame(title, text) {
  await update(ref(db, `rooms/${roomCode}`), {
    status: "ended",
    winner: title,
    winnerText: text
  });
}

function renderEnd() {
  $("winnerTitle").textContent = room.winner || "Case closed.";
  $("winnerText").textContent = room.winnerText || "";
  const roles = room.privateRoles || {};
  $("finalRoles").innerHTML = Object.entries(room.players || {}).map(([uid,p]) => {
    const role = roles[uid]?.role || "unknown";
    return `<div class="final-role"><span>${escapeHtml(p.name)}</span><b>${escapeHtml((ROLE_INFO[role]?.label || role))}</b></div>`;
  }).join("");
}

function startTimer() {
  clearInterval(timerHandle);
  // Host-controlled phases do not auto-resolve. Timer is visual only.
  $("timer").textContent = `ROUND ${room.round || 1}`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

$("createBtn").addEventListener("click", () => createRoom().catch(e => setError("homeError", e.message)));
$("joinBtn").addEventListener("click", () => joinRoom().catch(e => setError("homeError", e.message)));
$("startBtn").addEventListener("click", () => startGame().catch(e => setError("lobbyError", e.message)));
$("resolveNightBtn").addEventListener("click", () => hostResolveNight().catch(e => setError("hostError", e.message)));
$("openVoteBtn").addEventListener("click", () => openVoting().catch(e => setError("hostError", e.message)));
$("resolveVoteBtn").addEventListener("click", () => resolveVote().catch(e => setError("hostError", e.message)));
$("newRoundBtn").addEventListener("click", () => newRound().catch(e => setError("hostError", e.message)));
$("endGameBtn").addEventListener("click", () => endGame("GAME ENDED", "The host ended the case.").catch(e => setError("hostError", e.message)));
$("backHomeBtn").addEventListener("click", () => {
  if (unsub) unsub();
  roomCode = null; room = null;
  showView("homeView");
});

window.addEventListener("load", async () => {
  try {
    await ensureAuth();
    const saved = localStorage.getItem("mm_room");
    if (saved) {
      const snap = await get(ref(db, `rooms/${saved}`));
      if (snap.exists() && snap.val().status !== "ended") {
        roomCode = saved;
        listenRoom(saved);
      }
    }
  } catch (e) {
    setError("homeError", "Firebase is not configured yet. Follow README.md.");
  }
});
