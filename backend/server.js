const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3000;
const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT || 2);

const PROJECTS_FILE = path.join(__dirname, 'projects.json');
const HISTORY_FILE = path.join(__dirname, 'history.json');

// executionId -> { res, heartbeat }
const streams = new Map();

// executionId -> child_process
const processes = new Map();

// executionId -> execution metadata
const executions = new Map();

// queue: array of executionIds
const queue = [];

// ==========================
// helpers
// ==========================
function nowISO() {
  return new Date().toISOString();
}

function safeReadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function safeWriteJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function getProjects() {
  return safeReadJson(PROJECTS_FILE, []);
}

function appendHistory(record) {
  const history = safeReadJson(HISTORY_FILE, []);
  history.unshift(record);
  safeWriteJson(HISTORY_FILE, history.slice(0, 1000));
}

function sseSend(executionId, message) {
  const entry = streams.get(executionId);
  if (!entry) return;
  entry.res.write(`data: ${message}\n\n`);
}

function broadcastStats() {
  const running = processes.size;
  const queued = queue.length;
  const payload = `__STATS__:${JSON.stringify({
    running,
    maxConcurrent: MAX_CONCURRENT,
    queued
  })}`;

  // manda só para streams vivos (não precisa ser para todos, mas ajuda a UI)
  for (const [id] of streams) {
    sseSend(id, payload);
  }
}

function updateQueuePositions() {
  // Envia posição atual para cada item em fila
  for (let i = 0; i < queue.length; i++) {
    const executionId = queue[i];
    sseSend(executionId, `__QUEUEPOS__:${i + 1}`);
  }
  broadcastStats();
}

function setStatus(executionId, status) {
  const exec = executions.get(executionId);
  if (!exec) return;

  exec.status = status;
  exec.updatedAt = nowISO();

  sseSend(executionId, `__STATUS__:${status}`);
  broadcastStats();

  if (['SUCCESS', 'FAILED', 'CANCELLED'].includes(status)) {
    exec.endTime = Date.now();
    exec.finishedAt = nowISO();
    exec.durationMs = exec.endTime - exec.startTime;

    appendHistory({
      executionId: exec.executionId,
      projectId: exec.projectId,
      projectName: exec.projectName,
      scenarioId: exec.scenarioId,
      scenarioName: exec.scenarioName,
      file: exec.file,
      tags: exec.tags || [],
      environmentId: exec.environmentId,
      environmentName: exec.environmentName,
      baseUrl: exec.baseUrl,
      status: exec.status,
      startedAt: exec.startedAt,
      finishedAt: exec.finishedAt,
      durationMs: exec.durationMs
    });
  }
}

function closeStream(executionId) {
  const entry = streams.get(executionId);
  if (!entry) return;

  clearInterval(entry.heartbeat);
  try { entry.res.end(); } catch {}
  streams.delete(executionId);
}

function removeFromQueue(executionId) {
  const idx = queue.indexOf(executionId);
  if (idx !== -1) queue.splice(idx, 1);
  updateQueuePositions();
}

function startNextFromQueueIfPossible() {
  while (processes.size < MAX_CONCURRENT && queue.length > 0) {
    const nextId = queue.shift();
    updateQueuePositions();

    const exec = executions.get(nextId);
    if (!exec) continue;

    if (!streams.has(nextId)) {
      setStatus(nextId, 'CANCELLED');
      continue;
    }

    runExecution(nextId);
  }
}

function runExecution(executionId) {
  const exec = executions.get(executionId);
  if (!exec) return;

  setStatus(executionId, 'RUNNING');

  const child = spawn('npx', ['playwright', 'test', exec.file], {
    shell: true,
    env: {
      ...process.env,
      PROJECT_ID: exec.projectId,
      ENV_ID: exec.environmentId,
      ENV_NAME: exec.environmentName,
      BASE_URL: exec.baseUrl
    }
  });

  processes.set(executionId, child);
  broadcastStats();

  child.stdout.on('data', d => sseSend(executionId, d.toString()));
  child.stderr.on('data', d => sseSend(executionId, d.toString()));

  child.on('close', (code) => {
    processes.delete(executionId);
    broadcastStats();

    const current = executions.get(executionId);
    const wasCancelled = current?.status === 'CANCELLED';

    if (wasCancelled) {
      sseSend(executionId, `__END__:CANCELLED`);
      closeStream(executionId);
      startNextFromQueueIfPossible();
      return;
    }

    const finalStatus = code === 0 ? 'SUCCESS' : 'FAILED';
    setStatus(executionId, finalStatus);

    sseSend(executionId, `__END__:${code}`);
    closeStream(executionId);

    startNextFromQueueIfPossible();
  });
}

