import { Router } from 'express';
import { API_ENDPOINTS } from '@alarm/types';

import type { IdParams } from '../../../interfaces/IHttp';
import type { IRoute } from '../../../interfaces/IRouter';
import PlaceController from '../../controllers/PlaceController';
import { deviceAuth } from '../../middleware/DeviceAuth';
import { validate } from '../../middleware/ValidateRequest';
import { idParamSchema } from '../../validators/commonSchemas';
import {
    autosuggestQuerySchema,
    createPlaceSchema,
    updatePlaceSchema,
} from '../../validators/placeSchemas';

/**
 * Each route states its whole contract on one line: who may call it, what it
 * accepts, and what handles it. The controller never runs on a request that
 * failed either check.
 */
export default class PlaceRoutes implements IRoute {
    private readonly controller = new PlaceController();

    getRoutes(): Router {
        const router = Router();

        // Declared before the `:id` route. Express matches in order, so the
        // literal path has to come first or `autosuggest` is read as an id and
        // answered with a 404 that looks like a missing place.
        router.get(
            API_ENDPOINTS.PLACES.AUTOSUGGEST,
            deviceAuth,
            validate({ query: autosuggestQuerySchema }),
            this.controller.autosuggest,
        );

        router.get(API_ENDPOINTS.PLACES.LIST, deviceAuth, this.controller.list);
        router.post(
            API_ENDPOINTS.PLACES.CREATE,
            deviceAuth,
            validate({ body: createPlaceSchema }),
            this.controller.create,
        );

        router.get<IdParams>(
            API_ENDPOINTS.PLACES.DETAIL(':id'),
            deviceAuth,
            validate({ params: idParamSchema }),
            this.controller.detail,
        );
        // Both parts at once, so a bad id and a bad body are reported together
        // rather than one round trip apart.
        router.patch<IdParams>(
            API_ENDPOINTS.PLACES.DETAIL(':id'),
            deviceAuth,
            validate({ params: idParamSchema, body: updatePlaceSchema }),
            this.controller.update,
        );
        router.delete<IdParams>(
            API_ENDPOINTS.PLACES.DETAIL(':id'),
            deviceAuth,
            validate({ params: idParamSchema }),
            this.controller.remove,
        );

        return router;
    }
}
