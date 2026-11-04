import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve('data');
const DB_FILE = path.join(DATA_DIR, 'workers.json');
const TEMP_FILE = `${DB_FILE}.tmp`;

fs.mkdirSync(DATA_DIR, { recursive: true });

export function loadDatabase() {
    try {
        if (!fs.existsSync(DB_FILE)) return [];

        const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));

        if (!Array.isArray(data)) {
            throw new Error('Invalid workers database');
        }

        return data.map(worker => ({
            ...worker,
            status: 'offline'
        }));
    } catch (error) {
        console.error('[DATABASE] Gagal membaca:', error.message);
        throw error;
    }
}

export function saveDatabase(workers) {
    const data = JSON.stringify(workers, null, 2);

    fs.writeFileSync(TEMP_FILE, data, { mode: 0o600 });
    fs.renameSync(TEMP_FILE, DB_FILE);
}
