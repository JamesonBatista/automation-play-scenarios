const projectsEl = document.getElementById("projects");
const historyEl = document.getElementById("history");
const statsEl = document.getElementById("stats");
const clearHistoryBtn = document.getElementById("clearHistory");

const API = "http://localhost:3000";

/* ==========================
   👤 USER (SIMPLES)
========================== */

const USERS = [
  { name: "Roberto", projects: ["ACSELE"] },
  { name: "Maria", projects: ["GTI", "CLAIMS"] },
  { name: "Admin", projects: ["ACSELE", "GTI", "CLAIMS", "AXAHUB"] },
];

const CURRENT_USER = "Maria"; // 🔐 troca aqui

function getCurrentUser() {
  return USERS.find((u) => u.name === CURRENT_USER) || null;
}

function filterProjectsByUser(projects, user) {
  if (!user || !Array.isArray(user.projects)) return [];
  const allowed = user.projects.map((p) => String(p).toLowerCase());
  return (projects || []).filter((p) =>
    allowed.includes(String(p.id).toLowerCase())
  );
}

/* ==========================
   UTIL
========================== */

function generateExecutionId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function msToHuman(ms) {
  const s = Math.floor((ms || 0) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r}s`;
}

function formatDateBR(isoString) {
  if (!isoString) return "-";
  const date = new Date(isoString);
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/* ==========================
   API LOADERS
========================== */

async function loadProjects() {
  const r = await fetch(`${API}/projects`);
  return await r.json();
}

async function loadHistory() {
  const r = await fetch(`${API}/history?limit=80`);
  return await r.json();
}

async function loadStats() {
  const r = await fetch(`${API}/stats`);
  return await r.json();
}

/* ==========================
   STATS
========================== */

function updateStatsUI({ running, maxConcurrent, queued }) {
  statsEl.textContent = `Rodando: ${running}/${maxConcurrent} • Fila: ${queued}`;
}

async function refreshStats() {
  const s = await loadStats();
  updateStatsUI(s);
}

/* ==========================
   HISTORY
========================== */

function renderHistory(items) {
  historyEl.innerHTML = "";

  if (!items || items.length === 0) {
    historyEl.innerHTML = `<div class="small">Sem histórico ainda.</div>`;
    return;
  }

  for (const it of items) {
    const div = document.createElement("div");
    div.className = "histItem";
    div.innerHTML = `
      <div class="row">
        <strong>${it.projectName || "-"}</strong>
        <span class="small">•</span>
        <span class="small">${it.scenarioName || "-"}</span>
      </div>
      <div class="row">
        <span class="status ${it.status || ""}">${it.status || "-"}</span>
        <span class="small">• ${it.environmentName || "-"}</span>
        <span class="small">• ${msToHuman(it.durationMs || 0)}</span>
      </div>
      <div class="small">
        ${formatDateBR(it.startedAt)} → ${formatDateBR(it.finishedAt)}
      </div>
      <div class="small">Tags: ${(it.tags || []).join(", ") || "-"}</div>
    `;
    historyEl.appendChild(div);
  }
}

async function refreshHistory() {
  const items = await loadHistory();
  renderHistory(items);
}

/* ==========================
   TAGS HELPERS
========================== */

function getProjectTags(project) {
  const tags = new Set();
  for (const sc of project.scenarios || []) {
    for (const t of sc.tags || []) tags.add(t);
  }
  return Array.from(tags).sort();
}

/* ==========================
   SCENARIO CARD
========================== */

function createScenarioCard({ project, scenario }) {
  const scenarioDiv = document.createElement("div");
  scenarioDiv.className = "scenario";

  const rowTop = document.createElement("div");
  rowTop.className = "row";

  const title = document.createElement("strong");
  title.textContent = scenario.name || scenario.id || "Sem nome";

  const envSelect = document.createElement("select");
  for (const e of project.environments || []) {
    const opt = document.createElement("option");
    opt.value = e.id;
    opt.textContent = e.name;
    envSelect.appendChild(opt);
  }

  const tagsWrap = document.createElement("span");
  (scenario.tags || []).forEach((t) => {
    const pill = document.createElement("span");
    pill.className = "tagPill";
    pill.textContent = `#${t}`;
    tagsWrap.appendChild(pill);
  });

  const status = document.createElement("span");
  status.className = "status";
  status.textContent = "IDLE";

  const timer = document.createElement("span");
  timer.className = "meta";
  timer.textContent = "⏱️ 0s";

  rowTop.appendChild(title);
  rowTop.appendChild(envSelect);
  rowTop.appendChild(tagsWrap);
  rowTop.appendChild(status);
  rowTop.appendChild(timer);

  const rowActions = document.createElement("div");
  rowActions.className = "row";

  const playBtn = document.createElement("button");
  playBtn.className = "primary";
  playBtn.textContent = "▶ Play";

  const stopBtn = document.createElement("button");
  stopBtn.className = "danger";
  stopBtn.textContent = "⛔ Stop";
  stopBtn.style.display = "none";

  rowActions.appendChild(playBtn);
  rowActions.appendChild(stopBtn);

  scenarioDiv.appendChild(rowTop);
  scenarioDiv.appendChild(rowActions);

  let source = null;
  let executionId = null;
  let startedAt = null;
  let interval = null;
  let queuePos = null;

  function setUIStateIdle() {
    playBtn.disabled = false;
    playBtn.textContent = "▶ Play";
    stopBtn.style.display = "none";
    stopBtn.disabled = false;
    queuePos = null;
    timer.textContent = "⏱️ 0s";
  }

  function startTimer() {
    startedAt = Date.now();
    timer.textContent = "⏱️ 0s";
    interval = setInterval(() => {
      const ms = Date.now() - startedAt;
      timer.textContent = `⏱️ ${msToHuman(ms)}`;
    }, 1000);
  }

  function stopTimer() {
    clearInterval(interval);
    interval = null;
  }

  function setStatusUI(st) {
    status.className = `status ${st}`;
    if (st === "QUEUED" && queuePos) status.textContent = `QUEUED (#${queuePos})`;
    else status.textContent = st;
  }

  async function runOnce(customEnvId) {
    if (!project.environments || project.environments.length === 0) {
      alert("Este projeto não possui ambientes cadastrados.");
      return;
    }

    playBtn.disabled = true;
    playBtn.textContent = "⏳";
    stopBtn.style.display = "inline-block";
    stopBtn.disabled = false;

    executionId = generateExecutionId();
    const environmentId = customEnvId || envSelect.value;

    queuePos = null;
    setStatusUI("CONNECTING");
    startTimer();

    // abre SSE
    source = new EventSource(`${API}/stream/${executionId}`);

    source.onopen = async () => {
      setStatusUI("QUEUED");
      await fetch(`${API}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          executionId,
          projectId: project.id,
          scenarioId: scenario.id,
          environmentId,
        }),
      });
    };

    source.onmessage = (event) => {
      const msg = event.data;

      if (msg.startsWith("__STATS__:")) {
        try {
          const payload = JSON.parse(msg.replace("__STATS__:", ""));
          updateStatsUI(payload);
        } catch {}
        return;
      }

      if (msg.startsWith("__QUEUEPOS__:")) {
        queuePos = Number(msg.split(":")[1]);
        setStatusUI("QUEUED");
        return;
      }

      if (msg.startsWith("__STATUS__:")) {
        const st = msg.split(":")[1];
        setStatusUI(st);
        return;
      }

      if (msg === "__CANCELLED__") {
        setStatusUI("CANCELLED");
        return;
      }

      if (msg.startsWith("__END__")) {
        const parts = msg.split(":");
        const code = parts[1];

        stopTimer();

        if (code === "0") setStatusUI("SUCCESS");
        else if (code === "CANCELLED") setStatusUI("CANCELLED");
        else setStatusUI("FAILED");

        try {
          source.close();
        } catch {}
        source = null;

        setUIStateIdle();
        refreshHistory();
        return;
      }
    };

    source.onerror = async () => {
      stopTimer();
      setStatusUI("FAILED");
      try {
        source.close();
      } catch {}
      source = null;
      setUIStateIdle();
      await refreshStats();
    };

    stopBtn.onclick = async () => {
      stopBtn.disabled = true;
      await fetch(`${API}/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ executionId }),
      });
    };
  }

  playBtn.onclick = () => runOnce();

  return {
    element: scenarioDiv,
    runOnce,
    getSelectedEnv: () => envSelect.value,
    setSelectedEnv: (envId) => {
      envSelect.value = envId;
    },
  };
}

