import { getDevice, updateDevice } from './devices';
import appConfig from '@/config';
import Axios, { ApiRequestError, CLIENT_ERROR_CODES } from '@/utils/modules/Axios';
import Storage from '@/utils/modules/Storage';
import { getPushToken } from '@/utils/modules/pushToken';
import type { PushTokenProblem } from '@/utils/modules/pushToken';

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
    /**
     * Whether the server holds a push token for this device.
     *
     * Reported rather than assumed, because push is how the monitor moves an
     * alarm that is already armed, and a device without one silently stops
     * receiving updates while still looking connected.
     */
    pushToken: 'registered' | PushTokenProblem | 'not_attempted';
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
/** The token last sent to the server, so an unchanged one costs no request. */
const LAST_PUSH_TOKEN_KEY = 'lastPushToken';

/**
 * Makes sure the server holds a current push token for this device.
 *
 * Only writes when the token has changed. Expo mints a stable token per install,
 * so re-sending it on every launch would be a request that never changes
 * anything. It does re-send when the server says it holds none, which is how a
 * device recovers after its row was cleared.
 *
 * Never throws. A device with no push token still gets its alarms, because the
 * wake time is armed locally; push only moves an alarm that is already set.
 */
async function syncPushToken(): Promise<'registered' | PushTokenProblem> {
    const result = await getPushToken();
    if ('problem' in result) {
        return result.problem;
    }

    try {
        const device = await getDevice();
        const lastSent = await Storage.getItem(LAST_PUSH_TOKEN_KEY);

        if (lastSent === result.token && device.hasPushToken) {
            return 'registered';
        }

        await updateDevice(device.deviceId, { pushToken: result.token });
        await Storage.setItem(LAST_PUSH_TOKEN_KEY, result.token);
        return 'registered';
    } catch {
        return 'REQUEST_FAILED';
    }
}

export async function ensureDeviceRegistered(): Promise<ApiConnection> {
    const base: Omit<
        ApiConnection,
        'state' | 'deviceId' | 'errorCode' | 'errorDetail' | 'pushToken'
    > = {
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
            pushToken: 'not_attempted',
        };
    }

    // Registers if there is no token yet, and shares the attempt with any
    // screen that got there first. This hook is now a reporter: the token is
    // guaranteed by the request layer rather than by launch order.
    const existing = await Axios.ensureToken();
    if (existing !== null) {
        // Registered on a previous launch. The device id is not stored beside
        // the token, and nothing needs it yet, so this does not spend a request
        // to look it up.
        return {
            ...base,
            state: 'connected',
            deviceId: null,
            errorCode: null,
            errorDetail: null,
            pushToken: await syncPushToken(),
        };
    }

    // No token, and registration could not get one. Reported by asking the
    // server who we are, which produces the real reason (unreachable, wrong
    // address, refused) rather than a guess.
    try {
        const device = await getDevice();
        return {
            ...base,
            state: 'connected',
            deviceId: device.deviceId,
            errorCode: null,
            errorDetail: null,
            pushToken: await syncPushToken(),
        };
    } catch (error) {
        const failure = ApiRequestError.from(error);
        return {
            ...base,
            state: 'unreachable',
            deviceId: null,
            errorCode: failure.code,
            errorDetail: failure.message,
            pushToken: 'not_attempted',
        };
    }
}
