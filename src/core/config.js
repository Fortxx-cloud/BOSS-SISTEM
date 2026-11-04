import 'dotenv/config';

const required = ['BOSS_SECRET', 'WORKER_JOIN_SECRET'];

for (const key of required) {
    if (!process.env[key] || process.env[key] === 'CHANGE_THIS_SECRET') {
        throw new Error(`Konfigurasi ${key} belum benar.`);
    }
}

const port = Number(process.env.SERVER_PORT || process.env.BOSS_PORT || 3101);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Port BOSS tidak valid.');
}

export const config = Object.freeze({
    env: process.env.NODE_ENV || 'development',
    host: process.env.BOSS_HOST || '0.0.0.0',
    port,
    secret: process.env.BOSS_SECRET,
    workerJoinSecret: process.env.WORKER_JOIN_SECRET,
    heartbeatInterval: Number(process.env.HEARTBEAT_INTERVAL || 15000),
    workerTimeout: Number(process.env.WORKER_TIMEOUT || 45000)
});
