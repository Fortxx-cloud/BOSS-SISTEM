import { Router } from 'express';
import crypto from 'node:crypto';

import { config } from '../core/config.js';
import { createTaskQueue } from '../services/task-queue.js';

const taskQueue = createTaskQueue();

import {
    registerAgentWorker,
    authenticateWorkerToken,
    updateHeartbeat,
    getWorker,
    publicWorker
} from '../core/worker-registry.js';

const router = Router();

function safeEqual(a, b) {
    if (!a || !b) return false;

    const x = Buffer.from(a);
    const y = Buffer.from(b);

    return x.length === y.length &&
        crypto.timingSafeEqual(x, y);
}

router.post('/register', (req, res) => {
    const supplied = req.headers['x-worker-join-secret'];

    if (!safeEqual(supplied, config.workerJoinSecret)) {
        return res.status(403).json({
            success: false,
            error: 'INVALID_JOIN_SECRET'
        });
    }

    const { name, endpoint, capacity } = req.body || {};

    if (!name || !endpoint) {
        return res.status(400).json({
            success: false,
            error: 'NAME_AND_ENDPOINT_REQUIRED'
        });
    }

    try {
        const url = new URL(endpoint);

        if (!['http:', 'https:'].includes(url.protocol)) {
            throw new Error('Invalid endpoint');
        }
    } catch {
        return res.status(400).json({
            success: false,
            error: 'INVALID_ENDPOINT'
        });
    }

    const result = registerAgentWorker({
        name,
        endpoint,
        capacity
    });

    res.status(201).json({
        success: true,
        worker: result.worker,
        token: result.token
    });
});

router.post('/:id/heartbeat', (req, res) => {
    const authorization = req.headers.authorization || '';
    const [scheme, token] = authorization.split(' ');

    if (
        scheme !== 'Bearer' ||
        !authenticateWorkerToken(req.params.id, token)
    ) {
        return res.status(403).json({
            success: false,
            error: 'INVALID_WORKER_TOKEN'
        });
    }

    const worker = updateHeartbeat(
        req.params.id,
        req.body || {}
    );

    if (!worker) {
        return res.status(404).json({
            success: false,
            error: 'WORKER_NOT_FOUND'
        });
    }

    res.json({
        success: true,
        worker: publicWorker(worker)
    });
});

router.get('/:id', (req, res) => {
    const worker = getWorker(req.params.id);

    if (!worker) {
        return res.status(404).json({
            success: false,
            error: 'WORKER_NOT_FOUND'
        });
    }

    res.json({
        success: true,
        worker: publicWorker(worker)
    });
});


// Worker Task Queue API
router.post('/tasks/claim', async (req, res, next) => {
    try {
        const authorization = req.headers.authorization || '';
        const [scheme, token] = authorization.split(' ');
        const workerId = req.body?.workerId;

        if (
            !workerId ||
            scheme !== 'Bearer' ||
            !authenticateWorkerToken(workerId, token)
        ) {
            return res.status(403).json({
                success: false,
                error: 'INVALID_WORKER_TOKEN'
            });
        }

        const capabilities = req.body?.capabilities;

        if (
            capabilities !== undefined &&
            (!Array.isArray(capabilities) ||
             capabilities.some((item) => typeof item !== 'string' || !item.trim()))
        ) {
            return res.status(400).json({
                success: false,
                error: 'INVALID_CAPABILITIES'
            });
        }

        const task = await taskQueue.claimNext(workerId, {
            capabilities
        });

        return res.json({
            success: true,
            task
        });
    } catch (error) {
        next(error);
    }
});

router.post('/tasks/:taskId/ack', async (req, res, next) => {
    try {
        const authorization = req.headers.authorization || '';
        const [scheme, token] = authorization.split(' ');
        const workerId = req.body?.workerId;

        if (
            !workerId ||
            scheme !== 'Bearer' ||
            !authenticateWorkerToken(workerId, token)
        ) {
            return res.status(403).json({
                success: false,
                error: 'INVALID_WORKER_TOKEN'
            });
        }

        const task = await taskQueue.acknowledge(
            req.params.taskId,
            workerId,
            req.body?.result ?? null
        );

        return res.json({
            success: true,
            task
        });
    } catch (error) {
        const status = error.message === 'Task not found' ? 404 : 409;

        return res.status(status).json({
            success: false,
            error: error.message
        });
    }
});

router.post('/tasks/:taskId/fail', async (req, res, next) => {
    try {
        const authorization = req.headers.authorization || '';
        const [scheme, token] = authorization.split(' ');
        const workerId = req.body?.workerId;

        if (
            !workerId ||
            scheme !== 'Bearer' ||
            !authenticateWorkerToken(workerId, token)
        ) {
            return res.status(403).json({
                success: false,
                error: 'INVALID_WORKER_TOKEN'
            });
        }

        const task = await taskQueue.fail(
            req.params.taskId,
            workerId,
            req.body?.error ?? 'Worker reported task failure',
            { retryDelayMs: req.body?.retryDelayMs ?? 0 }
        );

        return res.json({
            success: true,
            task
        });
    } catch (error) {
        const status = error.message === 'Task not found' ? 404 : 409;

        return res.status(status).json({
            success: false,
            error: error.message
        });
    }
});

export default router;
