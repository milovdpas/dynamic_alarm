import type { IsoDateTimeString } from '@alarm/types';

import Storage from '@/utils/modules/Storage';

const KEY = 'heldAlarm';

/**
 * What the device believes the OS is currently holding.
 *
 * The scheduler can list alarm *ids*, which answers "is something armed" but not
 * "armed for when". The monotonic rule needs the time: a push must be compared
 * against what this phone actually holds, not against what the server last
 * believed, or a device that missed a message would judge the next one against
 * the wrong baseline.
 *
 * Written after the OS confirms, never before, for the same reason the
 * acknowledgement is: an intention is not a fact.
 */
export interface HeldAlarm {
    occurrenceId: string;
    wakeAt: IsoDateTimeString;
}

export async function rememberHeldAlarm(held: HeldAlarm): Promise<void> {
    await Storage.setItem(KEY, JSON.stringify(held));
}

/**
 * Null when nothing is known, which is not the same as nothing being armed.
 *
 * A binary without AsyncStorage keeps this in memory for the session only, so
 * after a restart the device knows an alarm is armed without knowing its time.
 * Callers must treat null as "cannot judge" rather than "no alarm": applying a
 * push blindly in that case could pull an alarm earlier with nothing to compare
 * it to.
 */
export async function readHeldAlarm(): Promise<HeldAlarm | null> {
    const raw = await Storage.getItem(KEY);
    if (raw === null) {
        return null;
    }

    try {
        const parsed = JSON.parse(raw) as Partial<HeldAlarm>;
        if (typeof parsed.occurrenceId !== 'string' || typeof parsed.wakeAt !== 'string') {
            return null;
        }
        return { occurrenceId: parsed.occurrenceId, wakeAt: parsed.wakeAt };
    } catch {
        return null;
    }
}
