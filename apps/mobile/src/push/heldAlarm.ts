import type { IsoDateTimeString } from '@alarm/types';

import Storage from '@/utils/modules/Storage';

const KEY = 'heldAlarms';
/** The key this held a single record under, before mornings came in weeks. */
const LEGACY_KEY = 'heldAlarm';

/**
 * What the device believes the OS is currently holding, per morning.
 *
 * The scheduler can list alarm *ids*, which answers "is something armed" but not
 * "armed for when". The monotonic rule needs the time: a push must be compared
 * against what this phone actually holds for that morning, not against what the
 * server last believed, or a device that missed a message would judge the next
 * one against the wrong baseline.
 *
 * **Per morning, not one record.** This held a single `{occurrenceId, wakeAt}`
 * until mornings were planned a week ahead, at which point every arming pass
 * overwrote it with whichever morning was armed last. A push about Thursday was
 * then judged against Friday's wake time, which is the wrong baseline in exactly
 * the way the record exists to prevent.
 *
 * Written after the OS confirms, never before, for the same reason the
 * acknowledgement is: an intention is not a fact.
 */
export interface HeldAlarm {
    occurrenceId: string;
    wakeAt: IsoDateTimeString;
}

type Held = Record<string, IsoDateTimeString>;

export async function rememberHeldAlarm(held: HeldAlarm, now = new Date()): Promise<void> {
    const all = prunePast(await readAll(), now);
    all[held.occurrenceId] = held.wakeAt;
    await Storage.setItem(KEY, JSON.stringify(all));
}

/**
 * Drops mornings whose time has passed.
 *
 * The OS forgets an alarm when it fires, so the orphan sweep, which reads the
 * OS, never sees it to forget here. Without this the record grew by one morning
 * a day for ever. Pruned on every write, which is the moment the list is in hand.
 */
function prunePast(all: Held, now: Date): Held {
    const kept: Held = {};
    for (const [id, wakeAt] of Object.entries(all)) {
        if (new Date(wakeAt).getTime() > now.getTime()) {
            kept[id] = wakeAt;
        }
    }
    return kept;
}

/** Forgets a morning the OS no longer holds. */
export async function forgetHeldAlarm(occurrenceId: string): Promise<void> {
    const all = await readAll();
    if (!(occurrenceId in all)) {
        return;
    }
    delete all[occurrenceId];
    await Storage.setItem(KEY, JSON.stringify(all));
}

/**
 * What is held for one morning, or the soonest morning when none is named.
 *
 * Null when nothing is known, which is not the same as nothing being armed. A
 * binary without AsyncStorage keeps this in memory for the session only, so
 * after a restart the device knows an alarm is armed without knowing its time.
 * Callers must treat null as "cannot judge" rather than "no alarm": applying a
 * push blindly in that case could pull an alarm earlier with nothing to compare
 * it to.
 */
export async function readHeldAlarm(occurrenceId?: string): Promise<HeldAlarm | null> {
    const all = await readHeldAlarms();
    if (occurrenceId !== undefined) {
        return all.find((held) => held.occurrenceId === occurrenceId) ?? null;
    }
    return all[0] ?? null;
}

/** Every morning the device believes it holds, soonest first. */
export async function readHeldAlarms(): Promise<HeldAlarm[]> {
    const all = await readAll();
    return Object.entries(all)
        .map(([occurrenceId, wakeAt]) => ({ occurrenceId, wakeAt }))
        // As instants. ISO strings with different offsets do not sort as text.
        .sort((a, b) => new Date(a.wakeAt).getTime() - new Date(b.wakeAt).getTime());
}

async function readAll(): Promise<Held> {
    const raw = await Storage.getItem(KEY);
    if (raw !== null) {
        try {
            const parsed = JSON.parse(raw) as unknown;
            if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
                const held: Held = {};
                for (const [id, wakeAt] of Object.entries(parsed as Record<string, unknown>)) {
                    if (typeof wakeAt === 'string') {
                        held[id] = wakeAt;
                    }
                }
                return held;
            }
        } catch {
            // Unreadable falls through to the legacy record, then to nothing.
        }
    }

    // The single record this key held before mornings came in weeks. Read
    // rather than discarded, because a phone updating tonight would otherwise
    // lose the baseline for a morning that is already armed.
    const legacy = await Storage.getItem(LEGACY_KEY);
    if (legacy === null) {
        return {};
    }
    try {
        const parsed = JSON.parse(legacy) as Partial<HeldAlarm>;
        if (typeof parsed.occurrenceId === 'string' && typeof parsed.wakeAt === 'string') {
            return { [parsed.occurrenceId]: parsed.wakeAt };
        }
    } catch {
        // Fall through.
    }
    return {};
}
