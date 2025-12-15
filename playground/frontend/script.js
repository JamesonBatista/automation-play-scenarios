const API = "http://localhost:3000";

/* ==========================
   USERS (FRONT AUTH)
========================== */

const USERS = [
  { name: "Roberto", password: "123", projects: ["ACSELE", "CLAIMS"] },
  { name: "Maria", password: "123", projects: ["GTI", "CLAIMS"] },
  {
    name: "Admin",
    password: "admin",
    projects: ["ACSELE", "GTI", "CLAIMS", "AXAHUB"],
  },
];

/* ==========================
   ELEMENTS
========================== */

const loginScreen = document.getElementById("loginScreen");
const appScreen = document.getElementById("app");
const loginUserInput = document.getElementById("loginUser");
const loginPassInput = document.getElementById("loginPass");
const loginBtn = document.getElementById("loginBtn");
const loginError = document.getElementById("loginError");

const logoutBtn = document.getElementById("logoutBtn");
const clearHistoryBtn = document.getElementById("clearHistory");

const projectsEl = document.getElementById("projects");
const historyEl = document.getElementById("history");
const statsEl = document.getElementById("stats");

/* ==========================
   CTRL + R = LIMPA LOGIN
========================== */

// const nav = performance.getEntriesByType("navigation")[0];
// if (nav && nav.type === "reload") {
//   localStorage.removeItem("loggedUser");
// }

/* ==========================
   AUTH
========================== */

function getLoggedUser() {
  const raw = localStorage.getItem("loggedUser");
  return raw ? JSON.parse(raw) : null;
}

function login(user, pass) {
  const found = USERS.find((u) => u.name === user && u.password === pass);
  if (!found) return null;

  localStorage.setItem("loggedUser", JSON.stringify(found));
  return found;
}

function logout() {
  localStorage.removeItem("loggedUser");
  location.reload();
}

function showLogin() {
  loginScreen.style.display = "flex";
  appScreen.style.display = "none";
}

function showApp() {
  loginScreen.style.display = "none";
  appScreen.style.display = "block";
}

/* ==========================
   LOGIN ACTION
========================== */

if (loginBtn) {
  loginBtn.type = "button";
  loginBtn.onclick = () => {
    const user = loginUserInput.value.trim();
    const pass = loginPassInput.value.trim();

    const logged = login(user, pass);
    if (!logged) {
      loginError.textContent = "Usuário ou senha inválidos";
      return;
    }

    startApp(logged);
  };
}

if (logoutBtn) {
  logoutBtn.type = "button";
  logoutBtn.onclick = logout;
}

/* ==========================
   UTIL
========================== */

function generateExecutionId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function msToHuman(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r}s`;
}

function formatDateBR(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("pt-BR");
}

/* ==========================
   API LOADERS
========================== */

async function loadProjects() {
  return (await fetch(`${API}/projects`)).json();
}

async function loadHistory() {
  return (await fetch(`${API}/history?limit=80`)).json();
}

async function loadStats() {
  return (await fetch(`${API}/stats`)).json();
}

/* ==========================
   CORE
========================== */

function filterProjectsByUser(projects, user) {
  const allowed = user.projects.map((p) => p.toLowerCase());
  return projects.filter((p) => allowed.includes(p.id.toLowerCase()));
}

function updateStatsUI({ running, maxConcurrent, queued }) {
  statsEl.textContent = `Rodando: ${running}/${maxConcurrent} • Fila: ${queued}`;
}

/* ==========================
   HISTORY
========================== */

async function refreshHistory() {
  const items = await loadHistory();
  historyEl.innerHTML = "";

  if (!items.length) {
    historyEl.innerHTML = `<div class="small">Sem histórico.</div>`;
    return;
  }

  for (const it of items) {
    const div = document.createElement("div");
    div.className = "histItem";
    div.innerHTML = `
      <div class="row">
        <strong>${it.projectName}</strong>
        <span class="small">• ${it.scenarioName}</span>
      </div>
      <div class="row">
        <span class="status ${it.status}">${it.status}</span>
        <span class="small">• ${it.environmentName}</span>
        <span class="small">• ${msToHuman(it.durationMs || 0)}</span>
      </div>
      <div class="small">
        ${formatDateBR(it.startedAt)} → ${formatDateBR(it.finishedAt)}
      </div>
    `;
    historyEl.appendChild(div);
  }
}

/* ==========================
   SCENARIO CARD
========================== */

function createScenarioCard({ project, scenario }) {
  const el = document.createElement("div");
  el.className = "scenario";

  const rowTop = document.createElement("div");
  rowTop.className = "row";

  const title = document.createElement("strong");
  title.textContent = scenario.name;

  const envSelect = document.createElement("select");
  for (const e of project.environments) {
    const opt = document.createElement("option");
    opt.value = e.id;
    opt.textContent = e.name;
    envSelect.appendChild(opt);
  }

  const status = document.createElement("span");
  status.className = "status";
  status.textContent = "IDLE";

  const timer = document.createElement("span");
  timer.className = "meta";
  timer.textContent = "⏱️ 0s";

  rowTop.append(title, envSelect, status, timer);

  const actions = document.createElement("div");
  actions.className = "row";

  const playBtn = document.createElement("button");
  playBtn.type = "button";
  playBtn.className = "primary";
  playBtn.textContent = "▶ Play";

  const stopBtn = document.createElement("button");
  stopBtn.type = "button";
  stopBtn.className = "danger";
  stopBtn.textContent = "⛔ Stop";
  stopBtn.style.display = "none";

  actions.append(playBtn, stopBtn);
  el.append(rowTop, actions);

  let execId, source, startedAt, interval, queuePos;

  function setStatus(st) {
    status.className = `status ${st}`;
    status.textContent =
      st === "QUEUED" && queuePos ? `QUEUED (#${queuePos})` : st;
  }

  function startTimer() {
    startedAt = Date.now();
    interval = setInterval(() => {
      timer.textContent = `⏱️ ${msToHuman(Date.now() - startedAt)}`;
    }, 1000);
  }

  function stopTimer() {
    clearInterval(interval);
    timer.textContent = "⏱️ 0s";
  }

  async function runOnce(customEnv) {
    execId = generateExecutionId();
    playBtn.disabled = true;
    stopBtn.style.display = "inline-block";
    setStatus("CONNECTING");
    startTimer();

    source = new EventSource(`${API}/stream/${execId}`);

    source.onopen = async () => {
      setStatus("QUEUED");
      await fetch(`${API}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          executionId: execId,
          projectId: project.id,
          scenarioId: scenario.id,
          environmentId: customEnv || envSelect.value,
        }),
      });
    };

    source.onmessage = (e) => {
      const msg = e.data;

      if (msg.startsWith("__QUEUEPOS__:")) {
        queuePos = Number(msg.split(":")[1]);
        setStatus("QUEUED");
        return;
      }

      if (msg.startsWith("__STATUS__:")) {
        setStatus(msg.split(":")[1]);
        return;
      }

      if (msg.startsWith("__END__")) {
        stopTimer();
        playBtn.disabled = false;
        stopBtn.style.display = "none";
        source.close();
        refreshHistory();
      }
    };

    stopBtn.onclick = async () => {
      await fetch(`${API}/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ executionId: execId }),
      });
    };
  }

  playBtn.onclick = () => runOnce();

  return {
    element: el,
    runOnce,
    setSelectedEnv: (envId) => (envSelect.value = envId),
  };
}

