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
        const minutes = Math.round(leg.delaySeconds / 60);
        // Under a minute is timetable jitter rather than a delay, and the same
        // floor the server uses before it will push anything.
        if (minutes >= 1 && (worst === null || minutes > worst.minutes)) {
            worst = { minutes, service: leg.name ?? leg.fromName };
        }
    }

    return worst;
}

const KEY = 'lastDisruption';

/**
 * The last known disruption, kept on the device for the ring screen.
 *
 * The alarm screen is the one place in this app that must work with no network:
 * it is drawn over a lock screen by a native service, and a request that has to
 * finish before anything can be read would leave it blank in a tunnel, in
 * flight mode, or on a phone whose radio has not woken up yet.
 *
 * So whatever the app last learned is written here, and the ring screen reads it
 * instantly. It also refreshes in the background when it can, because a stored
 * note is by definition from the last time the app was awake.
 *
 * Keyed by occurrence so a note cannot outlive the morning it belongs to and
 * appear on the next one.
 */
export async function rememberDisruption(
    occurrenceId: string,
    disruption: Disruption | null,
): Promise<void> {
    if (disruption === null) {
        await Storage.removeItem(KEY);
        return;
    }
    await Storage.setItem(KEY, JSON.stringify({ occurrenceId, ...disruption }));
}

export async function readRememberedDisruption(occurrenceId: string): Promise<Disruption | null> {
    const raw = await Storage.getItem(KEY);
    if (raw === null) {
        return null;
    }

    try {
        const parsed = JSON.parse(raw) as Disruption & { occurrenceId?: string };
        // A note about a different morning is worse than none: it would explain
        // this alarm with last week's cancellation.
        return parsed.occurrenceId === occurrenceId ? parsed : null;
    } catch {
        return null;
    }
}
