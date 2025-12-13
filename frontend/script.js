const projectsEl = document.getElementById("projects");
const historyEl = document.getElementById("history");
const refreshHistoryBtn = document.getElementById("refreshHistory");
const exportCsvBtn = document.getElementById("exportCsv");
const exportJsonBtn = document.getElementById("exportJson");
const statsEl = document.getElementById("stats");

const API = "http://localhost:3000";

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
        <strong>${it.projectName}</strong>
        <span class="small">•</span>
        <span class="small">${it.scenarioName}</span>
      </div>
      <div class="row">
        <span class="status ${it.status}">${it.status}</span>
        <span class="small">• ${it.environmentName}</span>
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

function updateStatsUI({ running, maxConcurrent, queued }) {
  statsEl.textContent = `Rodando: ${running}/${maxConcurrent} • Fila: ${queued}`;
}

async function refreshHistory() {
  const items = await loadHistory();
  renderHistory(items);
}

async function refreshStats() {
  const s = await loadStats();
  updateStatsUI(s);
}

function getProjectTags(project) {
  const tags = new Set();
  for (const sc of project.scenarios || []) {
    for (const t of sc.tags || []) tags.add(t);
  }
  return Array.from(tags).sort();
}

/**
 * Cria card de cenário e retorna também um "runner" programático
 * para permitir "Run All" e "Run Tag"
 */
function createScenarioCard({ project, scenario }) {
  const scenarioDiv = document.createElement("div");
  scenarioDiv.className = "scenario";

  const rowTop = document.createElement("div");
  rowTop.className = "row";

  const title = document.createElement("strong");
  title.textContent = scenario.name;

  const envSelect = document.createElement("select");
  for (const e of project.environments || []) {
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

  rowTop.appendChild(title);
  rowTop.appendChild(envSelect);

  // tags do cenário
  const tagsWrap = document.createElement("span");
  (scenario.tags || []).forEach((t) => {
    const pill = document.createElement("span");
    pill.className = "tagPill";
    pill.textContent = `#${t}`;
    tagsWrap.appendChild(pill);
  });
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

  const log = document.createElement("pre");

  scenarioDiv.appendChild(rowTop);
  scenarioDiv.appendChild(rowActions);
//   scenarioDiv.appendChild(log);

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
    if (st === "QUEUED" && queuePos) {
      status.textContent = `QUEUED (#${queuePos})`;
    } else {
      status.textContent = st;
    }
  }

  async function runOnce(customEnvId) {
    if (!project.environments || project.environments.length === 0) {
      alert("Este projeto não possui ambientes cadastrados.");
      return;
    }

    log.textContent = "";
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
        log.textContent += "\n[EXECUTION CANCELLED]\n";
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

      // log normal
      log.textContent += msg;
      log.scrollTop = log.scrollHeight;
    };

    source.onerror = async () => {
      stopTimer();
      setStatusUI("FAILED");
      log.textContent += "\n[SSE ERROR]\n";
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

function renderProjects(projects) {
  projectsEl.innerHTML = "";

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

    // Botão Run All
    const runAllBtn = document.createElement("button");
    runAllBtn.className = "ghost";
    runAllBtn.textContent = "▶ Run All";

    // Select de ambiente por projeto (aplica para Run All / Run Tag)
    const envSelectProject = document.createElement("select");
    for (const e of project.environments || []) {
      const opt = document.createElement("option");
      opt.value = e.id;
      opt.textContent = e.name;
      envSelectProject.appendChild(opt);
    }

    // Tags do projeto
    const tags = getProjectTags(project);
    const tagSelect = document.createElement("select");
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "Tag (opcional)";
    tagSelect.appendChild(opt0);

    for (const t of tags) {
      const o = document.createElement("option");
      o.value = t;
      o.textContent = `#${t}`;
      tagSelect.appendChild(o);
    }

    const runTagBtn = document.createElement("button");
    runTagBtn.className = "ghost";
    runTagBtn.textContent = "▶ Run Tag";

    tools.appendChild(envSelectProject);
    tools.appendChild(runAllBtn);
    tools.appendChild(tagSelect);
    tools.appendChild(runTagBtn);

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

    // Run All (dispara todos; backend controla fila/concurrency)
    runAllBtn.onclick = async () => {
      const envId = envSelectProject.value;
      // garante aberto
      scenariosDiv.style.display = "block";
      for (const item of scenarioRunners) {
        item.card.setSelectedEnv(envId);
        item.card.runOnce(envId);
      }
    };

    // Run Tag (dispara só os que contêm a tag)
    runTagBtn.onclick = async () => {
      const envId = envSelectProject.value;
      const tag = tagSelect.value;
      if (!tag) {
        alert("Selecione uma tag para rodar.");
        return;
      }
      scenariosDiv.style.display = "block";
      for (const item of scenarioRunners) {
        const scTags = item.scenario.tags || [];
        if (scTags.includes(tag)) {
          item.card.setSelectedEnv(envId);
          item.card.runOnce(envId);
        }
      }
    };

    div.appendChild(headerWrap);
    div.appendChild(scenariosDiv);
    projectsEl.appendChild(div);
  }
}

async function downloadFile(url, filename) {
  const r = await fetch(url);
  const blob = await r.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

exportCsvBtn.onclick = () =>
  downloadFile(`${API}/history/export?format=csv`, "history.csv");
exportJsonBtn.onclick = () =>
  downloadFile(`${API}/history/export?format=json`, "history.json");

refreshHistoryBtn.onclick = refreshHistory;

async function boot() {
  const projects = await loadProjects();
  renderProjects(projects);
  await refreshHistory();
  await refreshStats();

  // polling leve de stats (se SSE não estiver ativo em alguma execução)
  setInterval(refreshStats, 3000);
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

boot().catch((err) => {
  console.error(err);
  projectsEl.innerHTML = `<div style="color:#ef4444">Erro ao iniciar: ${String(
    err
  )}</div>`;
});
