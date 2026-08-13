import { Router } from 'express';

import type { IRoute } from '../../interfaces/IRouter';
import DeviceRoutes from './groups/device';
import MonitorRoutes from './groups/monitor';
import OccurrenceRoutes from './groups/occurrence';
import PlaceRoutes from './groups/place';
import PlanRoutes from './groups/plan';
import RoutineRoutes from './groups/routine';
import ScheduleRoutes from './groups/schedule';

/**
 * API routes.
 *
 * One group per resource, each owning its own controller wiring. Groups are
 * mounted at the root because `API_ENDPOINTS` declares absolute paths, so the
 * app and the server read the same strings and a rename fails to compile rather
 * than 404ing at runtime.
 */
export default class Api implements IRoute {
    private readonly groups: IRoute[] = [
        new DeviceRoutes(),
        new PlaceRoutes(),
        new RoutineRoutes(),
        new ScheduleRoutes(),
        new PlanRoutes(),
        new OccurrenceRoutes(),
        // Last, and not device authenticated: the scheduler calls it, the app
        // never does.
        new MonitorRoutes(),
    ];

    getRoutes(): Router {
        const router = Router();

        for (const group of this.groups) {
            router.use(group.getRoutes());
        }

        return router;
    }
}