/* ==========================
   PROJECTS (RUN ALL + ENV)
========================== */

function renderProjects(projects) {
  projectsEl.innerHTML = "";

  for (const project of projects) {
    const div = document.createElement("div");
    div.className = "project";

    const header = document.createElement("div");
    header.className = "projectHeader";

    const title = document.createElement("h3");
    title.className = "projectTitle";
    title.textContent = `📦 ${project.name}`;

    const countBadge = document.createElement("span");
    countBadge.className = "badge";
    countBadge.textContent = `${project.scenarios.length} cenários`;
    title.appendChild(countBadge);

    const tools = document.createElement("div");
    tools.className = "projectTools";

    const envSelectProject = document.createElement("select");
    for (const e of project.environments) {
      const opt = document.createElement("option");
      opt.value = e.id;
      opt.textContent = e.name;
      envSelectProject.appendChild(opt);
    }

    const runAllBtn = document.createElement("button");
    runAllBtn.type = "button";
    runAllBtn.className = "ghost";
    runAllBtn.textContent = "▶ Run All";

    tools.append(envSelectProject, runAllBtn);
    header.append(title, tools);

    const scenariosDiv = document.createElement("div");
    scenariosDiv.className = "scenarios";

    title.onclick = () => {
      scenariosDiv.style.display =
        scenariosDiv.style.display === "block" ? "none" : "block";
    };

    const runners = [];
    for (const sc of project.scenarios) {
      const card = createScenarioCard({ project, scenario: sc });
      runners.push(card);
      scenariosDiv.appendChild(card.element);
    }

    runAllBtn.onclick = () => {
      const envId = envSelectProject.value;
      scenariosDiv.style.display = "block";
      for (const r of runners) {
        r.setSelectedEnv(envId);
        r.runOnce(envId);
      }
    };

    div.append(header, scenariosDiv);
    projectsEl.appendChild(div);
  }
}

/* ==========================
   CLEAR HISTORY
========================== */

if (clearHistoryBtn) {
  clearHistoryBtn.type = "button";
  clearHistoryBtn.onclick = async () => {
    const ok = confirm("Deseja realmente limpar todo o histórico?");
    if (!ok) return;

    await fetch(`${API}/history`, { method: "DELETE" });
    refreshHistory();
  };
}

/* ==========================
   START
========================== */

async function startApp(user) {
  showApp();

  const projects = await loadProjects();
  const visible = filterProjectsByUser(projects, user);

  renderProjects(visible);
  refreshHistory();
  updateStatsUI(await loadStats());

  setInterval(async () => {
    updateStatsUI(await loadStats());
  }, 3000);
}

const logged = getLoggedUser();
if (!logged) showLogin();
else startApp(logged);
