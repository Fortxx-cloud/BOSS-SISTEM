import { checkWorkerHealth } from '../core/worker-registry.js';
import { config } from '../core/config.js';

let timer;

export function startHealthMonitor() {
    if (timer) return;

    const run = () => {
        try {
            checkWorkerHealth(config.workerTimeout);
        } catch (error) {
            console.error(
                '[HEALTH MONITOR]',
                error.message
            );
        }
    };

    run();

    timer = setInterval(
        run,
        config.heartbeatInterval
    );

    timer.unref();

    console.log('[BOSS] Health Monitor V3.1 aktif');
}

export function stopHealthMonitor() {
    if (!timer) return;

    clearInterval(timer);
    timer = null;
}
