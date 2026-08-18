import type { DeviceResponse } from '@alarm/types';

import { getDevice, updateDevice } from './devices';
import appConfig from '@/config';
import { ApiRequestError, CLIENT_ERROR_CODES } from '@/utils/modules/Axios';
import Storage from '@/utils/modules/Storage';
import { getPushToken } from '@/utils/modules/pushToken';
import type { PushTokenProblem } from '@/utils/modules/pushToken';

/** What the app knows about its own connection to the API. */
export interface ApiConnection {
    /**
     * `connected` means the server answered this launch.
     *
     * Neither a stored token nor a cached body may produce it: both are evidence
     * that the server answered once, which is a claim about the past, and an app
     * that reports a healthy connection while every request fails is worse than
     * one that reports nothing.
     */
    state: 'connected' | 'registering' | 'unreachable' | 'not_configured';
    /**
     * This device as the server holds it, present exactly when `state` is
     * `connected`.
     *
     * Carried here because confirming the connection means reading it anyway,
     * and because it holds the disruption switches the home screen needs. One
     * read answers both.
     */
    device: DeviceResponse | null;
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
 * Takes the device rather than reading it, because the caller has just confirmed
 * the connection with that read and a second one would answer the same question.
 *
 * Never throws. A device with no push token still gets its alarms, because the
 * wake time is armed locally; push only moves an alarm that is already set.
 */
async function syncPushToken(device: DeviceResponse): Promise<'registered' | PushTokenProblem> {
    const result = await getPushToken();
    if ('problem' in result) {
        return result.problem;
    }

    try {
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

/**
 * Registers this device if it has no token, and reports whether the API answers.
 *
 * Called on launch, before anything that needs authentication. It is deliberately
 * allowed to fail: an unreachable API must not stop the app from opening, because
 * the alarm that matters most is the one already armed on the device, and that
 * needs no network at all. The state it returns is what the UI shows, and what
 * the debug panel reports.
 *
 * Costs one live read per call, and every caller pays it. Nothing is shared or
 * remembered between them, so a second consumer means a second read; that is the
 * price of the answer being about now rather than about the last time somebody
 * asked.
 */
export async function ensureDeviceRegistered(): Promise<ApiConnection> {
    const base: Omit<
        ApiConnection,
        'state' | 'device' | 'errorCode' | 'errorDetail' | 'pushToken'
    > = {
        apiUrl: appConfig.apiUrl,
        inferred: appConfig.apiUrlInferred,
    };

    if (appConfig.apiUrl === null) {
        return {
            ...base,
            state: 'not_configured',
            device: null,
            errorCode: CLIENT_ERROR_CODES.API_URL_MISSING,
            errorDetail: 'No EXPO_PUBLIC_API_URL, and no Metro host to infer one from.',
            pushToken: 'not_attempted',
        };
    }

    /*
     * One live read, which is the whole check.
     *
     * `live` is not optional here. Without it a stored answer satisfies the
     * request, and a phone with no network reports a healthy connection: the
     * cache would be answering "is the API reachable" with "it was, once".
     *
     * Registration is not called first. `getDevice` goes through the request
     * layer, which calls `ensureToken` itself and shares one attempt between
     * concurrent callers, so asking here would only warm a promise the next line
     * creates anyway.
     */
    try {
        const device = await getDevice({ live: true });
        return {
            ...base,
            state: 'connected',
            device,
            errorCode: null,
            errorDetail: null,
            pushToken: await syncPushToken(device),
        };
    } catch (error) {
        const failure = ApiRequestError.from(error);
        return {
            ...base,
            state: 'unreachable',
            device: null,
            errorCode: failure.code,
            errorDetail: failure.message,
            pushToken: 'not_attempted',
        };
    }
}
