import type { Router } from 'express';
import { API_ENDPOINTS } from '@alarm/types';

import { AppDataSource } from '../../database/typeorm-db';
import Api from './api';

export default (router: Router): void => {
    /**
     * Health check.
     *
     * Reports the database separately rather than folding it into one boolean.
     * A process that is up but cannot reach Postgres is exactly the state where
     * the monitor loop stops moving alarms, and "ok" would hide it.
     */
    router.get(API_ENDPOINTS.HEALTH, (_req, res) => {
        const database = AppDataSource.isInitialized;
        res.status(database ? 200 : 503).json({
            status: database ? 'ok' : 'degraded',
            database,
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
        });
    });

    router.use(new Api().getRoutes());
};
