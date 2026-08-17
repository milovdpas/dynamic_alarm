import { JourneyStatus } from '@alarm/types';
import type { Journey, OccurrenceResponse } from '@alarm/types';

import Storage from '@/utils/modules/Storage';

/**
 * What is wrong with a morning, in the few facts a screen needs.
 *
 * Derived rather than stored as prose, because the same disruption is worded
 * differently on the journey screen and on a lock screen at 06:00, and because
 * the numbers are what the copy interpolates.
 */
export interface Disruption {
    /**
     * `NO_REPLACEMENT` is a cancellation with nothing acceptable to take
     * instead: everything left runs outside the hours its owner said they would
     * travel. The alarm stays where it is, so this is the only warning they get.
     */
    kind: 'DELAY' | 'CANCELLATION' | 'NO_REPLACEMENT';
    /** Worst delay across the journey's legs. Zero for a cancellation. */
    minutes: number;
    /** The service it happened to, when there is one to name. */
    service: string | null;
    /** True when this came from a staged test rather than from NS. */
    simulated: boolean;
}

/**
 * Reads the disruption out of a plan, or null when the morning is ordinary.
 *
 * Cancellation wins over delay: a train that is not running is not a train that
 * is late, and saying both would bury the one that matters.
 */
export function readDisruption(occurrence: OccurrenceResponse): Disruption | null {
    const journey = occurrence.journey;
    if (journey === null) {
        return null;
    }

    const simulated = occurrence.simulated !== null;
    const cancelledLeg = journey.legs.find((leg) => leg.cancelled);

    if (cancelledLeg !== undefined || journey.status === JourneyStatus.CANCELLED) {
        return {
            kind: 'CANCELLATION',
            minutes: 0,
            service: cancelledLeg?.name ?? cancelledLeg?.fromName ?? null,
            simulated,
        };
    }

    const worst = worstDelay(journey);
    if (worst === null) {
        return null;
    }

    return { kind: 'DELAY', minutes: worst.minutes, service: worst.service, simulated };
}

/** The leg running latest, since that is the one that shapes the morning. */
function worstDelay(journey: Journey): { minutes: number; service: string | null } | null {
    let worst: { minutes: number; service: string | null } | null = null;

    for (const leg of journey.legs) {
        // Floored, not rounded. Rounding made 31 seconds "1 minute late",
        // which is not a delay, it is a timetable wobble, and at 05:00 it is a
        // push that wakes a radio to report nothing. The server floors the same
        // way: the phone's own reading and the pushed notice have to agree, or
        // the ring screen contradicts the notification that woke it.
        const minutes = Math.floor(leg.delaySeconds / 60);
        if (minutes >= 1 && (worst === null || minutes > worst.minutes)) {
            worst = { minutes, service: leg.name ?? leg.fromName };
        }
    }

    return worst;
}

const KEY = 'lastDisruption';

/**
 * Mornings kept at once. Every active schedule arms its own occurrence, so more
 * than one alarm can be waiting, and each of them may have news of its own.
 */
const REMEMBERED = 5;

/** Occurrence id to what is wrong with it, oldest entry first. */
type RememberedNotes = Record<string, Disruption>;

/**
 * What the app last knew about each armed morning, kept on the device.
 *
 * The alarm screen is the one place in this app that must work with no network:
 * it is drawn over a lock screen by a native service, and a request that has to
 * finish before anything can be read would leave it blank in a tunnel, in
 * flight mode, or on a phone whose radio has not woken up yet.
 *
 * So whatever the app learns is written here, by all three of the things that
 * learn anything: the push that arrives overnight, the Today screen when it
 * refreshes, and the ring screen itself once it is up.
 *
 * **A note per occurrence, not one note.** This held a single entry until
 * 2026-08-17, which quietly lost news whenever two mornings were armed at once:
 * a cancellation pushed for Thursday was erased the moment Today refreshed and
 * found Wednesday running normally, because clearing was unconditional. The
 * alarm then rang on Thursday with nothing on screen, which is the exact failure
 * this file exists to prevent.
 *
 * Capped rather than swept, since there is no way to list keys through the
 * storage wrapper and an alarm app should not accumulate rows forever.
 */
export async function rememberDisruption(
    occurrenceId: string,
    disruption: Disruption | null,
): Promise<void> {
    const notes = await readNotes();

    // Deleted first in both branches: re-inserting moves this morning to the end
    // of the object, which is what makes the cap below drop the least recently
    // touched one rather than an arbitrary entry.
    delete notes[occurrenceId];

    if (disruption !== null) {
        notes[occurrenceId] = disruption;
    }

    const ids = Object.keys(notes);
    for (const stale of ids.slice(0, Math.max(0, ids.length - REMEMBERED))) {
        delete notes[stale];
    }

    if (Object.keys(notes).length === 0) {
        await Storage.removeItem(KEY);
        return;
    }
    await Storage.setItem(KEY, JSON.stringify(notes));
}

export async function readRememberedDisruption(occurrenceId: string): Promise<Disruption | null> {
    // A note about a different morning is worse than none: it would explain this
    // alarm with last week's cancellation.
    return (await readNotes())[occurrenceId] ?? null;
}

async function readNotes(): Promise<RememberedNotes> {
    const raw = await Storage.getItem(KEY);
    if (raw === null) {
        return {};
    }

    try {
        const parsed = JSON.parse(raw) as RememberedNotes | (Disruption & { occurrenceId?: string });

        // The shape this key held before it became a map. Read rather than
        // discarded, because a phone updating overnight would otherwise lose the
        // note for a morning that is already armed.
        if (typeof parsed.kind === 'string') {
            const legacy = parsed as Disruption & { occurrenceId?: string };
            return legacy.occurrenceId === undefined ? {} : { [legacy.occurrenceId]: legacy };
        }

        return parsed as RememberedNotes;
    } catch {
        return {};
    }
}
