import type { Request, RequestHandler, Response } from 'express';

import { DeviceService } from '../services/DeviceService';
import { requireDevice } from '../middleware/DeviceAuth';
import { sendSuccess } from '../utils/ApiResponses';
import { registerDeviceSchema, updateDeviceSchema } from '../validators/deviceSchemas';
import Controller from './Controller';

export default class DeviceController extends Controller {
    private readonly devices = new DeviceService();

    /**
     * The only unauthenticated endpoint, because it is what creates the
     * credential everything else requires.
     */
    register: RequestHandler = this.handle(async (req: Request, res: Response) => {
        const input = this.parse(registerDeviceSchema, req.body);
        const result = await this.devices.register(input);
        // 201: this created something, and the token in the body exists nowhere
        // else and will never be shown again.
        sendSuccess(res, result, 201);
    });

    update: RequestHandler = this.handle(async (req: Request, res: Response) => {
        const device = requireDevice(req);
        const input = this.parse(updateDeviceSchema, req.body);
        const updated = await this.devices.update(device, input);

        sendSuccess(res, {
            deviceId: updated.id,
            platform: updated.platform,
            timezone: updated.timezone,
            hasPushToken: updated.pushToken !== null,
        });
    });
}
