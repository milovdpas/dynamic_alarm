import { Router } from 'express';
import { API_ENDPOINTS } from '@alarm/types';

import type { IdParams } from '../../../interfaces/IHttp';
import type { IRoute } from '../../../interfaces/IRouter';
import OccurrenceController from '../../controllers/OccurrenceController';
import { deviceAuth } from '../../middleware/DeviceAuth';
import { validate } from '../../middleware/ValidateRequest';
import { idParamSchema } from '../../validators/commonSchemas';
import { ackOccurrenceSchema } from '../../validators/occurrenceSchemas';

/**
 * One morning's alarm: reading it, arming it, confirming it, explaining it.
 *
 * Arming lives under the schedule it belongs to, because that is the thing being
 * armed. Everything else is addressed by occurrence.
 */
export default class OccurrenceRoutes implements IRoute {
    private readonly controller = new OccurrenceController();

    getRoutes(): Router {
        const router = Router();

        // Before the `:id` routes: Express matches in order, so "next" would
        // otherwise be read as an occurrence id and answered with a 422.
        router.get(API_ENDPOINTS.OCCURRENCES.LIST, deviceAuth, this.controller.list);
        router.get(API_ENDPOINTS.OCCURRENCES.NEXT, deviceAuth, this.controller.next);

        router.post<IdParams>(
            API_ENDPOINTS.SCHEDULES.ARM(':id'),
            deviceAuth,
            validate({ params: idParamSchema }),
            this.controller.arm,
        );

        router.post<IdParams>(
            API_ENDPOINTS.OCCURRENCES.ACK(':id'),
            deviceAuth,
            validate({ params: idParamSchema, body: ackOccurrenceSchema }),
            this.controller.acknowledge,
        );

        router.get<IdParams>(
            API_ENDPOINTS.OCCURRENCES.EVENTS(':id'),
            deviceAuth,
            validate({ params: idParamSchema }),
            this.controller.events,
        );

        return router;
    }
}
