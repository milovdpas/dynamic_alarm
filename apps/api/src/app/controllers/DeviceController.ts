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

    /**
     * This device, as it sees itself.
     *
     * No id in the path: the token already identifies exactly one device, and
     * accepting an id would invite the question of what happens when it names a
     * different one.
     */
    me: Handler = (req, res) => {
        sendSuccess<DeviceResponse>(res, req.device.toDto());
        return Promise.resolve();
    };

    update: Handler<BodyOf<typeof updateDeviceSchema>> = async (req, res) => {
        const updated = await this.devices.update(req.device, req.body);
        sendSuccess<DeviceResponse>(res, updated.toDto());
    };
}
