import { APP_CONSTANTS } from '@alarm/types';
import type {
    RegisterDeviceRequest,
    RegisterDeviceResponse,
    UpdateDeviceRequest,
} from '@alarm/types';

import Device from '../models/Device.entity';
import { generateDeviceToken, hashDeviceToken } from '../utils/Token';

export class DeviceService {
    /**
     * Creates a device and returns its token exactly once.
     *
     * Only the hash is stored, so this is the only moment the plain token
     * exists. If the app loses it, the device cannot be recovered and must
     * register again, which is the correct trade for never being able to leak
     * every device's credentials from a database dump.
     */
    async register(input: RegisterDeviceRequest): Promise<RegisterDeviceResponse> {
        const token = generateDeviceToken();

        const device = Device.create({
            tokenHash: hashDeviceToken(token),
            platform: input.platform,
            pushToken: input.pushToken ?? null,
            timezone: input.timezone || APP_CONSTANTS.TIMEZONE,
            appVersion: input.appVersion,
            lastSeenAt: new Date(),
        });
        await device.save();

        return { deviceId: device.id, token };
    }

    /**
     * Updates the mutable facts about a device.
     *
     * The push token changes when the user grants notification permission or
     * reinstalls, and the timezone when they travel. Both must be updatable
     * without re-registering, which would orphan every schedule.
     */
    async update(device: Device, input: UpdateDeviceRequest): Promise<Device> {
        if (input.pushToken !== undefined) {
            device.pushToken = input.pushToken;
        }
        if (input.timezone !== undefined && input.timezone !== '') {
            device.timezone = input.timezone;
        }
        if (input.appVersion !== undefined) {
            device.appVersion = input.appVersion;
        }
        if (input.allowLaterWakeOnDelay !== undefined) {
            device.allowLaterWakeOnDelay = input.allowLaterWakeOnDelay;
        }
        if (input.allowLaterWakeOnCancellation !== undefined) {
            device.allowLaterWakeOnCancellation = input.allowLaterWakeOnCancellation;
        }
        if (input.allowEarlierWakeOnTraffic !== undefined) {
            device.allowEarlierWakeOnTraffic = input.allowEarlierWakeOnTraffic;
        }
        device.lastSeenAt = new Date();

        return device.save();
    }
}
