import { Router } from 'express';
import { API_ENDPOINTS } from '@alarm/types';

import type { IdParams } from '../../../interfaces/IHttp';
import type { IRoute } from '../../../interfaces/IRouter';
import ScheduleController from '../../controllers/ScheduleController';
import { deviceAuth } from '../../middleware/DeviceAuth';
import { validate } from '../../middleware/ValidateRequest';
import { idParamSchema } from '../../validators/commonSchemas';
import { createScheduleSchema, updateScheduleSchema } from '../../validators/scheduleSchemas';

export default class ScheduleRoutes implements IRoute {
    private readonly controller = new ScheduleController();

    getRoutes(): Router {
        const router = Router();

        router.get(API_ENDPOINTS.SCHEDULES.LIST, deviceAuth, this.controller.list);
        router.post(
            API_ENDPOINTS.SCHEDULES.CREATE,
            deviceAuth,
            validate({ body: createScheduleSchema }),
            this.controller.create,
        );

        router.get<IdParams>(
            API_ENDPOINTS.SCHEDULES.DETAIL(':id'),
            deviceAuth,
            validate({ params: idParamSchema }),
            this.controller.detail,
        );
        // Before the generic detail routes only for readability; the paths do
        // not overlap, since this one carries a suffix.
        router.get<IdParams>(
            API_ENDPOINTS.SCHEDULES.PLAN(':id'),
            deviceAuth,
            validate({ params: idParamSchema }),
            this.controller.plan,
        );
        router.patch<IdParams>(
            API_ENDPOINTS.SCHEDULES.DETAIL(':id'),
            deviceAuth,
            validate({ params: idParamSchema, body: updateScheduleSchema }),
            this.controller.update,
        );
        router.delete<IdParams>(
            API_ENDPOINTS.SCHEDULES.DETAIL(':id'),
            deviceAuth,
            validate({ params: idParamSchema }),
            this.controller.remove,
        );

        return router;
    }
}
