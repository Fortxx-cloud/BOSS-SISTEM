import { randomUUID } from 'node:crypto';
import { loadTasks, saveTasks } from '../storage/task-database.js';

const DEFAULT_LEASE_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS = 3;

let operationChain = Promise.resolve();

function serialize(operation) {
  const result = operationChain.then(operation);
  operationChain = result.catch(() => {});
  return result;
}

function clone(value) {
  return structuredClone(value);
}

function validateWorkerId(workerId) {
  if (typeof workerId !== 'string' || !workerId.trim()) {
    throw new TypeError('workerId is required');
  }
}

function recoverExpiredTasks(tasks, now) {
  let changed = false;

  for (const task of tasks) {
    if (
      task.status !== 'processing' ||
      !task.leaseUntil ||
      new Date(task.leaseUntil).getTime() > now
    ) {
      continue;
    }

    task.workerId = null;
    task.leaseUntil = null;
    task.updatedAt = new Date(now).toISOString();

    if (task.attempts >= task.maxAttempts) {
      task.status = 'failed';
      task.error = 'Task lease expired; maximum attempts reached';
      task.finishedAt = task.updatedAt;
    } else {
      task.status = 'pending';
      task.error = 'Previous worker lease expired';
      task.availableAt = task.updatedAt;
    }

    changed = true;
  }

  return changed;
}

