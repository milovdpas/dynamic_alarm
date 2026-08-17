import { JourneyStatus, PUSH_MESSAGE_TYPE } from '@alarm/types';
import type { Journey, WakeChangeReason } from '@alarm/types';
import { shouldSendWakePush } from '@alarm/core';

import AlarmEvent from '../models/AlarmEvent.entity';
import type Device from '../models/Device.entity';
import type ScheduleOccurrence from '../models/ScheduleOccurrence.entity';
import { PushService } from './PushService';

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
        change: { reason: WakeChangeReason; message: string } | null,
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

        // Null on a retry, where the reason and the sentence come from the
        // recorded event. Describing the timetable as it looks now would explain
        // a different morning than the one the alarm was moved for.
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
                message: told.message,
                // Earlier than what the phone holds, so the device applies it
                // only because the server says not moving is worse.
                emergency: held !== null && wakeAt.getTime() < held.getTime(),
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
     * Deduplicated by state rather than by event. Near the alarm the monitor
     * re-checks every three minutes; a delay that stays at twelve minutes is not
     * worth waking the radio for twice, and one that grows to twenty is.
     */
    async notify(
        occurrence: ScheduleOccurrence,
        device: Device,
        journey: Journey | null,
        simulated: boolean,
    ): Promise<DeliveryOutcome> {
        const disruption = describeDisruption(journey);
        if (disruption === null) {
            // Running normally. Anything the device was told earlier is stale,
            // so the record is cleared and a later disruption pushes again.
            occurrence.noticeKey = null;
            return 'NOT_NEEDED';
        }

        const key = `${disruption.kind}:${String(disruption.minutes)}`;
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
     * The change being retried, as it was recorded when it happened.
     *
     * Read back rather than rewritten: the delay that caused it may have
     * changed since, and a sentence describing the current timetable would
     * explain a morning nobody's alarm was moved for.
     */
    private async recordedChange(
        occurrence: ScheduleOccurrence,
    ): Promise<{ reason: WakeChangeReason; message: string } | null> {
        const event = await AlarmEvent.findOne({
            where: { occurrenceId: occurrence.id },
            order: { createdAt: 'DESC' },
        });
        return event === null ? null : { reason: event.reason, message: event.message };
    }
}

/**
 * What is wrong with a journey, in the terms a notice is written in.
 *
 * A journey the provider could not reconstruct at all is a cancellation: that is
 * exactly what NS is saying when a trip stops existing.
 *
 * Cancellation beats delay, because a train that is not running is not a train
 * that is late, and a notice saying both buries the one that matters.
 */
function describeDisruption(
    journey: Journey | null,
): { kind: 'DELAY' | 'CANCELLATION'; minutes: number; service: string | null } | null {
    if (journey === null) {
        return { kind: 'CANCELLATION', minutes: 0, service: null };
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
        const minutes = Math.round(leg.delaySeconds / 60);
        if (minutes >= 1 && (worst === null || minutes > worst.minutes)) {
            worst = { minutes, service: leg.name ?? leg.fromName };
        }
    }

    return worst === null ? null : { kind: 'DELAY', ...worst };
}
