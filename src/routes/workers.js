import { Router } from 'express';

import {
    registerWorker,
    getWorkers,
    getWorker,
    updateHeartbeat,
    removeWorker,
    publicWorker
} from '../core/worker-registry.js';

const router = Router();

router.post('/register', (req, res) => {
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
            throw new Error('Invalid protocol');
        }
    } catch {
        return res.status(400).json({
            success: false,
            error: 'INVALID_ENDPOINT'
        });
    }

    const worker = registerWorker({
        name: String(name).slice(0, 80),
        endpoint,
        capacity
    });

    res.status(201).json({
        success: true,
        worker: publicWorker(worker)
    });
});

router.get('/', (req, res) => {
    const workers = getWorkers().map(publicWorker);

    res.json({
        success: true,
        total: workers.length,
        workers
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

router.post('/:id/heartbeat', (req, res) => {
    const worker = updateHeartbeat(req.params.id, req.body || {});

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

router.delete('/:id', (req, res) => {
    const removed = removeWorker(req.params.id);

    if (!removed) {
        return res.status(404).json({
            success: false,
            error: 'WORKER_NOT_FOUND'
        });
    }

    res.json({ success: true });
});

export default router;
