import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'node:path';

import { config } from './core/config.js';
import { authenticate } from './core/auth.js';
import { startHealthMonitor, stopHealthMonitor } from './services/health-monitor.js';

import workerRoutes from './routes/workers.js';
import balancerRoutes from './routes/balancer.js';
import agentRoutes from './routes/agent.js';

const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: false }));
app.use(express.json({ limit: '32kb' }));

app.get('/health', (req, res) => {
    res.json({
        success: true,
        service: 'ZOMA BOSS',
        version: '4.2.0',
        status: 'online',
        timestamp: new Date().toISOString()
    });
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.resolve('dashboard/index.html'));
});

// Worker Agent authentication is separate from admin authentication.
app.use('/agent', agentRoutes);

app.use('/api', authenticate);
app.use('/api/workers', workerRoutes);
app.use('/api/balancer', balancerRoutes);

app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'ROUTE_NOT_FOUND'
    });
});

app.use((err, req, res, next) => {
    console.error('[BOSS ERROR]', err.message);

    res.status(err.status || 500).json({
        success: false,
        error: err.status === 400 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR'
    });
});

const server = app.listen(config.port, config.host, () => {
    console.log('================================');
    console.log('       ZOMA BOSS V4 ONLINE');
    console.log('================================');
    console.log(`Host: ${config.host}`);
    console.log(`Port: ${config.port}`);
    console.log('Agent: /agent');
    console.log('Dashboard: /dashboard');
    console.log('================================');

    startHealthMonitor();
});

function shutdown(signal) {
    console.log(`[BOSS] ${signal} diterima.`);

    stopHealthMonitor();

    server.close(() => {
        console.log('[BOSS] Server berhenti dengan aman.');
        process.exit(0);
    });

    setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
