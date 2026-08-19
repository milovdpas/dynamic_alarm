import { JourneyStatus } from '@alarm/types';
import type { Journey, JourneyLeg, OccurrenceResponse } from '@alarm/types';

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
    /**
     * The service to take instead, when the alarm was allowed to move.
     *
     * Only present for a cancellation the user opted into acting on. Without the
     * opt-in the alarm stays put, there is no replacement to name, and telling
     * somebody about a train they are not being woken for would be worse than
     * saying nothing.
     */
    replacement?: {
        service: string | null;
        departureAt: string;
        fromName: string;
    } | null;
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

    /*
     * A cancellation that was acted on. The journey now on the occurrence is the
     * replacement, and the train that is not running has moved to
     * `replacedJourney`, so reading only `journey` would find an ordinary
     * morning and say nothing at all.
     *
     * This is the difference the user's own setting makes, and it should be the
     * difference on screen too: with moving switched off they are told their
     * train is gone, and with it switched on they are told which one to take.
     */
    // `?? null` rather than a plain read, and this project has paid for that
    // lesson twice already: a field that is absent is not a field that is null,
    // and `undefined !== null` is true, so the branch below would run on a
    // morning that has no replacement and read `legs` off nothing.
    const replaced = occurrence.replacedJourney ?? null;
    if (replaced !== null) {
        /*
         * Never the walk to the station, which `legs[0]` was. A journey
         * cancelled as a whole flags no single leg, so the first one was named
         * as the service that stopped running: the walk from your own front
         * door, reported as a train that is not running.
         */
        const goneLeg = replaced.legs.find((leg) => leg.cancelled) ?? serviceLeg(replaced);
        return {
            kind: 'CANCELLATION',
            minutes: 0,
            service: named(goneLeg?.name, goneLeg?.fromName),
            simulated,
            replacement: firstService(journey),
        };
    }

    if (cancelledLeg !== undefined || journey.status === JourneyStatus.CANCELLED) {
        return {
            kind: 'CANCELLATION',
            minutes: 0,
            service: named(cancelledLeg?.name, cancelledLeg?.fromName),
            simulated,
            // Nothing was re-planned, so there is nothing to catch instead. The
            // alarm is staying where it is.
            replacement: null,
        };
    }

    const worst = worstDelay(journey);
    if (worst === null) {
        return null;
    }

    return { kind: 'DELAY', minutes: worst.minutes, service: worst.service, simulated };
}

/**
 * The first leg that actually goes somewhere, skipping the walk or cycle to the
 * station. The same rule the engine uses when it compares departures, so the
 * time on the alarm screen is the time the replacement was chosen by.
 *
 * Used for both halves of a cancellation: the service that is gone, and the one
 * to take instead. Neither of them is ever somebody's own walk to the platform.
 */
function serviceLeg(journey: Journey): JourneyLeg | undefined {
    return journey.legs.find((leg) => leg.type !== 'WALK' && leg.type !== 'BIKE');
}

function firstService(journey: Journey): Disruption['replacement'] {
    const leg = serviceLeg(journey);
    if (leg === undefined) {
        return null;
    }
    return {
        service: named(leg.name),
        departureAt: leg.actualDeparture,
        fromName: leg.fromName,
    };
}

/**
 * A service name, or null when the provider did not give one.
 *
 * Blank counts as absent. A car route has no train to name, so the car provider
 * sends empty strings, and `?? ` alone would happily pass one straight into
 * "{{service}} is not running".
 */
function named(...candidates: (string | undefined)[]): string | null {
    for (const candidate of candidates) {
        if (candidate !== undefined && candidate.trim() !== '') {
            return candidate;
        }
    }
    return null;
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
            worst = { minutes, service: named(leg.name, leg.fromName) };
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