/* ==========================
   PROJECT RENDER
========================== */

function renderProjects(projects) {
  projectsEl.innerHTML = "";

  if (!projects || projects.length === 0) {
    projectsEl.innerHTML = `<div class="small">Nenhum projeto disponível para este usuário.</div>`;
    return;
  }

  for (const project of projects) {
    const div = document.createElement("div");
    div.className = "project";

    const headerWrap = document.createElement("div");
    headerWrap.className = "projectHeader";

    const scenariosCount = (project.scenarios || []).length;

    const title = document.createElement("h3");
    title.className = "projectTitle";
    title.innerHTML = `<span>📦 ${project.name}</span><span class="badge">${scenariosCount} cenário(s)</span>`;

    const tools = document.createElement("div");
    tools.className = "projectTools";

    // Select de ambiente por projeto (aplica para Run All)
    const envSelectProject = document.createElement("select");
    for (const e of project.environments || []) {
      const opt = document.createElement("option");
      opt.value = e.id;
      opt.textContent = e.name;
      envSelectProject.appendChild(opt);
    }

    // Botão Run All
    const runAllBtn = document.createElement("button");
    runAllBtn.className = "ghost";
    runAllBtn.textContent = "▶ Run All";

    tools.appendChild(envSelectProject);
    tools.appendChild(runAllBtn);

    headerWrap.appendChild(title);
    headerWrap.appendChild(tools);

    const scenariosDiv = document.createElement("div");
    scenariosDiv.className = "scenarios";

    title.onclick = () => {
      scenariosDiv.style.display =
        scenariosDiv.style.display === "block" ? "none" : "block";
    };

    // cria cards e guarda runners
    const scenarioRunners = [];
    for (const scenario of project.scenarios || []) {
      const card = createScenarioCard({ project, scenario });
      scenarioRunners.push({ scenario, card });
      scenariosDiv.appendChild(card.element);
    }

    // Run All
    runAllBtn.onclick = async () => {
      if (!scenarioRunners.length) {
        alert("Este projeto não possui cenários cadastrados.");
        return;
      }
      const envId = envSelectProject.value;

      scenariosDiv.style.display = "block";
      for (const item of scenarioRunners) {
        item.card.setSelectedEnv(envId);
        item.card.runOnce(envId);
      }
    };

    div.appendChild(headerWrap);
    div.appendChild(scenariosDiv);
    projectsEl.appendChild(div);
  }
}

/* ==========================
   CLEAR HISTORY
========================== */

if (clearHistoryBtn) {
  clearHistoryBtn.onclick = async () => {
    const ok = confirm("Deseja realmente limpar todo o histórico?");
    if (!ok) return;

    // exige rota DELETE /history no backend
    await fetch(`${API}/history`, { method: "DELETE" });
    await refreshHistory();
  };
}

/* ==========================
   BOOT
========================== */

async function boot() {
  const user = getCurrentUser();
  if (!user) {
    projectsEl.innerHTML = `<div style="color:#ef4444">Usuário não autorizado</div>`;
    return;
  }

  const projects = await loadProjects();
  const visibleProjects = filterProjectsByUser(projects, user);

  renderProjects(visibleProjects);
  await refreshHistory();
  await refreshStats();

  // polling leve de stats (se não houver SSE ativo)
  setInterval(refreshStats, 3000);
}

boot().catch((err) => {
  console.error(err);
  projectsEl.innerHTML = `<div style="color:#ef4444">Erro ao iniciar: ${String(err)}</div>`;
});
