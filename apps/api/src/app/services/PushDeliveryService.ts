import { JourneyStatus, LegType, PUSH_MESSAGE_TYPE } from '@alarm/types';
import type { Journey, JourneyLeg, WakeChangeReason } from '@alarm/types';
import { shouldSendWakePush } from '@alarm/core';

import AlarmEvent from '../models/AlarmEvent.entity';
import type Device from '../models/Device.entity';
import type ScheduleOccurrence from '../models/ScheduleOccurrence.entity';
import { PushService } from './PushService';

/**
 * The facts a wake push carries about why it exists.
 *
 * No sentence. The app writes that, from its own translations, because a string
 * rendered here reaches a Dutch phone in English and there is nowhere on the
 * device to translate it back.
 */
export interface WakeChangeSummary {
    reason: WakeChangeReason;
    simulated: boolean;
}

/** What delivery did, so a tick can say so rather than guess. */
export type DeliveryOutcome =
    | 'SENT'
    /** The device already holds this time, or the alarm has passed. */
    | 'NOT_NEEDED'
    /** Sent recently and not yet acknowledged, so probably still in flight. */
    | 'IN_FLIGHT'
    /** Nothing was ever recorded for this occurrence, so there is nothing to say. */
    | 'NOTHING_TO_SAY'
    /** Expo refused it, the device has no token, or the request failed. */
    | 'FAILED';

/**
 * Telling a phone that its alarm moved.
 *
 * Separate from the monitor on purpose. The monitor's job is to keep the
 * server's answer correct, and that must not depend on whether a third party
 * accepted a message: letting a network blip abort a pass that had already
 * computed the right time would trade the reliable half of this system for the
 * unreliable one.
 *
 * So nothing here throws, and the only state it writes is the record of a
 * successful send. A failure leaves the row exactly as if no push had been
 * attempted, which is what makes the next tick retry it without any queue to
 * keep correct.
 */
export class PushDeliveryService {
    /**
     * `push` is injected so a test can assert the bookkeeping without a live
     * Expo call. That matters more than usual here: the branch that writes
     * `pushedWakeAt` is unreachable in development, where no device has a token.
     */
    constructor(private readonly push: PushService = new PushService()) {}

    async deliver(
        occurrence: ScheduleOccurrence,
        device: Device,
        timezone: string,
        change: WakeChangeSummary | null,
        now = new Date(),
    ): Promise<DeliveryOutcome> {
        const wakeAt = occurrence.currentWakeAt;
        if (wakeAt === null) {
            return 'NOT_NEEDED';
        }

        const decision = shouldSendWakePush({
            wakeAt: wakeAt.toISOString(),
            ackedWakeAt: occurrence.deviceAckedWakeAt?.toISOString() ?? null,
            pushedWakeAt: occurrence.pushedWakeAt?.toISOString() ?? null,
            lastPushedAt: occurrence.lastPushedAt?.toISOString() ?? null,
            now: now.toISOString(),
            timezone,
        });

        if (!decision.send) {
            return decision.reason === 'IN_FLIGHT' ? 'IN_FLIGHT' : 'NOT_NEEDED';
        }

        // Null on a retry, where the reason comes from the recorded event. The
        // event is what the alarm was actually moved for, and re-deriving it
        // from the timetable as it looks now would explain a different morning.
        const told = change ?? (await this.recordedChange(occurrence));
        if (told === null) {
            return 'NOTHING_TO_SAY';
        }

        const held = occurrence.deviceAckedWakeAt;
        const outcome = await this.push.send(
            device,
            {
                type: PUSH_MESSAGE_TYPE.WAKE_CHANGED,
                occurrenceId: occurrence.id,
                wakeAt: wakeAt.toISOString(),
                reason: told.reason,
                simulated: told.simulated,
                // Earlier than what the phone holds, so the device applies it
                // only because the server says not moving is worse.
                emergency: held !== null && wakeAt.getTime() < held.getTime(),
                ...replacementFor(occurrence),
            },
            // Worthless once the alarm has rung, so Expo drops it rather than
            // the app having to reject a message about a past morning.
            wakeAt,
        );

        if (outcome !== 'SENT') {
            console.warn(`Push for occurrence ${occurrence.id}: ${outcome}`);
            return 'FAILED';
        }

        occurrence.pushedWakeAt = wakeAt;
        occurrence.lastPushedAt = now;
        await occurrence.save();
        return 'SENT';
    }

