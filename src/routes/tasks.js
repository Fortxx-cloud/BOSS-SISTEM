import { Router } from 'express';
import { createTaskQueue } from '../services/task-queue.js';

const router = Router();
const queue = createTaskQueue();

router.post('/', async (req, res, next) => {
    try {
        const {
            type,
            payload,
            guildId,
            idempotencyKey,
            priority,
            maxAttempts,
            delayMs
        } = req.body || {};

        const task = await queue.enqueue({
            type,
            payload,
            guildId,
            idempotencyKey,
            priority,
            maxAttempts,
            delayMs
        });

        res.status(201).json({
            success: true,
            task
        });
    } catch (error) {
        if (error instanceof TypeError) {
            return res.status(400).json({
                success: false,
                error: error.message
            });
        }

        next(error);
    }
});

router.get('/', async (req, res, next) => {
    try {
        const limit = Number(req.query.limit || 100);
        const status = req.query.status || undefined;

        if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
            return res.status(400).json({
                success: false,
                error: 'INVALID_LIMIT'
            });
        }

        const tasks = await queue.listTasks({ status, limit });

        res.json({
            success: true,
            count: tasks.length,
            tasks
        });
    } catch (error) {
        next(error);
    }
});

router.get('/:taskId', async (req, res, next) => {
    try {
        const task = await queue.getTask(req.params.taskId);

        if (!task) {
            return res.status(404).json({
                success: false,
                error: 'TASK_NOT_FOUND'
            });
        }

        res.json({
            success: true,
            task
        });
    } catch (error) {
        next(error);
    }
});

export default router;
