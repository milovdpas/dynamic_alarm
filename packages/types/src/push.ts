import type { WakeChangeReason } from './enums';
import type { IsoDateTimeString } from './domain';

/**
 * What the server sends a phone while its owner is asleep.
 *
 * Declared here so the API builds it and the app parses it from the same
 * definition. A push is the only message in this system with no request behind
 * it, so a mismatch would surface as an alarm that quietly failed to move
 * rather than as a failed call.
 */
export const PUSH_MESSAGE_TYPE = {
    /** The monitor recomputed and the wake time moved. */
    WAKE_CHANGED: 'WAKE_CHANGED',
    /**
     * Something is wrong with the journey, and the alarm is staying where it is.
     *
     * Sent when a disruption is found but the wake time does not move, which is
     * the ordinary case when the user has not opted into being woken later. It
     * changes nothing on the device except what the alarm screen can say, and
     * that is the point: waking at the usual time without knowing your train is
     * cancelled is the worst outcome this app can produce.
     *
     * The alarm screen cannot fetch this for itself. It is drawn over a lock
     * screen by a native service, on a phone that may have no signal and a radio
     * that has not woken up, so the information has to already be on the device
     * before it is needed.
     */
    DISRUPTION_NOTICE: 'DISRUPTION_NOTICE',
} as const;

export type PushMessageType = (typeof PUSH_MESSAGE_TYPE)[keyof typeof PUSH_MESSAGE_TYPE];

export interface WakeChangedPush {
    type: typeof PUSH_MESSAGE_TYPE.WAKE_CHANGED;
    occurrenceId: string;
    /** The time the device should now hold. */
    wakeAt: IsoDateTimeString;
    reason: WakeChangeReason;
    /**
     * Already rendered, because the app cannot write this sentence. It depends
     * on which leg was late and by how much, and the timetable that caused it
     * has changed by the time anyone reads it.
     */
    message: string;
    /**
     * True when this moves the alarm **earlier**, which is the emergency path.
     *
     * Normal changes only ever move an alarm later, so the device can apply them
     * with no judgement at all. An earlier time means a disruption resolved or a
     * cancellation forced a different journey, and it is explicitly best effort:
     * if the push is dropped, the device wakes at the time it already holds and
     * is merely later than it needed to be, rather than late.
     */
    emergency: boolean;
}

/**
 * A disruption the user should know about, whether or not the alarm moved.
 *
 * Deliberately carries no time. Nothing on the device is rescheduled by this,
 * and a wake time in the payload would invite exactly that.
 */
export interface DisruptionNoticePush {
    type: typeof PUSH_MESSAGE_TYPE.DISRUPTION_NOTICE;
    occurrenceId: string;
    kind: 'DELAY' | 'CANCELLATION';
    /** Worst delay across the journey, in minutes. Zero for a cancellation. */
    minutes: number;
    /** The service it happened to, when there is one worth naming. */
    service: string | null;
    /** True when a staged test produced this rather than NS. */
    simulated: boolean;
}

export type PushMessage = WakeChangedPush | DisruptionNoticePush;