    /**
     * Tells the phone that its journey is disrupted, whatever the alarm did.
     *
     * The settings decide whether an alarm may **move**. They were never meant
     * to decide whether somebody is told their train is cancelled, and the
     * difference matters most in exactly the case where nothing moves: the alarm
     * rings at the usual time and its owner leaves for a train that is not
     * coming.
     *
     * The alarm screen cannot ask for this itself. It is drawn over a lock
     * screen by a native service on a phone that may have no signal, so the news
     * has to be on the device before it is needed.
     *
     * Deduplicated by state rather than by event, and by a band of minutes rather
     * than by the exact number. Near the alarm the monitor re-checks every three
     * minutes and a reported delay drifts a minute either way on its own, so an
     * exact comparison deduplicated nothing and the same news went out on every
     * pass. A delay growing from twelve to twenty is worth saying; one breathing
     * between twelve and thirteen is not.
     */
    async notify(
        occurrence: ScheduleOccurrence,
        device: Device,
        journey: Journey | null,
        gone: boolean,
        simulated: boolean,
    ): Promise<DeliveryOutcome> {
        const disruption = describeDisruption(journey, gone);
        if (disruption === null) {
            // Running normally. Anything the device was told earlier is stale,
            // so the record is cleared and a later disruption pushes again.
            occurrence.noticeKey = null;
            return 'NOT_NEEDED';
        }

        const key = `${disruption.kind}:${String(band(disruption.minutes))}`;
        if (occurrence.noticeKey === key) {
            return 'NOT_NEEDED';
        }

        const wakeAt = occurrence.currentWakeAt;
        const outcome = await this.push.send(
            device,
            {
                type: PUSH_MESSAGE_TYPE.DISRUPTION_NOTICE,
                occurrenceId: occurrence.id,
                kind: disruption.kind,
                minutes: disruption.minutes,
                service: disruption.service,
                simulated,
            },
            // Pointless once the alarm has rung, like every other message here.
            wakeAt ?? new Date(),
        );

        if (outcome !== 'SENT') {
            console.warn(`Disruption notice for occurrence ${occurrence.id}: ${outcome}`);
            return 'FAILED';
        }

        occurrence.noticeKey = key;
        occurrence.noticeSentAt = new Date();
        return 'SENT';
    }

    /**
     * Tells the phone its train is cancelled and nothing acceptable exists.
     *
     * The alarm has not moved and will not: every remaining service falls
     * outside the hours its owner said they would travel. That is the one case
     * where the app has no useful answer, and the only wrong response to it is
     * silence, since the alarm will otherwise ring on time for a journey that
     * cannot be made.
     */
    async notifyNoReplacement(
        occurrence: ScheduleOccurrence,
        device: Device,
        simulated: boolean,
    ): Promise<DeliveryOutcome> {
        const key = 'NO_REPLACEMENT';
        if (occurrence.noticeKey === key) {
            return 'NOT_NEEDED';
        }

        const outcome = await this.push.send(
            device,
            {
                type: PUSH_MESSAGE_TYPE.DISRUPTION_NOTICE,
                occurrenceId: occurrence.id,
                kind: 'NO_REPLACEMENT',
                minutes: 0,
                service: null,
                simulated,
            },
            occurrence.currentWakeAt ?? new Date(),
        );

        if (outcome !== 'SENT') {
            console.warn(`No-replacement notice for occurrence ${occurrence.id}: ${outcome}`);
            return 'FAILED';
        }

        occurrence.noticeKey = key;
        occurrence.noticeSentAt = new Date();
        return 'SENT';
    }

    /**
     * The change being retried, as it was recorded when it happened.
     *
     * Read back rather than re-derived: the delay that caused it may have
     * changed since, and describing the current timetable would explain a
     * morning nobody's alarm was moved for.
     */
    private async recordedChange(occurrence: ScheduleOccurrence): Promise<WakeChangeSummary | null> {
        const event = await AlarmEvent.findOne({
            where: { occurrenceId: occurrence.id },
            order: { createdAt: 'DESC' },
        });
        return event === null ? null : { reason: event.reason, simulated: event.simulated };
    }
}

/**
 * A delay, rounded down to the band the device has already been told about.
 *
 * Deduplicating on the exact minute deduplicated nothing: a reported delay moves
 * between twelve and thirteen on its own, and near the alarm the monitor looks
 * every three minutes, so the same news woke the radio all morning. A band means
 * a delay that grows materially is still worth saying and one that merely
 * breathes is not.
 */
const NOTICE_BAND_MINUTES = 5;

function band(minutes: number): number {
    return Math.floor(minutes / NOTICE_BAND_MINUTES) * NOTICE_BAND_MINUTES;
}

/**
 * What was lost and what was chosen instead, for a re-planned cancellation.
 *
 * Empty for everything else. A delay has no replacement, and neither does a
 * cancellation the device declined to act on: there the alarm has not moved, and
 * naming a train nobody is being woken for would be worse than saying nothing.
 *
 * Sent with the push rather than looked up on the phone, because this arrives
 * while its owner is asleep and the screen that shows it has to work at 06:00
 * with no network.
 */
