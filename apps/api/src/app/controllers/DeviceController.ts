import type { DeviceResponse, RegisterDeviceResponse } from '@alarm/types';

import type { Handler } from '../../interfaces/IHttp';
import type { BodyOf } from '../middleware/ValidateRequest';
import { DeviceService } from '../services/DeviceService';
import { sendSuccess } from '../utils/ApiResponses';
import { registerDeviceSchema, updateDeviceSchema } from '../validators/deviceSchemas';

export default class DeviceController {
    private readonly devices = new DeviceService();

    /**
     * The only route without `deviceAuth`, because it is what creates the
     * credential everything else requires.
     */
    register: Handler<BodyOf<typeof registerDeviceSchema>> = async (req, res) => {
        const result = await this.devices.register(req.body);
        // 201: this created something, and the token in the body exists nowhere
        // else and will never be shown again.
        sendSuccess<RegisterDeviceResponse>(res, result, 201);
    };

    update: Handler<BodyOf<typeof updateDeviceSchema>> = async (req, res) => {
        const updated = await this.devices.update(req.device, req.body);

        sendSuccess<DeviceResponse>(res, {
            deviceId: updated.id,
            platform: updated.platform,
            timezone: updated.timezone,
            // A boolean, not the token. The device already has the value; what
            // it cannot otherwise learn is whether the server still holds one.
            hasPushToken: updated.pushToken !== null,
        });
    };
}
