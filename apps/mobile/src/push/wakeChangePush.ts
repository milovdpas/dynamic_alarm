import { APP_CONSTANTS, PUSH_MESSAGE_TYPE, WakeChangeReason } from '@alarm/types';
import type { DisruptionNoticePush, PushMessage, WakeChangedPush } from '@alarm/types';
import { resolvePushedWake } from '@alarm/core';

import { canGuaranteeAlarm, getAlarmScheduler } from '@/alarm';
import { ackOccurrence } from '@/api';
import i18n from '@/i18n/i18n';
import { resolveAlarmSoundUri } from '@/alarm/alarmSound';
import { rememberDisruption } from '@/alarm/disruption';
import { readHeldAlarm, rememberHeldAlarm } from '@/push/heldAlarm';
import { recordPushOutcome } from '@/push/pushLog';

/**
 * Records a disruption for the alarm screen, and changes nothing else.
 *
 * The server sends this when a journey is disrupted but the wake time is staying
 * where it is, which is the ordinary case when the user has not opted into being
 * woken later. Nothing is rescheduled and nothing is acknowledged: the only
 * effect is that the phone can now say what happened when the alarm rings, with
 * no network at 06:00.
 */
export async function applyDisruptionNotice(push: DisruptionNoticePush): Promise<void> {
    await rememberDisruption(push.occurrenceId, {
        kind: push.kind,
        minutes: push.minutes,
        service: push.service,
        simulated: push.simulated,
    });

    await recordPushOutcome({
        at: new Date().toISOString(),
        wakeAt: '',
        emergency: false,
        outcome: `NOTICE_${push.kind}`,
    });
}

export type PushApplyOutcome =
    | 'APPLIED'
    | 'IGNORED_NOT_LATER'
    | 'IGNORED_UNKNOWN_HELD'
    | 'IGNORED_TOO_SMALL'
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
export function extractPush(payload: unknown): PushMessage | null {
    for (const candidate of unwrap(payload, 0)) {
        if (isWakeChange(candidate) || isDisruptionNotice(candidate)) {
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
 * The judgement is `resolvePushedWake` in `@alarm/core`, and it is made here
 * rather than trusted from the server on purpose: a retried push can arrive long
 * after the device has moved on, so the phone decides using what it actually
 * holds.
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

    // The rule itself lives in `@alarm/core`, beside the server-side half that
    // decides whether to send at all. Two implementations of "may this alarm
    // move" would eventually disagree, and the disagreement would show up as
    // somebody waking at the wrong time rather than as a failing build.
    const decision = resolvePushedWake({
        heldWakeAt: held?.wakeAt ?? null,
        pushedWakeAt: push.wakeAt,
        emergency: push.emergency,
        timezone: APP_CONSTANTS.TIMEZONE,
    });

    if (!decision.apply) {
        switch (decision.reason) {
            case 'UNKNOWN_HELD':
                return 'IGNORED_UNKNOWN_HELD';
            case 'TOO_SMALL':
                return 'IGNORED_TOO_SMALL';
            default:
                return 'IGNORED_NOT_LATER';
        }
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
            // Re-read here too. This path runs in a headless task with the app
            // closed, and an alarm moved overnight that quietly lost the user's
            // tone would be a strange thing to wake up to.
            soundUri: await resolveAlarmSoundUri(),
            occurrenceId: push.occurrenceId,
        });

        if (!(await scheduler.listScheduled()).includes(id)) {
            // Asked, and the OS does not have it. Nothing is remembered and
            // nothing is acknowledged, so the server keeps retrying.
            return 'FAILED';
        }

        await rememberHeldAlarm({ occurrenceId: push.occurrenceId, wakeAt: push.wakeAt });

        // The reason, kept for the ring screen. This runs while the phone is
        // asleep, which is exactly when the alarm screen's copy would otherwise
        // go stale.
        await rememberDisruption(push.occurrenceId, {
            kind:
                push.reason === WakeChangeReason.CANCELLATION ? 'CANCELLATION' : 'DELAY',
            minutes: 0,
            // Both from the payload rather than from a request. This runs with
            // the phone asleep, and the screen that shows them has to work at
            // 06:00 with no network, so what the server knew has to travel with
            // the message that woke the task.
            service: push.cancelledService ?? null,
            simulated: push.message.startsWith('SIMULATED'),
            replacement: push.replacement ?? null,
        }).catch(() => undefined);
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

function isDisruptionNotice(value: unknown): value is DisruptionNoticePush {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const record = value as Record<string, unknown>;
    return (
        record.type === PUSH_MESSAGE_TYPE.DISRUPTION_NOTICE &&
        typeof record.occurrenceId === 'string' &&
        (record.kind === 'DELAY' || record.kind === 'CANCELLATION')
    );
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
