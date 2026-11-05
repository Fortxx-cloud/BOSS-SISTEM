import fs from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = path.resolve('data');
const TASK_FILE = path.join(DATA_DIR, 'tasks.json');
const TEMP_FILE = `${TASK_FILE}.tmp`;

let writeChain = Promise.resolve();

export async function loadTasks() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    const raw = await fs.readFile(TASK_FILE, 'utf8');
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      throw new Error('Invalid task database format');
    }

    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function saveTasks(tasks) {
  if (!Array.isArray(tasks)) {
    throw new TypeError('Tasks must be an array');
  }

  const operation = writeChain.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });

    const json = JSON.stringify(tasks, null, 2);

    await fs.writeFile(TEMP_FILE, json, {
      encoding: 'utf8',
      mode: 0o600
    });

    await fs.rename(TEMP_FILE, TASK_FILE);
  });

  writeChain = operation.catch(() => {});
  return operation;
}
