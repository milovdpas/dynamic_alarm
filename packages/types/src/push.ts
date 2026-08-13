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

export type PushMessage = WakeChangedPush;