// ==========================
// Routes
// ==========================
app.get('/projects', (_, res) => {
  res.json(getProjects());
});

app.get('/history', (req, res) => {
  const limit = Math.min(Number(req.query.limit || 60), 500);
  const history = safeReadJson(HISTORY_FILE, []);
  res.json(history.slice(0, limit));
});

// Export histórico
app.get('/history/export', (req, res) => {
  const format = String(req.query.format || 'csv').toLowerCase();
  const history = safeReadJson(HISTORY_FILE, []);

  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="history.json"');
    return res.send(JSON.stringify(history, null, 2));
  }

  // CSV
  const headers = [
    'executionId','projectName','scenarioName','environmentName','status',
    'durationMs','startedAt','finishedAt','baseUrl','tags'
  ];

  const lines = [headers.join(',')];

  for (const h of history) {
    const row = [
      h.executionId,
      h.projectName,
      h.scenarioName,
      h.environmentName,
      h.status,
      String(h.durationMs ?? ''),
      h.startedAt,
      h.finishedAt,
      h.baseUrl,
      Array.isArray(h.tags) ? h.tags.join('|') : ''
    ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`);

    lines.push(row.join(','));
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="history.csv"');
  res.send(lines.join('\n'));
});

// Stats (para polling opcional)
app.get('/stats', (_, res) => {
  res.json({
    running: processes.size,
    maxConcurrent: MAX_CONCURRENT,
    queued: queue.length
  });
});

// SSE
app.get('/stream/:id', (req, res) => {
  const { id } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const heartbeat = setInterval(() => {
    try { res.write(`: ping\n\n`); } catch {}
  }, 15000);

  streams.set(id, { res, heartbeat });

  req.on('close', () => {
    clearInterval(heartbeat);
    streams.delete(id);
    broadcastStats();
  });

  // manda stats iniciais
  sseSend(id, `__STATS__:${JSON.stringify({
    running: processes.size,
    maxConcurrent: MAX_CONCURRENT,
    queued: queue.length
  })}`);
});

// RUN
app.post('/run', (req, res) => {
  const { executionId, projectId, scenarioId, environmentId } = req.body;

  const projects = getProjects();
  const project = projects.find(p => p.id === projectId);
  const scenario = project?.scenarios?.find(s => s.id === scenarioId);
  const environment = project?.environments?.find(e => e.id === environmentId);

  if (!project) return res.status(400).json({ ok: false, error: 'Invalid projectId' });
  if (!scenario) return res.status(400).json({ ok: false, error: 'Invalid scenarioId' });
  if (!environment) return res.status(400).json({ ok: false, error: 'Invalid environmentId' });

  executions.set(executionId, {
    executionId,
    projectId: project.id,
    projectName: project.name,
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    file: scenario.file,
    tags: scenario.tags || [],
    environmentId: environment.id,
    environmentName: environment.name,
    baseUrl: environment.baseUrl,
    status: 'CREATED',
    startedAt: nowISO(),
    updatedAt: nowISO(),
    startTime: Date.now()
  });

  res.json({ ok: true });

  if (!streams.has(executionId)) {
    setStatus(executionId, 'CANCELLED');
    return;
  }

  if (processes.size < MAX_CONCURRENT) {
    runExecution(executionId);
  } else {
    setStatus(executionId, 'QUEUED');
    queue.push(executionId);
    updateQueuePositions();
  }
});

// STOP
app.post('/stop', (req, res) => {
  const { executionId } = req.body;

  const exec = executions.get(executionId);
  if (!exec) return res.json({ stopped: false });

  if (queue.includes(executionId)) {
    removeFromQueue(executionId);
    setStatus(executionId, 'CANCELLED');
    sseSend(executionId, '__CANCELLED__');
    sseSend(executionId, '__END__:CANCELLED');
    closeStream(executionId);
    return res.json({ stopped: true, where: 'queue' });
  }

  const child = processes.get(executionId);
  if (child) {
    setStatus(executionId, 'CANCELLED');
    try { child.kill('SIGTERM'); } catch {}
    sseSend(executionId, '__CANCELLED__');
    return res.json({ stopped: true, where: 'running' });
  }

  return res.json({ stopped: false });
});

app.listen(PORT, () => {
  console.log(`🚀 Runner ativo em http://localhost:${PORT}`);
  console.log(`🔒 MAX_CONCURRENT = ${MAX_CONCURRENT}`);
});
