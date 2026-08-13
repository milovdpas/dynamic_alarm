import type { Router } from 'express';
import { API_ENDPOINTS } from '@alarm/types';
import type { HealthResponse } from '@alarm/types';

import { AppDataSource } from '../../database/typeorm-db';
import Api from './api';

export default (router: Router): void => {
    /**
     * Health check, and the one response deliberately outside the envelope.
     *
     * Load balancers and uptime checks read this, and none of them know about
     * `{ success, data }`. The status code carries the same answer, so nothing
     * is lost by staying plain.
     *
     * The database is reported separately rather than folded into one boolean.
     * A process that is up but cannot reach MySQL is exactly the state where the
     * monitor loop stops moving alarms, and "ok" would hide it.
     */
    router.get(API_ENDPOINTS.HEALTH, (_req, res) => {
        const database = AppDataSource.isInitialized;
        const body: HealthResponse = {
            status: database ? 'ok' : 'degraded',
            database,
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
        };
        res.status(database ? 200 : 503).json(body);
    });

    router.use(new Api().getRoutes());
};
