import { PUSH_MESSAGE_TYPE } from '@alarm/types';
import type { WakeChangeReason } from '@alarm/types';
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