function replacementFor(occurrence: ScheduleOccurrence): {
    cancelledService?: string | null;
    replacement?: { service: string | null; departureAt: string; fromName: string } | null;
} {
    const replaced = occurrence.replacedJourney;
    // The journey lives on the stored plan, which is the one the wake time was
    // computed from, so this always names the train the alarm was set for.
    const journey = occurrence.planSnapshot?.journey ?? null;
    if (replaced === null || journey === null) {
        return {};
    }

    /*
     * The train that is gone: the leg NS flagged, or failing that the first leg
     * that actually goes somewhere.
     *
     * It used to fall back to `legs[0]`, which for a door-to-door plan is the
     * walk from the front door. A journey cancelled as a whole flags no single
     * leg, so that fallback ran, and the walk was announced as the service that
     * had stopped running.
     */
    const gone = replaced.legs.find((leg) => leg.cancelled) ?? serviceLegOf(replaced);
    // The same rule the engine compares departures by, so the replacement named
    // in the push is the one the wake time was moved to.
    const service = serviceLegOf(journey);

    return {
        cancelledService: named(gone?.name, gone?.fromName),
        replacement:
            service === undefined
                ? null
                : {
                      service: named(service.name),
                      departureAt: service.actualDeparture,
                      fromName: service.fromName,
                  },
    };
}

/**
 * The first leg a timetable owns, skipping the traveller's own walk or ride.
 *
 * Compared against `LegType`, not against bare strings. The two happen to have
 * the same values, so a loose version works and would keep working right up
 * until a member is renamed.
 */
function serviceLegOf(journey: Journey): JourneyLeg | undefined {
    return journey.legs.find((leg) => leg.type !== LegType.WALK && leg.type !== LegType.BIKE);
}

/**
 * A name, or null when the provider did not give one.
 *
 * Blank counts as absent. A car route has no service to name, so the car
 * provider sends empty strings, and `??` alone would pass one straight through
 * to "{{service}} is not running" on a lock screen.
 */
function named(...candidates: (string | undefined | null)[]): string | null {
    for (const candidate of candidates) {
        if (candidate !== undefined && candidate !== null && candidate.trim() !== '') {
            return candidate;
        }
    }
    return null;
}

/**
 * What is wrong with a journey, in the terms a notice is written in.
 *
 * `gone` is passed rather than read off a null journey, and the difference is
 * not academic: a fixed-travel schedule has no journey at all, and the car
 * provider answers "route it again" rather than handing one back. Both used to
 * land here as null and be announced to their owners as cancellations.
 *
 * Cancellation beats delay, because a train that is not running is not a train
 * that is late, and a notice saying both buries the one that matters.
 */
function describeDisruption(
    journey: Journey | null,
    gone: boolean,
): { kind: 'DELAY' | 'CANCELLATION'; minutes: number; service: string | null } | null {
    if (gone) {
        return { kind: 'CANCELLATION', minutes: 0, service: null };
    }
    if (journey === null) {
        // A fixed travel time. Nothing can disrupt a number the user typed.
        return null;
    }

    const cancelled = journey.legs.find((leg) => leg.cancelled);
    if (cancelled !== undefined || journey.status === JourneyStatus.CANCELLED) {
        return {
            kind: 'CANCELLATION',
            minutes: 0,
            service: cancelled?.name ?? cancelled?.fromName ?? null,
        };
    }

    let worst: { minutes: number; service: string | null } | null = null;
    for (const leg of journey.legs) {
        /**
         * A car leg is skipped, and that is not a shortcut.
         *
         * Its `delaySeconds` is congestion measured against free flow, which is
         * the ordinary state of a road at 07:30 rather than news, and the plan
         * has already priced it in. Reporting it as a delay also had nowhere to
         * get a service name from, so it borrowed the leg's `fromName` and told
         * people who drive to work that "Origin is 12 minutes late".
         *
         * What a driver needs to hear is that their alarm moved, which travels
         * as a wake change with `TRAFFIC_WORSE` and is worded for a road.
         */
        if (leg.type === LegType.CAR) {
            continue;
        }
        // Floored rather than rounded, and the app floors identically. A 31
        // second delay is not a minute late, and pushing it wakes a device to
        // say nothing.
        const minutes = Math.floor(leg.delaySeconds / 60);
        if (minutes >= 1 && (worst === null || minutes > worst.minutes)) {
            worst = { minutes, service: leg.name ?? leg.fromName };
        }
    }

    return worst === null ? null : { kind: 'DELAY', ...worst };
}
