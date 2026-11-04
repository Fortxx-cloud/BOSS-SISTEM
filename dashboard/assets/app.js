'use strict';

const $ = id => document.getElementById(id);

const state = {
    secret: sessionStorage.getItem('boss_secret') || '',
    workers: [],
    routing: null,
    history: [],
    page: 'overview',
    timer: null
};

function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    })[char]);
}

function number(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function percent(value) {
    return Math.max(0, Math.min(100, number(value)));
}

function setConnection(connected, label) {
    $('connection').innerHTML =
        `<span class="status-dot ${connected ? 'good' : 'bad'}"></span>${escapeHTML(label)}`;

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
    const response = await fetch(path, {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${state.secret}`,
            Accept: 'application/json'
        },
        cache: 'no-store'
    });

    if (response.status === 401 || response.status === 403) {
        throw new Error('Authentication failed. Check your BOSS API secret.');
    }

    if (!response.ok) {
        throw new Error(`API request failed (${response.status})`);
    }

    return response.json();
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

    const cpu = workers.length
        ? workers.reduce((sum, w) => sum + number(w.cpu), 0) / workers.length
        : 0;

    const ram = workers.length
        ? workers.reduce((sum, w) => sum + number(w.memory), 0) / workers.length
        : 0;

    $('avg-cpu').textContent = `${cpu.toFixed(1)}%`;
    $('avg-ram').textContent = `${ram.toFixed(1)}%`;
    $('cpu-bar').style.width = `${percent(cpu)}%`;
    $('ram-bar').style.width = `${percent(ram)}%`;

    state.history.push({
        cpu: percent(cpu),
        ram: percent(ram),
        time: Date.now()
    });

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
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = 125;
    const pad = 8;

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
            const x = state.history.length === 1
                ? width
                : index * width / (state.history.length - 1);

            const y = height - pad -
                (point[key] / 100) * (height - pad * 2);

            if (index === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });

        ctx.stroke();
    }

    line('cpu', '#c2d68a');
    line('ram', '#9d9c79');
}

function workerStatus(worker) {
    return worker.status === 'online' ? 'online' : 'offline';
}

function workerMarkup(worker, compact = false) {
    const name = escapeHTML(worker.name || 'Unnamed worker');
    const endpoint = escapeHTML(worker.endpoint || 'Endpoint unavailable');
    const status = workerStatus(worker);
    const cpu = percent(worker.cpu);
    const ram = percent(worker.memory);
    const node = worker.nodeHealthy === false ? 'UNHEALTHY' : 'REPORTED HEALTHY';

    if (compact) {
        return `
        <div class="worker-line">
            <div>${name}<small>${endpoint}</small></div>
            <span class="status ${status}">● ${status.toUpperCase()}</span>
            <span>${number(worker.players)} players</span>
            <span>${cpu}% CPU / ${ram}% RAM</span>
        </div>`;
    }

    return `
    <tr>
        <td>${name}<br><small>${endpoint}</small></td>
        <td><span class="status ${status}">● ${status.toUpperCase()}</span></td>
        <td>${number(worker.players)}</td>
        <td>${cpu}%</td>
        <td>${ram}%</td>
        <td>${number(worker.capacity)}</td>
        <td>${escapeHTML(node)}</td>
    </tr>`;
}

function renderWorkers() {
    if (!state.workers.length) {
        $('overview-workers').innerHTML =
            '<div class="empty-state">No workers registered. The registry is ready for its first agent.</div>';

        $('worker-table').innerHTML =
            '<tr><td colspan="7" class="empty-state">No registered workers.</td></tr>';

        $('worker-count').textContent = '0 NODES';
        return;
    }

    $('overview-workers').innerHTML =
        state.workers.slice(0, 5).map(w => workerMarkup(w, true)).join('');

    $('worker-count').textContent = `${state.workers.length} NODES`;

    filterWorkers();
}

function filterWorkers() {
    const query = ($('worker-search').value || '').toLowerCase();

    const filtered = state.workers.filter(worker =>
        `${worker.name} ${worker.endpoint}`.toLowerCase().includes(query)
    );

    $('worker-table').innerHTML = filtered.length
        ? filtered.map(w => workerMarkup(w)).join('')
        : '<tr><td colspan="7" class="empty-state">No matching workers.</td></tr>';
}

function renderRouting() {
    const routing = state.routing || {};

    const assignments = Array.isArray(routing.guilds)
        ? routing.guilds
        : Array.isArray(routing.sessions)
            ? routing.sessions
            : [];

    if (!assignments.length) {
        $('routing-detail').innerHTML =
            '<div class="empty-state">No routing assignment details are currently exposed by the API. Summary metrics above remain live.</div>';
        return;
    }

    $('routing-detail').innerHTML = assignments.map(item => `
        <div class="worker-line">
            <div>Guild ${escapeHTML(item.guildId || item.guild_id || '—')}</div>
            <span>${escapeHTML(item.workerId || item.worker_id || '—')}</span>
            <span>${escapeHTML(item.status || 'ASSIGNED')}</span>
            <span>${escapeHTML(item.mode || 'NORMAL')}</span>
        </div>
    `).join('');
}

async function refresh() {
    if (!state.secret) return;

    try {
        const [workers, sessions] = await Promise.all([
            api('/api/workers'),
            api('/api/balancer/sessions')
        ]);

        state.workers = Array.isArray(workers.workers) ? workers.workers : [];
        state.routing = sessions.routing || {};

        setConnection(true, 'CONNECTED');
        hideNotice();

        renderMetrics();
        renderWorkers();
        renderRouting();

    } catch (error) {
        setConnection(false, 'API ERROR');
        showNotice(error.message);

        if (error.message.includes('Authentication failed')) {
            sessionStorage.removeItem('boss_secret');
            state.secret = '';
        }
    }
}

function connect() {
    const secret = $('secret').value.trim();

    if (!secret) {
        showNotice('Enter your BOSS API secret first.');
        return;
    }

    state.secret = secret;
    sessionStorage.setItem('boss_secret', secret);
    refresh();
}

function navigate() {
    const page = location.hash.replace('#', '') || 'overview';
    const allowed = ['overview', 'workers', 'routing'];

    state.page = allowed.includes(page) ? page : 'overview';

    document.querySelectorAll('.page').forEach(el => {
        el.classList.toggle('hidden', el.id !== `${state.page}-page`);
    });

    document.querySelectorAll('.nav-item').forEach(el => {
        el.classList.toggle('active', el.dataset.page === state.page);
    });

    const titles = {
        overview: 'Overview',
        workers: 'Worker fleet',
        routing: 'Routing'
    };

    $('page-title').textContent = titles[state.page];
}

function updateClock() {
    $('clock').textContent = new Date().toLocaleTimeString('en-GB');
}

$('connect-btn').addEventListener('click', connect);
$('secret').addEventListener('keydown', event => {
    if (event.key === 'Enter') connect();
});

$('refresh-btn').addEventListener('click', refresh);
$('worker-reload').addEventListener('click', refresh);
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
    if (state.secret) refresh();
}, 10000);
