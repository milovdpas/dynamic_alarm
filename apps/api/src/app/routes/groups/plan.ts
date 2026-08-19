import { Router } from 'express';
import { API_ENDPOINTS } from '@alarm/types';

import type { IRoute } from '../../../interfaces/IRouter';
import PlanController from '../../controllers/PlanController';
import { providerLimit } from '../../middleware/ApiLimits';
import { deviceAuth } from '../../middleware/DeviceAuth';
import { validate } from '../../middleware/ValidateRequest';
import { planPreviewSchema } from '../../validators/planSchemas';

export default class PlanRoutes implements IRoute {
    private readonly controller = new PlanController();

    getRoutes(): Router {
        const router = Router();

        router.post(
            API_ENDPOINTS.PLAN.PREVIEW,
            deviceAuth,
            providerLimit,
            validate({ body: planPreviewSchema }),
            this.controller.preview,
        );

        // Same body as the preview: the options are the same question asked
        // once, with every answer returned instead of only the best one.
        router.post(
            API_ENDPOINTS.PLAN.OPTIONS,
            deviceAuth,
            providerLimit,
            validate({ body: planPreviewSchema }),
            this.controller.options,
        );

        return router;
    }
}
