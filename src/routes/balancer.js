import { Router } from 'express';

import {
    selectWorker,
    reserveGuild,
    prepareFailover,
    confirmGuild,
    renewGuildReservation,
    cancelGuildReservation,
    releaseGuildRoute,
    getGuildRoute,
    getBalancerOverview
} from '../services/load-balancer.js';

const router = Router();

function validGuildId(value) {
    return typeof value === 'string' &&
        /^\d{17,20}$/.test(value);
}

function workerResponse(worker) {
    if (!worker) return null;

    return {
        id: worker.id,
        name: worker.name,
        endpoint: worker.endpoint,
        status: worker.status,
        nodeHealthy: worker.nodeHealthy !== false,
        players: worker.players,
        activeGuilds: worker.activeGuilds ?? null,
        pendingReservations: worker.pendingReservations ?? null,
        effectivePlayers: worker.effectivePlayers ?? null,
        capacity: worker.capacity,
        cpu: worker.cpu,
        memory: worker.memory,
        loadScore: worker.loadScore ?? null
    };
}

router.get('/select', (req, res) => {
    const worker = selectWorker();

    if (!worker) {
        return res.status(503).json({
            success: false,
            error: 'NO_AVAILABLE_WORKER'
        });
    }

    res.json({
        success: true,
        worker: workerResponse(worker)
    });
});

router.post('/reserve', (req, res) => {
    const { guildId } = req.body || {};

    if (!validGuildId(guildId)) {
        return res.status(400).json({
            success: false,
            error: 'INVALID_GUILD_ID'
        });
    }

    const result = reserveGuild(guildId);

    if (result?.unavailable) {
        return res.status(409).json({
            success: false,
            error: 'CURRENT_WORKER_UNAVAILABLE',
            oldWorkerId: result.oldWorkerId,
            action: 'PREPARE_FAILOVER'
        });
    }

    if (!result) {
        return res.status(503).json({
            success: false,
            error: 'NO_AVAILABLE_WORKER'
        });
    }

    res.json({
        success: true,
        guildId,
        reused: result.reused,
        reserved: result.reserved,
        worker: workerResponse(result.worker)
    });
});

router.post('/renew', (req, res) => {
    const { guildId } = req.body || {};

    if (!validGuildId(guildId)) {
        return res.status(400).json({
            success: false,
            error: 'INVALID_GUILD_ID'
        });
    }

    const reservation = renewGuildReservation(guildId);

    if (!reservation) {
        return res.status(409).json({
            success: false,
            error: 'RESERVATION_NOT_RENEWABLE'
        });
    }

    res.json({
        success: true,
        guildId,
        renewed: true,
        expiresAt: reservation.expiresAt
    });
});

router.delete('/cancel/:guildId', (req, res) => {
    const { guildId } = req.params;

    if (!validGuildId(guildId)) {
        return res.status(400).json({
            success: false,
            error: 'INVALID_GUILD_ID'
        });
    }

    const cancelled = cancelGuildReservation(guildId);

    res.json({
        success: true,
        guildId,
        cancelled
    });
});

router.post('/confirm', (req, res) => {
    const { guildId } = req.body || {};

    if (!validGuildId(guildId)) {
        return res.status(400).json({
            success: false,
            error: 'INVALID_GUILD_ID'
        });
    }

    const affinity = confirmGuild(guildId, 'normal');

    if (!affinity || affinity.error) {
        return res.status(409).json({
            success: false,
            error: affinity?.error || 'ACTIVE_RESERVATION_NOT_FOUND'
        });
    }

    res.json({
        success: true,
        guildId,
        workerId: affinity.workerId,
        previousWorkerId: affinity.previousWorkerId,
        confirmed: true
    });
});

router.post('/failover/prepare', (req, res) => {
    const { guildId } = req.body || {};

    if (!validGuildId(guildId)) {
        return res.status(400).json({
            success: false,
            error: 'INVALID_GUILD_ID'
        });
    }

    const result = prepareFailover(guildId);

    if (result?.error) {
        return res.status(409).json({
            success: false,
            error: result.error
        });
    }

    if (!result) {
        return res.status(503).json({
            success: false,
            error: 'NO_FAILOVER_WORKER_AVAILABLE'
        });
    }

    res.json({
        success: true,
        guildId,
        mode: 'failover',
        reused: result.reused,
        oldWorkerId: result.oldWorkerId,
        worker: workerResponse(result.worker),
        requiresPlayerRestore: true
    });
});

router.post('/failover/commit', (req, res) => {
    const { guildId } = req.body || {};

    if (!validGuildId(guildId)) {
        return res.status(400).json({
            success: false,
            error: 'INVALID_GUILD_ID'
        });
    }

    if (req.body?.restored !== true) {
        return res.status(409).json({
            success: false,
            error: 'PLAYER_RESTORE_ACKNOWLEDGMENT_REQUIRED'
        });
    }

    const affinity = confirmGuild(guildId, 'failover');

    if (!affinity || affinity.error) {
        return res.status(409).json({
            success: false,
            error: affinity?.error || 'FAILOVER_RESERVATION_NOT_FOUND'
        });
    }

    res.json({
        success: true,
        guildId,
        workerId: affinity.workerId,
        previousWorkerId: affinity.previousWorkerId,
        committed: true
    });
});

router.get('/guild/:guildId', (req, res) => {
    const { guildId } = req.params;

    if (!validGuildId(guildId)) {
        return res.status(400).json({
            success: false,
            error: 'INVALID_GUILD_ID'
        });
    }

    const result = getGuildRoute(guildId);

    if (!result) {
        return res.status(404).json({
            success: false,
            error: 'GUILD_ROUTE_NOT_FOUND'
        });
    }

    res.json({
        success: true,
        guildId,
        available: result.available,
        worker: workerResponse(result.worker),
        affinity: result.affinity
    });
});

router.get('/sessions', (req, res) => {
    res.json({
        success: true,
        ...getBalancerOverview()
    });
});

router.delete('/release/:guildId', (req, res) => {
    const { guildId } = req.params;

    if (!validGuildId(guildId)) {
        return res.status(400).json({
            success: false,
            error: 'INVALID_GUILD_ID'
        });
    }

    const released = releaseGuildRoute(guildId);

    res.json({
        success: true,
        guildId,
        released
    });
});

export default router;