export function createTaskQueue({
  leaseMs = DEFAULT_LEASE_MS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS
} = {}) {
  if (!Number.isFinite(leaseMs) || leaseMs < 1000) {
    throw new TypeError('leaseMs must be at least 1000');
  }

  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new TypeError('maxAttempts must be a positive integer');
  }

  async function update(mutator) {
    return serialize(async () => {
      const tasks = await loadTasks();
      const result = await mutator(tasks);

      await saveTasks(tasks);
      return result;
    });
  }

  async function enqueue({
    type,
    payload = {},
    guildId = null,
    idempotencyKey = null,
    priority = 0,
    maxAttempts: taskMaxAttempts = maxAttempts,
    delayMs = 0
  }) {
    if (typeof type !== 'string' || !type.trim()) {
      throw new TypeError('Task type is required');
    }

    if (!Number.isInteger(taskMaxAttempts) || taskMaxAttempts < 1) {
      throw new TypeError('Task maxAttempts must be a positive integer');
    }

    if (!Number.isFinite(priority)) {
      throw new TypeError('Task priority must be a number');
    }

    if (!Number.isFinite(delayMs) || delayMs < 0) {
      throw new TypeError('delayMs must be zero or greater');
    }

    const serializedPayload = JSON.stringify(payload);
    if (serializedPayload === undefined) {
      throw new TypeError('Task payload must be JSON serializable');
    }

    return update((tasks) => {
      if (idempotencyKey) {
        const existing = tasks.find(
          (task) =>
            task.idempotencyKey === idempotencyKey &&
            !['failed'].includes(task.status)
        );

        if (existing) return clone(existing);
      }

      const now = Date.now();
      const timestamp = new Date(now).toISOString();

      const task = {
        id: randomUUID(),
        type: type.trim(),
        payload: JSON.parse(serializedPayload),
        guildId,
        idempotencyKey,
        priority,
        status: 'pending',
        attempts: 0,
        maxAttempts: taskMaxAttempts,
        workerId: null,
        leaseUntil: null,
        availableAt: new Date(now + delayMs).toISOString(),
        error: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        startedAt: null,
        finishedAt: null
      };

      tasks.push(task);
      return clone(task);
    });
  }

  async function claimNext(workerId, options = {}) {
    validateWorkerId(workerId);

    const requestedLease = options.leaseMs ?? leaseMs;
    const capabilities = options.capabilities;

    if (!Number.isFinite(requestedLease) || requestedLease < 1000) {
      throw new TypeError('leaseMs must be at least 1000');
    }

    if (
      capabilities !== undefined &&
      (!Array.isArray(capabilities) ||
       capabilities.some((item) => typeof item !== 'string' || !item.trim()))
    ) {
      throw new TypeError('capabilities must be an array of task type strings');
    }

    const supportedTypes = capabilities === undefined
      ? null
      : new Set(capabilities);

    return update((tasks) => {
      const now = Date.now();
      recoverExpiredTasks(tasks, now);

      const task = tasks
        .filter(
          (item) =>
            item.status === 'pending' &&
            new Date(item.availableAt).getTime() <= now &&
            item.attempts < item.maxAttempts &&
            (!supportedTypes || supportedTypes.has(item.type))
        )
        .sort(
          (a, b) =>
            b.priority - a.priority ||
            new Date(a.createdAt) - new Date(b.createdAt)
        )[0];

      if (!task) return null;

      const timestamp = new Date(now).toISOString();

      task.status = 'processing';
      task.workerId = workerId;
      task.attempts += 1;
      task.leaseUntil = new Date(now + requestedLease).toISOString();
      task.startedAt ??= timestamp;
      task.updatedAt = timestamp;
      task.error = null;

      return clone(task);
    });
  }

  async function acknowledge(taskId, workerId, result = null) {
    validateWorkerId(workerId);

    return update((tasks) => {
      const task = tasks.find((item) => item.id === taskId);

      if (!task) throw new Error('Task not found');
      if (task.status !== 'processing') {
        throw new Error('Task is not processing');
      }
      if (task.workerId !== workerId) {
        throw new Error('Task is owned by another worker');
      }
      if (new Date(task.leaseUntil).getTime() <= Date.now()) {
        throw new Error('Task lease has expired');
      }

      const timestamp = new Date().toISOString();

      task.status = 'completed';
      task.result = result;
      task.workerId = null;
      task.leaseUntil = null;
      task.updatedAt = timestamp;
      task.finishedAt = timestamp;

      return clone(task);
    });
  }

  async function fail(taskId, workerId, error, { retryDelayMs = 0 } = {}) {
    validateWorkerId(workerId);

    if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) {
      throw new TypeError('retryDelayMs must be zero or greater');
    }

    return update((tasks) => {
      const task = tasks.find((item) => item.id === taskId);

      if (!task) throw new Error('Task not found');
      if (task.status !== 'processing') {
        throw new Error('Task is not processing');
      }
      if (task.workerId !== workerId) {
        throw new Error('Task is owned by another worker');
      }
      if (new Date(task.leaseUntil).getTime() <= Date.now()) {
        throw new Error('Task lease has expired');
      }

      const now = Date.now();
      const timestamp = new Date(now).toISOString();

      task.error = String(error ?? 'Unknown task error');
      task.workerId = null;
      task.leaseUntil = null;
      task.updatedAt = timestamp;

      if (task.attempts < task.maxAttempts) {
        task.status = 'pending';
        task.availableAt = new Date(now + retryDelayMs).toISOString();
      } else {
        task.status = 'failed';
        task.finishedAt = timestamp;
      }

      return clone(task);
    });
  }

  async function getTask(taskId) {
    return serialize(async () => {
      const tasks = await loadTasks();
      const task = tasks.find((item) => item.id === taskId);
      return task ? clone(task) : null;
    });
  }

  async function listTasks({ status, limit = 100 } = {}) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new TypeError('limit must be a positive integer');
    }

    return serialize(async () => {
      const tasks = await loadTasks();

      return clone(
        tasks
          .filter((task) => !status || task.status === status)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, limit)
      );
    });
  }

  async function recoverExpired() {
    return update((tasks) => {
      const changed = recoverExpiredTasks(tasks, Date.now());
      return { changed };
    });
  }

  return {
    enqueue,
    claimNext,
    acknowledge,
    fail,
    getTask,
    listTasks,
    recoverExpired
  };
}
