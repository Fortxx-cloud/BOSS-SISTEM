import { getWorkers } from '../core/worker-registry.js';

import {
    getAffinity,
    getReservation,
    renewReservation,
    cancelReservation,
    getActiveGuildCount,
    getPendingReservationCount,
    saveReservation,
    confirmReservation,
    releaseGuild,
    getRoutingStats
} from './routing-state.js';

function metrics(worker) {
    const active = getActiveGuildCount(worker.id);
    const pending = getPendingReservationCount(worker.id);

    const players = Math.max(
        Number(worker.players) || 0,
        active
    );

    return {
        active,
        pending,
        players,
        total: players + pending
    };
}

function isHealthy(worker) {
    return Boolean(
        worker &&
        worker.status === 'online' &&
        worker.nodeHealthy !== false &&
        worker.capacity > 0 &&
        worker.cpu < 90 &&
        worker.memory < 90
    );
}

function available(worker, extraPending = 0) {
    const m = metrics(worker);

    return (
        isHealthy(worker) &&
        m.total + extraPending < worker.capacity
    );
}

function score(worker, extraPending = 0) {
    const m = metrics(worker);

    const playerLoad =
        (m.total + extraPending) / worker.capacity;

    const cpuLoad = worker.cpu / 100;
    const memoryLoad = worker.memory / 100;

    // Prioritaskan pemerataan player dan Guild aktif.
    return (
        playerLoad * 0.80 +
        cpuLoad * 0.10 +
        memoryLoad * 0.10
    );
}

function decorate(worker) {
    const m = metrics(worker);

    return {
        ...worker,
        activeGuilds: m.active,
        pendingReservations: m.pending,
        effectivePlayers: m.players,
        loadScore: Number(score(worker).toFixed(5))
    };
}

export function selectWorker(options = {}) {
    const excluded = new Set(
        options.excludeWorkerIds || []
    );

    const candidates = getWorkers()
        .filter(worker =>
            !excluded.has(worker.id) &&
            available(worker)
        );

    if (!candidates.length) return null;

    candidates.sort((a, b) => {
        const difference = score(a) - score(b);

        if (Math.abs(difference) > 0.000001) {
            return difference;
        }

        return a.id.localeCompare(b.id);
    });

    return decorate(candidates[0]);
}

export function reserveGuild(guildId) {
    const affinity = getAffinity(guildId);

    if (affinity) {
        const assigned = getWorkers().find(
            worker => worker.id === affinity.workerId
        );

        if (isHealthy(assigned)) {
            return {
                worker: decorate(assigned),
                reused: true,
                reserved: false
            };
        }

        return {
            unavailable: true,
            oldWorkerId: affinity.workerId
        };
    }

    const existing = getReservation(guildId);

    if (existing) {
        const worker = getWorkers().find(
            item => item.id === existing.workerId
        );

        if (worker && available(worker)) {
            return {
                worker: decorate(worker),
                reused: true,
                reserved: true
            };
        }

        releaseGuild(guildId);
    }

    const worker = selectWorker();

    if (!worker) return null;

    saveReservation(guildId, worker.id);

    return {
        worker: decorate(
            getWorkers().find(item => item.id === worker.id)
        ),
        reused: false,
        reserved: true
    };
}

export function prepareFailover(guildId) {
    const affinity = getAffinity(guildId);

    if (!affinity) {
        return { error: 'ACTIVE_GUILD_NOT_FOUND' };
    }

    const oldWorker = getWorkers().find(
        worker => worker.id === affinity.workerId
    );

    if (isHealthy(oldWorker)) {
        return { error: 'CURRENT_WORKER_STILL_ONLINE' };
    }

    const existing = getReservation(guildId);

    if (existing?.mode === 'failover') {
        const assigned = getWorkers().find(
            worker => worker.id === existing.workerId
        );

        if (isHealthy(assigned)) {
            return {
                worker: decorate(assigned),
                oldWorkerId: affinity.workerId,
                reused: true
            };
        }
    }

    const worker = selectWorker({
        excludeWorkerIds: [affinity.workerId]
    });

    if (!worker) return null;

    saveReservation(guildId, worker.id, {
        mode: 'failover',
        previousWorkerId: affinity.workerId
    });

    return {
        worker: decorate(
            getWorkers().find(item => item.id === worker.id)
        ),
        oldWorkerId: affinity.workerId,
        reused: false
    };
}

export function confirmGuild(guildId, expectedMode = 'normal') {
    const reservation = getReservation(guildId);

    if (!reservation) {
        return { error: 'ACTIVE_RESERVATION_NOT_FOUND' };
    }

    const actualMode = reservation.mode || 'normal';

    if (actualMode !== expectedMode) {
        return { error: 'RESERVATION_MODE_MISMATCH' };
    }

    const worker = getWorkers().find(
        item => item.id === reservation.workerId
    );

    if (!isHealthy(worker)) {
        return { error: 'TARGET_WORKER_UNHEALTHY' };
    }

    const affinity = confirmReservation(guildId);

    if (!affinity) {
        return { error: 'RESERVATION_EXPIRED_OR_INVALID' };
    }

    return affinity;
}

export function renewGuildReservation(guildId) {
    const reservation = getReservation(guildId);

    if (!reservation) return null;

    const worker = getWorkers().find(
        item => item.id === reservation.workerId
    );

    if (!isHealthy(worker)) return null;

    return renewReservation(guildId);
}

export function cancelGuildReservation(guildId) {
    return cancelReservation(guildId);
}

export function releaseGuildRoute(guildId) {
    return releaseGuild(guildId);
}

export function getGuildRoute(guildId) {
    const affinity = getAffinity(guildId);

    if (!affinity) return null;

    const worker = getWorkers().find(
        item => item.id === affinity.workerId
    );

    return {
        affinity,
        worker: worker ? decorate(worker) : null,
        available: isHealthy(worker)
    };
}

export function getBalancerOverview() {
    const workers = getWorkers();

    return {
        workers: workers.map(worker => ({
            id: worker.id,
            name: worker.name,
            status: worker.status,
            nodeHealthy: worker.nodeHealthy !== false,
            players: worker.players,
            activeGuilds: getActiveGuildCount(worker.id),
            pendingReservations:
                getPendingReservationCount(worker.id),
            capacity: worker.capacity,
            cpu: worker.cpu,
            memory: worker.memory,
            loadScore: Number(score(worker).toFixed(5))
        })),
        routing: getRoutingStats()
    };
}
