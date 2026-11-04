'use strict';

const $ = id => document.getElementById(id);

const state = {
    secret: sessionStorage.getItem('boss_secret') || '',
    workers: [],
    routing: null,
    history: [],
    page: 'overview',
    busy: false,
    timer: null,
    lastSuccess: null
};

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;'
})[c]);

const num = value => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
};

const pct = value => Math.max(0, Math.min(100, num(value)));

function injectV5() {
    const style = document.createElement('style');
    style.textContent = `
      .v5-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:16px 0}
      .v5-card{background:#10150f;border:1px solid #30382b;padding:15px;border-radius:8px;min-width:0}
      .v5-card small{display:block;color:#858d7b;font:10px monospace;letter-spacing:1px;margin-bottom:9px}
      .v5-card strong{font: bold 15px monospace;color:#c2d68a;overflow-wrap:anywhere}
      .v5-log{max-height:210px;overflow:auto;font:11px monospace}
      .v5-log-row{display:flex;gap:10px;padding:8px 0;border-bottom:1px solid #252c22;color:#aeb5a3}
      .v5-log-row b{color:#c2d68a;min-width:48px}
      .v5-good{color:#a8d887!important}.v5-bad{color:#e58b79!important}
      .v5-muted{color:#858d7b}
      @media(max-width:600px){.v5-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);

    const panel = document.createElement('section');
    panel.className = 'v5-grid';
    panel.innerHTML = `
      <div class="v5-card">
        <small>API DIAGNOSTICS</small>
        <div>Workers API: <strong id="v5-workers-api">WAITING</strong></div>
        <div style="margin-top:9px">Routing API: <strong id="v5-routing-api">WAITING</strong></div>
      </div>
      <div class="v5-card">
        <small>CONNECTION TELEMETRY</small>
        <div>Response: <strong id="v5-latency">—</strong></div>
        <div style="margin-top:9px">Last success: <strong id="v5-success">—</strong></div>
      </div>
      <div class="v5-card" style="grid-column:1/-1">
        <small>ACTIVITY LOG</small>
        <div id="v5-log" class="v5-log"><div class="v5-muted">Waiting for activity...</div></div>
      </div>`;
    $('notice').insertAdjacentElement('afterend', panel);
}

function log(message, type = 'INFO') {
    const box = $('v5-log');
    if (!box) return;
    const row = document.createElement('div');
    row.className = 'v5-log-row';
    const time = new Date().toLocaleTimeString('en-GB');
    row.innerHTML = `<b>${esc(time)}</b><span class="${type === 'ERROR' ? 'v5-bad' : type === 'OK' ? 'v5-good' : ''}">${esc(type)} — ${esc(message)}</span>`;
    if (box.querySelector('.v5-muted')) box.innerHTML = '';
    box.prepend(row);
    while (box.children.length > 30) box.lastElementChild.remove();
}

function diagnostic(id, text, good) {
    const el = $(id);
    if (!el) return;
    el.textContent = text;
    el.className = good ? 'v5-good' : 'v5-bad';
}

function setConnection(connected, label) {
    $('connection').innerHTML =
        `<span class="status-dot ${connected ? 'good' : 'bad'}"></span>${esc(label)}`;
    $('side-status').textContent = connected ? 'BOSS connected' : 'Awaiting connection';
    $('side-status').previousElementSibling.className =
        `pulse ${connected ? 'good' : 'bad'}`;
}

function showNotice(message) {
    $('notice').textContent = message;
    $('notice').classList.remove('hidden');
}

function hideNotice() {
    $('notice').classList.add('hidden');
}

async function api(path) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const started = performance.now();

    try {
        const response = await fetch(path, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${state.secret}`,
                Accept: 'application/json'
            },
            cache: 'no-store',
            signal: controller.signal
        });

        const elapsed = Math.round(performance.now() - started);
        let data;

        try {
            data = await response.json();
        } catch {
            throw new Error(`${path}: invalid JSON response (HTTP ${response.status})`);
        }

        if (response.status === 401 || response.status === 403) {
            const error = new Error('Authentication failed: BOSS rejected the API secret (HTTP ' + response.status + ').');
            error.auth = true;
            throw error;
        }

        if (!response.ok) {
            throw new Error(`${path}: HTTP ${response.status} — ${data.message || data.error || 'API request failed'}`);
        }

        return { data, elapsed };
    } catch (error) {
        if (error.name === 'AbortError') throw new Error(`${path}: request timeout (12s)`);
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

function renderMetrics() {
    const workers = state.workers;
    const online = workers.filter(w => w.status === 'online').length;
    const routing = state.routing || {};

    $('total').textContent = workers.length;
    $('online').textContent = online;
    $('guilds').textContent = routing.activeGuilds ?? 0;
    $('pending').textContent = routing.pendingReservations ?? 0;
    $('route-guilds').textContent = routing.activeGuilds ?? 0;
    $('route-pending').textContent = routing.pendingReservations ?? 0;
    $('route-expired').textContent = routing.expiredReservations ?? 0;

    $('api-status').textContent = 'OPERATIONAL';
    $('registry-status').textContent = 'CONNECTED';
    $('last-update').textContent = new Date().toLocaleTimeString();

    const cpu = workers.length ? workers.reduce((s, w) => s + num(w.cpu), 0) / workers.length : 0;
    const ram = workers.length ? workers.reduce((s, w) => s + num(w.memory), 0) / workers.length : 0;

    $('avg-cpu').textContent = `${cpu.toFixed(1)}%`;
    $('avg-ram').textContent = `${ram.toFixed(1)}%`;
    $('cpu-bar').style.width = `${pct(cpu)}%`;
    $('ram-bar').style.width = `${pct(ram)}%`;

    state.history.push({ cpu: pct(cpu), ram: pct(ram) });
    if (state.history.length > 30) state.history.shift();
    drawHistory();
}

function drawHistory() {
    const canvas = $('history-chart');
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (!rect.width) return;

    canvas.width = rect.width * dpr;
    canvas.height = 125 * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const width = rect.width, height = 125, pad = 8;
    ctx.strokeStyle = '#30362c';
    ctx.lineWidth = 1;

    for (let i = 0; i <= 4; i++) {
        const y = pad + (height - pad * 2) * i / 4;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }

    function line(key, color) {
        if (!state.history.length) return;
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;

        state.history.forEach((point, index) => {
            const x = state.history.length === 1 ? width : index * width / (state.history.length - 1);
            const y = height - pad - point[key] / 100 * (height - pad * 2);
            if (!index) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();
    }

    line('cpu', '#c2d68a');
    line('ram', '#9d9c79');
}

function workerMarkup(worker, compact = false) {
    const name = esc(worker.name || 'Unnamed worker');
    const endpoint = esc(worker.endpoint || 'Endpoint unavailable');
    const status = worker.status === 'online' ? 'online' : 'offline';
    const cpu = pct(worker.cpu), ram = pct(worker.memory);
    const node = worker.nodeHealthy === false ? 'UNHEALTHY' : 'REPORTED HEALTHY';

    if (compact) return `
      <div class="worker-line">
        <div>${name}<small>${endpoint}</small></div>
        <span class="status ${status}">● ${status.toUpperCase()}</span>
        <span>${num(worker.players)} players</span>
        <span>${cpu}% CPU / ${ram}% RAM</span>
      </div>`;

    return `<tr>
      <td>${name}<br><small>${endpoint}</small></td>
      <td><span class="status ${status}">● ${status.toUpperCase()}</span></td>
      <td>${num(worker.players)}</td><td>${cpu}%</td><td>${ram}%</td>
      <td>${num(worker.capacity)}</td><td>${esc(node)}</td>
    </tr>`;
}

function filterWorkers() {
    const query = ($('worker-search').value || '').toLowerCase();
    const filtered = state.workers.filter(w =>
        `${w.name || ''} ${w.endpoint || ''}`.toLowerCase().includes(query)
    );

    $('worker-table').innerHTML = filtered.length
        ? filtered.map(w => workerMarkup(w)).join('')
        : '<tr><td colspan="7" class="empty-state">No matching workers.</td></tr>';
}

function renderWorkers() {
    $('worker-count').textContent = `${state.workers.length} NODES`;

    $('overview-workers').innerHTML = state.workers.length
        ? state.workers.slice(0, 5).map(w => workerMarkup(w, true)).join('')
        : '<div class="empty-state">No workers registered. Registry is ready for its first agent.</div>';

    filterWorkers();
}

function renderRouting() {
    const routing = state.routing || {};
    const assignments = Array.isArray(routing.guilds) ? routing.guilds
        : Array.isArray(routing.sessions) ? routing.sessions : [];

    $('routing-detail').innerHTML = assignments.length
        ? assignments.map(item => `
          <div class="worker-line">
            <div>Guild ${esc(item.guildId || item.guild_id || '—')}</div>
            <span>${esc(item.workerId || item.worker_id || '—')}</span>
            <span>${esc(item.status || 'ASSIGNED')}</span>
            <span>${esc(item.mode || 'NORMAL')}</span>
          </div>`).join('')
        : '<div class="empty-state">No routing assignment details are currently exposed by the API.</div>';
}

async function refresh() {
    if (!state.secret || state.busy) return false;
    state.busy = true;

    try {
        const results = await Promise.allSettled([
            api('/api/workers'),
            api('/api/balancer/sessions')
        ]);

        const workerResult = results[0];
        const routingResult = results[1];

        diagnostic('v5-workers-api',
            workerResult.status === 'fulfilled' ? `OK · ${workerResult.value.elapsed}ms` : 'FAILED',
            workerResult.status === 'fulfilled');

        diagnostic('v5-routing-api',
            routingResult.status === 'fulfilled' ? `OK · ${routingResult.value.elapsed}ms` : 'FAILED',
            routingResult.status === 'fulfilled');

        const authError = results.find(r => r.status === 'rejected' && r.reason?.auth);
        if (authError) throw authError.reason;

        if (workerResult.status === 'rejected') throw workerResult.reason;
        if (routingResult.status === 'rejected') throw routingResult.reason;

        const workersData = workerResult.value.data;
        const routingData = routingResult.value.data;

        state.workers = Array.isArray(workersData.workers) ? workersData.workers : [];
        state.routing = routingData.routing || {};

        const latency = Math.max(workerResult.value.elapsed, routingResult.value.elapsed);
        $('v5-latency').textContent = `${latency} ms`;
        state.lastSuccess = new Date();
        $('v5-success').textContent = state.lastSuccess.toLocaleTimeString();

        setConnection(true, 'CONNECTED');
        $('api-status').textContent = 'OPERATIONAL';
        $('registry-status').textContent = 'CONNECTED';

        hideNotice();
        renderMetrics();
        renderWorkers();
        renderRouting();
        log(`Dashboard synchronized · ${state.workers.length} workers`, 'OK');
        return true;
    } catch (error) {
        setConnection(false, 'API ERROR');
        $('api-status').textContent = 'ERROR';
        showNotice(error.message);
        log(error.message, 'ERROR');

        if (error.auth) {
            sessionStorage.removeItem('boss_secret');
            state.secret = '';
            $('secret').value = '';
            log('Saved session cleared. Enter a valid BOSS API secret.', 'ERROR');
        }
        return false;
    } finally {
        state.busy = false;
    }
}

async function connect() {
    const secret = $('secret').value.trim();
    const button = $('connect-btn');

    if (!secret) {
        showNotice('Enter your BOSS API secret first.');
        $('secret').focus();
        return;
    }

    if (state.busy) return;

    button.disabled = true;
    button.textContent = 'VERIFYING...';
    state.secret = secret;
    log('Verifying administrator credentials...');

    const success = await refresh();

    if (success) {
        sessionStorage.setItem('boss_secret', secret);
        log('Administrator session authenticated.', 'OK');
    } else {
        sessionStorage.removeItem('boss_secret');
        state.secret = '';
        log('Connection was not authenticated. Secret was not saved.', 'ERROR');
    }

    button.disabled = false;
    button.textContent = success ? 'CONNECTED ✓' : 'CONNECT →';
}

function navigate() {
    const page = location.hash.replace('#', '') || 'overview';
    const allowed = ['overview', 'workers', 'routing'];
    state.page = allowed.includes(page) ? page : 'overview';

    document.querySelectorAll('.page').forEach(el =>
        el.classList.toggle('hidden', el.id !== `${state.page}-page`)
    );

    document.querySelectorAll('.nav-item').forEach(el =>
        el.classList.toggle('active', el.dataset.page === state.page)
    );

    $('page-title').textContent = {
        overview: 'Overview', workers: 'Worker fleet', routing: 'Routing'
    }[state.page];

    if (state.page === 'overview') requestAnimationFrame(drawHistory);
}

function updateClock() {
    $('clock').textContent = new Date().toLocaleTimeString('en-GB');
}

injectV5();

$('connect-btn').addEventListener('click', connect);
$('secret').addEventListener('keydown', e => {
    if (e.key === 'Enter') connect();
});
$('refresh-btn').addEventListener('click', () => refresh());
$('worker-reload').addEventListener('click', () => refresh());
$('worker-search').addEventListener('input', filterWorkers);

window.addEventListener('hashchange', navigate);
window.addEventListener('resize', drawHistory);

navigate();
updateClock();
setInterval(updateClock, 1000);

if (state.secret) {
    $('secret').value = state.secret;
    refresh();
}

state.timer = setInterval(() => {
    if (state.secret && !state.busy) refresh();
}, 10000);
