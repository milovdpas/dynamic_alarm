import { API_ENDPOINTS, DevicePlatform } from '@alarm/types';
import type { DeviceResponse, RegisterDeviceRequest, RegisterDeviceResponse } from '@alarm/types';
import { Platform } from 'react-native';

import Axios from '@/utils/modules/Axios';

/**
 * The anonymous account, created on first launch.
 *
 * Every other call needs the token this returns, so nothing else can run until
 * it has. It is written to secure storage immediately and read back per
 * request, so onboarding can register and authenticate seconds apart.
 */
export async function registerDevice(
    input: Pick<RegisterDeviceRequest, 'timezone' | 'appVersion'>,
): Promise<RegisterDeviceResponse> {
    const result = await Axios.post<RegisterDeviceResponse>(API_ENDPOINTS.DEVICES.REGISTER, {
        platform: Platform.OS === 'ios' ? DevicePlatform.IOS : DevicePlatform.ANDROID,
        timezone: input.timezone,
        appVersion: input.appVersion,
    });

    await Axios.setToken(result.token);
    return result;
}

/**
 * Updates the mutable facts about this device.
 *
 * `pushToken` is explicitly nullable: omitting it means unchanged, sending null
 * means notification permission was revoked. Collapsing the two would leave the
 * server pushing at a token this device no longer has.
 */
export async function updateDevice(
    deviceId: string,
    input: { pushToken?: string | null; timezone?: string; appVersion?: string },
): Promise<DeviceResponse> {
    return Axios.patch<DeviceResponse>(API_ENDPOINTS.DEVICES.UPDATE(deviceId), input);
}
