import { Router } from 'express';
import { API_ENDPOINTS } from '@alarm/types';

import type { IRoute } from '../../../interfaces/IRouter';
import MonitorController from '../../controllers/MonitorController';
import { monitorAuth } from '../../middleware/MonitorAuth';

/**
 * The monitor loop's entry point. Server side only.
 *
 * The app never calls this and holds no token for it, which is why it sits
 * behind `monitorAuth` rather than `deviceAuth`. On the VPS the caller is the
 * Ofelia scheduler, which execs into this container once a minute; the labels
 * that declare that job live in `docker-compose.prod.yml` beside the service,
 * so the schedule deploys with the code rather than being configured by hand on
 * the server.
 */
export default class MonitorRoutes implements IRoute {
    private readonly controller = new MonitorController();

    getRoutes(): Router {
        const router = Router();

        router.post(API_ENDPOINTS.MONITOR.TICK, monitorAuth, this.controller.tick);

        return router;
    }
}
