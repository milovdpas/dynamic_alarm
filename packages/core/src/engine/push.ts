import { APP_CONSTANTS } from '@alarm/types';
import type { IsoDateTimeString, TimeZone } from '@alarm/types';

import { minutesBetween, parseInstant } from '../time';
import { shouldPushWakeChange } from './monitor';

const { MONITOR } = APP_CONSTANTS;

/**
 * How long to wait for an acknowledgement before assuming a push was lost.
 *
 * Longer than a phone needs to wake its radio, apply the change and answer, and
 * short enough that a genuinely dropped push is retried several times before the
 * alarm rings.
 */
export const PUSH_RETRY_MINUTES = 10;

export type SendPushDecision =
    | { send: true; kind: 'NEW' | 'RETRY' }
    | { send: false; reason: 'NO_CHANGE' | 'IN_FLIGHT' | 'PAST' };

export interface SendPushInput {
    /** The time the server now believes in. */
    wakeAt: IsoDateTimeString;
    /** What the device says it holds, null when it has never acknowledged. */
    ackedWakeAt: IsoDateTimeString | null;
    /** The value last successfully sent, null when nothing has been. */
    pushedWakeAt: IsoDateTimeString | null;
    lastPushedAt: IsoDateTimeString | null;
    now: IsoDateTimeString;
    timezone: TimeZone;
    retryAfterMinutes?: number;
}

/**
 * Whether the server should push this wake time to the device.
 *
 * Three questions in order, and the order is the whole logic. Is the alarm still
 * ahead? Does the phone already hold this time? And if it does not, is a push
 * for it already in flight?
 *
 * The comparison is against `ackedWakeAt`, what the phone says it holds, rather
 * than against what the server last sent. Those differ exactly when a push was
 * dropped, which is the case this decision exists for. Retrying is what makes a
 * lost push survivable without a delivery queue, and the retry window is what
 * stops that becoming a message every tick to a phone that is simply mid-flight.
 */
export function shouldSendWakePush(input: SendPushInput): SendPushDecision {
    const now = parseInstant(input.now, input.timezone);
    const wakeAt = parseInstant(input.wakeAt, input.timezone);

    if (wakeAt <= now) {
        // The alarm has already rung, or is ringing. Rescheduling it now would
        // rearrange a morning that has happened.
        return { send: false, reason: 'PAST' };
    }

    if (input.ackedWakeAt !== null) {
        const differs = shouldPushWakeChange(input.ackedWakeAt, input.wakeAt, input.timezone, {
            // Either direction counts. This asks whether the phone holds a
            // materially different time, not whether the change was permitted:
            // that was decided before the time was written.
            allowEarlier: true,
        });
        if (!differs) {
            return { send: false, reason: 'NO_CHANGE' };
        }
    }

    const alreadySent = input.pushedWakeAt !== null && input.pushedWakeAt === input.wakeAt;
    if (!alreadySent) {
        return { send: true, kind: 'NEW' };
    }

    if (input.lastPushedAt === null) {
        // Sent, but with no record of when. Treating that as in flight would
        // stall the retry forever, so it is treated as due.
        return { send: true, kind: 'RETRY' };
    }

    const waited = minutesBetween(parseInstant(input.lastPushedAt, input.timezone), now);
    const window = input.retryAfterMinutes ?? PUSH_RETRY_MINUTES;
    return waited >= window
        ? { send: true, kind: 'RETRY' }
        : { send: false, reason: 'IN_FLIGHT' };
}

export type ApplyPushDecision =
    | { apply: true; kind: 'LATER' | 'EMERGENCY' }
    | { apply: false; reason: 'NOT_LATER' | 'UNKNOWN_HELD' | 'TOO_SMALL' };

export interface ApplyPushInput {
    /** What this device currently holds, null when it does not know. */
    heldWakeAt: IsoDateTimeString | null;
    pushedWakeAt: IsoDateTimeString;
    /** The server's judgement that not moving is worse than moving early. */
    emergency: boolean;
    timezone: TimeZone;
}

/**
 * Whether a device should apply a wake time it has been pushed.
 *
 * **The monotonic rule, from the device's side.** Later is applied, earlier is
 * refused unless the server marked it an emergency. The phone is holding a
 * pessimistic time that will get its owner there; pulling that earlier on the
 * strength of a best-effort message would trade a guaranteed wake-up for a
 * hopeful one. Later is safe by construction, because the worst case is the
 * alarm already armed.
 *
 * A null `heldWakeAt` is not "nothing is armed", it is "this device cannot
 * tell", which happens on a build without persistent storage. There is nothing
 * to compare against, so the armed alarm is left alone rather than being
 * replaced on a guess.
 *
 * The mirror of `shouldSendWakePush`, and deliberately not the same function.
 * The server decides whether a message is worth sending; the device decides
 * whether the message it received is safe to act on. A device that trusted the
 * server's judgement would have no defence against a stale message arriving
 * late, which is exactly what a retried push can be.
 */
export function resolvePushedWake(input: ApplyPushInput): ApplyPushDecision {
    if (input.heldWakeAt === null) {
        return { apply: false, reason: 'UNKNOWN_HELD' };
    }

    const held = parseInstant(input.heldWakeAt, input.timezone);
    const pushed = parseInstant(input.pushedWakeAt, input.timezone);
    const deltaMinutes = minutesBetween(held, pushed);

    if (Math.abs(deltaMinutes) < MONITOR.MIN_PUSH_DELTA_MINUTES) {
        // Below the floor the server pushes at, so this is a message the device
        // has effectively already applied. Rescheduling would cancel and re-arm
        // a real alarm to move it by seconds.
        return { apply: false, reason: 'TOO_SMALL' };
    }

    if (deltaMinutes > 0) {
        return { apply: true, kind: 'LATER' };
    }

    return input.emergency
        ? { apply: true, kind: 'EMERGENCY' }
        : { apply: false, reason: 'NOT_LATER' };
}
