import { Router } from 'express';
import { API_ENDPOINTS } from '@alarm/types';

import type { IdParams } from '../../../interfaces/IHttp';
import type { IRoute } from '../../../interfaces/IRouter';
import RoutineController from '../../controllers/RoutineController';
import { deviceAuth } from '../../middleware/DeviceAuth';
import { validate } from '../../middleware/ValidateRequest';
import { idParamSchema } from '../../validators/commonSchemas';
import { createRoutineSchema, updateRoutineSchema } from '../../validators/routineSchemas';

export default class RoutineRoutes implements IRoute {
    private readonly controller = new RoutineController();

    getRoutes(): Router {
        const router = Router();

        router.get(API_ENDPOINTS.ROUTINES.LIST, deviceAuth, this.controller.list);
        router.post(
            API_ENDPOINTS.ROUTINES.CREATE,
            deviceAuth,
            validate({ body: createRoutineSchema }),
            this.controller.create,
        );

        router.get<IdParams>(
            API_ENDPOINTS.ROUTINES.DETAIL(':id'),
            deviceAuth,
            validate({ params: idParamSchema }),
            this.controller.detail,
        );
        router.patch<IdParams>(
            API_ENDPOINTS.ROUTINES.DETAIL(':id'),
            deviceAuth,
            validate({ params: idParamSchema, body: updateRoutineSchema }),
            this.controller.update,
        );
        router.delete<IdParams>(
            API_ENDPOINTS.ROUTINES.DETAIL(':id'),
            deviceAuth,
            validate({ params: idParamSchema }),
            this.controller.remove,
        );

        return router;
    }
}
