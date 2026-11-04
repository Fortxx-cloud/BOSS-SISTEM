import {
    randomUUID,
    randomBytes,
    createHash,
    timingSafeEqual
} from 'node:crypto';

import {
    loadDatabase,
    saveDatabase
} from '../storage/database.js';

const workers = new Map(
    loadDatabase().map(worker => [worker.id, worker])
);

function hashToken(token) {
    return createHash('sha256').update(token).digest('hex');
}

function persist() {
    saveDatabase([...workers.values()]);
}

export function publicWorker(worker) {
    if (!worker) return null;

    const {
        tokenHash,
        ...safe
    } = worker;

    return safe;
}

export function registerWorker(data) {
    const now = Date.now();

    const worker = {
        id: data.id || randomUUID(),
        name: String(data.name).slice(0, 80),
        endpoint: data.endpoint,
        status: 'online',
        players: 0,
        cpu: 0,
        memory: 0,
        nodeHealthy: true,
        capacity: Math.max(1, Number(data.capacity) || 100),
        registeredAt: now,
        lastHeartbeat: now
    };

    workers.set(worker.id, worker);
    persist();

    return worker;
}

export function registerAgentWorker(data) {
    const workerToken = randomBytes(32).toString('hex');

    const worker = registerWorker(data);

    worker.tokenHash = hashToken(workerToken);
    worker.agent = true;

    persist();

    return {
        worker: publicWorker(worker),
        token: workerToken
    };
}

export function authenticateWorkerToken(id, token) {
    const worker = workers.get(id);

    if (!worker?.tokenHash || !token) return false;

    const expected = Buffer.from(worker.tokenHash);
    const received = Buffer.from(hashToken(token));

    return (
        expected.length === received.length &&
        timingSafeEqual(expected, received)
    );
}

export function getWorkers() {
    return [...workers.values()];
}

export function getWorker(id) {
    return workers.get(id) || null;
}

export function updateHeartbeat(id, metrics = {}) {
    const worker = workers.get(id);

    if (!worker) return null;

    const number = (value, fallback = 0) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    };

    worker.players = Math.max(0, number(metrics.players));
    worker.cpu = Math.min(100, Math.max(0, number(metrics.cpu)));
    worker.memory = Math.min(100, Math.max(0, number(metrics.memory)));

    worker.nodeHealthy = metrics.nodeHealthy !== false;
    worker.lastHeartbeat = Date.now();
    worker.status = 'online';

    persist();

    return worker;
}

export function removeWorker(id) {
    const removed = workers.delete(id);

    if (removed) persist();

    return removed;
}

export function checkWorkerHealth(timeout) {
    const now = Date.now();
    let changed = false;

    for (const worker of workers.values()) {
        if (
            worker.status !== 'offline' &&
            now - worker.lastHeartbeat > timeout
        ) {
            worker.status = 'offline';
            changed = true;
        }
    }

    if (changed) persist();
}
