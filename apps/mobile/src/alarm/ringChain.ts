import type { IsoDateTimeString, ReminderConfig } from '@alarm/types';

import type { AlarmScheduler } from '@/alarm/AlarmScheduler';
import { isReminderId, reminderTimes, ringId } from '@/alarm/reminders';

export interface RingChainRequest {
    /** The real alarm's id, `occurrence-<id>`. Reminders hang off it. */
    baseId: string;
    wakeAt: IsoDateTimeString;
    reminders: ReminderConfig | null | undefined;
    title: string;
    body: string;
    soundUri: string | null;
    occurrenceId: string;
}

/**
 * Arms every ring of one morning, and removes the rings that no longer belong.
 *
 * The one place a chain is written, used by the app's own arming and by the
 * push that moves an alarm overnight. They used to differ: the push re-armed
 * the real alarm alone and left the reminders where they were, so a cancellation
 * that pulled 07:44 to 07:29 produced a phone ringing at 07:29, 07:34 and 07:39,
 * the last two after its owner was already up, and a move back the other way
 * left two reminders ringing twenty minutes before anything they reminded of.
 *
 * `reminderTimes` always ends on the wake time, so the real alarm is always
 * armed, on its plain id, whatever the reminder setting says. Reminder ids the
 * OS still holds beyond this chain are cancelled: a chain that shrank from three
 * rings to one, or a baseline that never recorded its reminders, must not leave
 * a stale ring behind, because a stale ring rings at the wrong time and a
 * missing one only costs a nudge.
 */
export async function armRingChain(scheduler: AlarmScheduler, request: RingChainRequest): Promise<void> {
    const times = reminderTimes(request.wakeAt, request.reminders);
    const armed = new Set<string>();

    for (const [index, at] of times.entries()) {
        const ringsBeforeWake = times.length - 1 - index;
        const id = ringId(request.baseId, ringsBeforeWake);
        await scheduler.schedule({
            id,
            at,
            soundUri: request.soundUri,
            title: request.title,
            body: request.body,
            occurrenceId: request.occurrenceId,
        });
        armed.add(id);
    }

    for (const id of await scheduler.listScheduled()) {
        if (isReminderId(id) && id.startsWith(`${request.baseId}#`) && !armed.has(id)) {
            await scheduler.cancel(id).catch(() => undefined);
        }
    }
}
