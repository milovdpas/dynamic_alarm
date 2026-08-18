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
    input: {
        pushToken?: string | null;
        timezone?: string;
        appVersion?: string;
        allowLaterWakeOnDelay?: boolean;
        allowLaterWakeOnCancellation?: boolean;
        allowEarlierWakeOnTraffic?: boolean;
    },
): Promise<DeviceResponse> {
    return Axios.patch<DeviceResponse>(API_ENDPOINTS.DEVICES.UPDATE(deviceId), input);
}

/**
 * This device, as the server sees it.
 *
 * The settings screen reads its state from here rather than keeping a local
 * copy. The disruption settings are acted on by the monitor, so the server's
 * values are the ones that decide what happens overnight; a local mirror could
 * disagree and there would be no way to tell which was in force.
 *
 * `live` refuses the cache. Only the connection check passes it: a stored answer
 * proves the server answered once, and answering "is the API reachable" from it
 * reports a healthy connection to a phone with no network. Every other caller
 * wants the cache, because showing the switches as they were last known beats
 * showing an error where the settings should be.
 */
export async function getDevice(options?: { live?: boolean }): Promise<DeviceResponse> {
    return Axios.get<DeviceResponse>(API_ENDPOINTS.DEVICES.ME, undefined, options);
}
