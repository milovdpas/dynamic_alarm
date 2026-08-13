import type { PushMessage } from '@alarm/types';

import Device from '../models/Device.entity';

/**
 * Expo's push service. One endpoint, no key: the token identifies the app.
 *
 * Hardcoded rather than configurable. It is Expo's address, not a deployment
 * detail, and an environment variable would be one more thing to get wrong in
 * the middle of the night.
 */
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** Why a push did not land, kept as data because none of these are exceptional. */
export type PushOutcome =
    /** Accepted by Expo. Not the same as delivered, and never treated as such. */
    | 'SENT'
    /** No push token, so this device was never reachable. */
    | 'NO_TOKEN'
    /** Expo rejected the token. The device has been unregistered. */
    | 'UNREGISTERED'
    /** Expo refused the message, or could not be reached. */
    | 'FAILED';

/**
 * Sends the messages that move an alarm somebody is already asleep under.
 *
 * **Nothing here is guaranteed, and the design does not need it to be.** The
 * device holds an OS-level alarm at the anchor time before any of this runs, so
 * a dropped push, a dead radio or an Expo outage means waking slightly early
 * rather than late. That is what lets this stay a best-effort call with no
 * queue, no retry loop and no delivery receipts.
 *
 * It follows that no failure here may throw. The monitor's job is to keep the
 * server's answer correct; whether a phone heard about it is a separate
 * question, and conflating them would let a network blip abort a pass that had
 * already computed the right time.
 */
export class PushService {
    /**
     * Sends one message, and reports what happened to it.
     *
     * `expiresAt` becomes Expo's TTL, so a message that arrives after the alarm
     * has already rung is dropped by the delivery service rather than by the
     * app. Without it, a phone that comes back online at 08:00 would be told to
     * reschedule a 06:53 alarm that has already gone off.
     */
    async send(device: Device, message: PushMessage, expiresAt: Date): Promise<PushOutcome> {
        if (device.pushToken === null) {
            return 'NO_TOKEN';
        }

        const ttlSeconds = Math.floor((expiresAt.getTime() - Date.now()) / 1000);
        if (ttlSeconds <= 0) {
            // Already past. Sending it would be asking the device to rearrange
            // a morning that has happened.
            return 'FAILED';
        }

        try {
            const response = await fetch(EXPO_PUSH_URL, {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    to: device.pushToken,
                    data: message,
                    // Data only: no title and no body, so nothing is displayed.
                    // The app reschedules the alarm silently. A visible
                    // notification at 03:00 would wake the person we are trying
                    // to let sleep longer.
                    //
                    // `_contentAvailable` is what makes iOS deliver a silent
                    // push to the app at all. Android needs no equivalent.
                    _contentAvailable: true,
                    // Android otherwise batches this into a maintenance window,
                    // which can be hours in Doze. The whole message is
                    // time-critical by construction.
                    priority: 'high',
                    ttl: ttlSeconds,
                }),
            });

            if (!response.ok) {
                console.error(`Expo push failed: ${String(response.status)} ${await response.text()}`);
                return 'FAILED';
            }

            return await this.readTicket(device, response);
        } catch (error) {
            // A network call to a third party. Failing is ordinary, and the
            // anchor alarm is why it is survivable.
            console.error('Expo push could not be sent:', error);
            return 'FAILED';
        }
    }

    /**
     * Reads Expo's ticket, and drops a token Expo says is dead.
     *
     * `DeviceNotRegistered` means the app was uninstalled or the token was
     * rotated. Keeping it would make every future tick spend a request on a
     * phone that cannot answer, and `hasPushToken` would keep telling the user
     * they are covered when they are not.
     */
    private async readTicket(device: Device, response: Response): Promise<PushOutcome> {
        const payload = (await response.json()) as ExpoPushResponse;
        const ticket = Array.isArray(payload.data) ? payload.data[0] : payload.data;

        if (ticket === undefined || ticket.status === 'ok') {
            return 'SENT';
        }

        if (ticket.details?.error === 'DeviceNotRegistered') {
            device.pushToken = null;
            await device.save();
            return 'UNREGISTERED';
        }

        console.error(`Expo push rejected: ${ticket.message ?? 'no message'}`);
        return 'FAILED';
    }
}

interface ExpoPushTicket {
    status: 'ok' | 'error';
    id?: string;
    message?: string;
    details?: { error?: string };
}

interface ExpoPushResponse {
    data?: ExpoPushTicket | ExpoPushTicket[];
}
