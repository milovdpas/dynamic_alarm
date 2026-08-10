import { Router } from 'express';

import type { IRoute } from '../../interfaces/IRouter';
import DeviceRoutes from './groups/device';

/**
 * API routes.
 *
 * One group per resource, each owning its own controller wiring. Groups are
 * mounted at the root because `API_ENDPOINTS` declares absolute paths, so the
 * app and the server read the same strings and a rename fails to compile rather
 * than 404ing at runtime.
 */
export default class Api implements IRoute {
    private readonly deviceRoutes = new DeviceRoutes();

    getRoutes(): Router {
        const router = Router();

        router.use(this.deviceRoutes.getRoutes());

        // Places, routines and schedules follow, then occurrences with the
        // monitor loop in M2.

        return router;
    }
}
