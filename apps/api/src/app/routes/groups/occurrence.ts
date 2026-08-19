import { Router } from 'express';
import { API_ENDPOINTS } from '@alarm/types';

import type { IdParams } from '../../../interfaces/IHttp';
import type { IRoute } from '../../../interfaces/IRouter';
import OccurrenceController from '../../controllers/OccurrenceController';
import { providerLimit } from '../../middleware/ApiLimits';
import { deviceAuth } from '../../middleware/DeviceAuth';
import { validate } from '../../middleware/ValidateRequest';
import { idParamSchema } from '../../validators/commonSchemas';
import {
    ackOccurrenceSchema,
    simulateOccurrenceSchema,
} from '../../validators/occurrenceSchemas';

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
            // Arming plans a journey, so it spends the same budget as a preview.
            providerLimit,
            validate({ params: idParamSchema }),
            this.controller.arm,
        );

        router.post<IdParams>(
            API_ENDPOINTS.OCCURRENCES.ACK(':id'),
            deviceAuth,
            validate({ params: idParamSchema, body: ackOccurrenceSchema }),
            this.controller.acknowledge,
        );

        // Test only, and device authenticated like everything else here.
        router.post<IdParams>(
            API_ENDPOINTS.OCCURRENCES.SIMULATE(':id'),
            deviceAuth,
            validate({ params: idParamSchema, body: simulateOccurrenceSchema }),
            this.controller.simulate,
        );

        // Plans a journey, so it pays the same provider budget as arming.
        router.post<IdParams>(
            API_ENDPOINTS.OCCURRENCES.RESET(':id'),
            deviceAuth,
            providerLimit,
            validate({ params: idParamSchema }),
            this.controller.reset,
        );

        // No `providerLimit`: it applies a plan that is already stored, so it
        // asks NS nothing.
        router.post<IdParams>(
            API_ENDPOINTS.OCCURRENCES.APPLY_PLAN(':id'),
            deviceAuth,
            validate({ params: idParamSchema }),
            this.controller.applyPlan,
        );

        // Neither plans anything, so neither pays the provider budget.
        router.post<IdParams>(
            API_ENDPOINTS.OCCURRENCES.SKIP(':id'),
            deviceAuth,
            validate({ params: idParamSchema }),
            this.controller.skip,
        );

        router.post<IdParams>(
            API_ENDPOINTS.OCCURRENCES.UNSKIP(':id'),
            deviceAuth,
            validate({ params: idParamSchema }),
            this.controller.unskip,
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
