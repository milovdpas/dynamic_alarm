import { PUSH_MESSAGE_TYPE } from '@alarm/types';
import type { WakeChangedPush } from '@alarm/types';

import { canGuaranteeAlarm, getAlarmScheduler } from '@/alarm';
import { ackOccurrence } from '@/api';
import i18n from '@/i18n/i18n';
import { readHeldAlarm, rememberHeldAlarm } from '@/push/heldAlarm';
import { recordPushOutcome } from '@/push/pushLog';

/** What happened to a push, recorded for the debug panel. */
export type PushApplyOutcome =
    | 'APPLIED'
    | 'IGNORED_NOT_LATER'
    | 'IGNORED_UNKNOWN_HELD'
    | 'NO_ALARM_SUPPORT'
    | 'UNREADABLE'
    | 'FAILED';

/**
 * Reads the payload out of whatever the platform handed us.
 *
 * Deliberately tolerant. The same message reaches this app through three
 * different shapes: a foreground `Notification`, an Android FCM `RemoteMessage`
 * whose body is a JSON string, and an iOS APNs payload. Guessing one and
 * silently ignoring the rest would mean an alarm that quietly never moves, which
 * is exactly the failure this whole path exists to prevent, so it tries the
 * known shapes and validates the result instead.
 */
export function extractWakeChange(payload: unknown): WakeChangedPush | null {
    for (const candidate of unwrap(payload, 0)) {
        if (isWakeChange(candidate)) {
            return candidate;
        }
    }
    return null;
}

/**
 * Applies a pushed wake time, under the rule that keeps this safe.
 *
 * **Later is applied, earlier is refused unless the server marked it an
 * emergency.** The device is holding a pessimistic time that will get its owner
 * there; pulling that earlier on the strength of a best-effort message would
 * trade a guaranteed wake-up for a hopeful one. Later is different: the worst
 * case is the alarm this phone already holds.
 *
 * Nothing here throws. It runs in a background task where an exception is a
 * silent no-op, and every branch ends in a recorded outcome so the debug panel
 * can say what happened rather than leaving the morning unexplained.
 */
export async function applyWakeChange(push: WakeChangedPush): Promise<PushApplyOutcome> {
    const outcome = await apply(push);
    await recordPushOutcome({
        at: new Date().toISOString(),
        wakeAt: push.wakeAt,
        emergency: push.emergency,
        outcome,
    });
    return outcome;
}

async function apply(push: WakeChangedPush): Promise<PushApplyOutcome> {
    if (!canGuaranteeAlarm()) {
        // A build without the native module, or a platform that cannot hold a
        // real alarm. Rescheduling would be theatre.
        return 'NO_ALARM_SUPPORT';
    }

    const held = await readHeldAlarm();
    if (held === null) {
        // Not "nothing is armed": the device simply does not know what it holds,
        // which happens on a binary without persistent storage. There is nothing
        // to compare against, so the safe answer is to leave the armed alarm
        // alone and let the next app launch sort it out.
        return 'IGNORED_UNKNOWN_HELD';
    }

    const isLater = push.wakeAt > held.wakeAt;
    if (!isLater && !push.emergency) {
        return 'IGNORED_NOT_LATER';
    }

    try {
        const scheduler = getAlarmScheduler();
        // The same id the app arms with, so this replaces rather than stacks. A
        // superseded time surviving as a second alarm would ring anyway.
        const id = `occurrence-${push.occurrenceId}`;

        await scheduler.schedule({
            id,
            at: push.wakeAt,
            title: i18n.t('alarm.ringing_title'),
            body: push.message,
            occurrenceId: push.occurrenceId,
        });

        if (!(await scheduler.listScheduled()).includes(id)) {
            // Asked, and the OS does not have it. Nothing is remembered and
            // nothing is acknowledged, so the server keeps retrying.
            return 'FAILED';
        }

        await rememberHeldAlarm({ occurrenceId: push.occurrenceId, wakeAt: push.wakeAt });
        // Only after the read-back. This is the message that stops the server
        // retrying, so sending it on an intention would end the retries that are
        // the reason a dropped push is survivable.
        await ackOccurrence(push.occurrenceId, push.wakeAt).catch(() => undefined);

        return 'APPLIED';
    } catch {
        return 'FAILED';
    }
}

/**
 * Every place the payload might be, innermost first.
 *
 * JSON strings are parsed as they are met, since Android delivers the body as
 * text. Depth is capped because this walks data from the network and a cycle or
 * a deeply nested object would otherwise hang a background task.
 */
function* unwrap(value: unknown, depth: number): Generator<unknown> {
    if (depth > 4 || value === null || value === undefined) {
        return;
    }

    if (typeof value === 'string') {
        try {
            yield* unwrap(JSON.parse(value), depth + 1);
        } catch {
            // An ordinary string, not a payload.
        }
        return;
    }

    if (typeof value !== 'object') {
        return;
    }

    yield value;

    const record = value as Record<string, unknown>;
    for (const key of ['data', 'dataString', 'body', 'notification', 'request', 'content']) {
        if (key in record) {
            yield* unwrap(record[key], depth + 1);
        }
    }
}

function isWakeChange(value: unknown): value is WakeChangedPush {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const record = value as Record<string, unknown>;
    return (
        record.type === PUSH_MESSAGE_TYPE.WAKE_CHANGED &&
        typeof record.occurrenceId === 'string' &&
        typeof record.wakeAt === 'string' &&
        typeof record.message === 'string'
    );
}
