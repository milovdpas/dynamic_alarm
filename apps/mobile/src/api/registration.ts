import { APP_CONSTANTS } from '@alarm/types';

import { registerDevice } from './devices';
import appConfig from '@/config';
import Axios, { ApiRequestError, CLIENT_ERROR_CODES } from '@/utils/modules/Axios';

/** What the app knows about its own connection to the API. */
export interface ApiConnection {
    state: 'connected' | 'registering' | 'unreachable' | 'not_configured';
    /** Present once registered. */
    deviceId: string | null;
    /** The address in use, so a wrong one is visible rather than guessed at. */
    apiUrl: string | null;
    /** True when that address was inferred from the Metro host. */
    inferred: boolean;
    /** Error code for the UI to translate. Never shown raw. */
    errorCode: string | null;
    /** English, for the debug report and the log. Not for the user. */
    errorDetail: string | null;
}

/**
 * Makes sure this device has a token, registering it if not.
 *
 * Called once on launch, before anything that needs authentication. It is
 * deliberately allowed to fail: an unreachable API must not stop the app from
 * opening, because the alarm that matters most is the one already armed on the
 * device, and that needs no network at all. The state it returns is what the UI
 * shows, and what the debug panel reports.
 *
 * Safe to call again. A device with a stored token does no work and makes no
 * request, so this is not a per-launch round trip.
 */
export async function ensureDeviceRegistered(): Promise<ApiConnection> {
    const base: Omit<ApiConnection, 'state' | 'deviceId' | 'errorCode' | 'errorDetail'> = {
        apiUrl: appConfig.apiUrl,
        inferred: appConfig.apiUrlInferred,
    };

    if (appConfig.apiUrl === null) {
        return {
            ...base,
            state: 'not_configured',
            deviceId: null,
            errorCode: CLIENT_ERROR_CODES.API_URL_MISSING,
            errorDetail: 'No EXPO_PUBLIC_API_URL, and no Metro host to infer one from.',
        };
    }

    const existing = await Axios.getToken();
    if (existing !== null) {
        // Registered on a previous launch. The device id is not stored beside
        // the token, and nothing needs it yet, so this does not spend a request
        // to look it up.
        return { ...base, state: 'connected', deviceId: null, errorCode: null, errorDetail: null };
    }

    try {
        const result = await registerDevice({
            timezone: APP_CONSTANTS.TIMEZONE,
            appVersion: appConfig.appVersion,
        });
        return {
            ...base,
            state: 'connected',
            deviceId: result.deviceId,
            errorCode: null,
            errorDetail: null,
        };
    } catch (error) {
        const failure = ApiRequestError.from(error);
        return {
            ...base,
            state: 'unreachable',
            deviceId: null,
            errorCode: failure.code,
            errorDetail: failure.message,
        };
    }
}
