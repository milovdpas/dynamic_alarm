import { Router } from 'express';
import { API_ENDPOINTS } from '@alarm/types';

import type { IRoute } from '../../../interfaces/IRouter';
import DeviceController from '../../controllers/DeviceController';
import { deviceAuth } from '../../middleware/DeviceAuth';
import { validate } from '../../middleware/ValidateRequest';
import { registerDeviceSchema, updateDeviceSchema } from '../../validators/deviceSchemas';

/**
 * Device registration and upkeep.
 *
 * Paths come from `API_ENDPOINTS` in `@alarm/types`, the same constant the app
 * calls, so a renamed route breaks the build rather than the request. They are
 * declared absolute there, so this group is mounted at the root.
 */
export default class DeviceRoutes implements IRoute {
    private readonly controller = new DeviceController();

    getRoutes(): Router {
        const router = Router();

        // The one route without `deviceAuth`: it creates the credential that
        // every other route requires.
        router.post(
            API_ENDPOINTS.DEVICES.REGISTER,
            validate({ body: registerDeviceSchema }),
            this.controller.register,
        );
        router.patch(
            API_ENDPOINTS.DEVICES.UPDATE(':id'),
            deviceAuth,
            validate({ body: updateDeviceSchema }),
            this.controller.update,
        );

        return router;
    }
}
