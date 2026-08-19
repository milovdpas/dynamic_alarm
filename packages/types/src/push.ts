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

/**
 * The alarm moved, and the device should hold a new time.
 *
 * Deliberately carries no prose. `reason` and `wakeAt` are everything the
 * sentence was built from, and the app owns the wording: all user-facing copy
 * lives in its translations, and a pre-rendered English string would be the one
 * message in the product that ignores the language its owner chose.
 */
export interface WakeChangedPush {
    type: typeof PUSH_MESSAGE_TYPE.WAKE_CHANGED;
    occurrenceId: string;
    /** The time the device should now hold. */
    wakeAt: IsoDateTimeString;
    reason: WakeChangeReason;
    /**
     * True when a staged test produced this rather than NS.
     *
     * A separate field rather than a marker inside a sentence. The device shows
     * it on the alarm screen and in the notification, and reading it out of
     * prose meant the server and the app agreeing on a prefix string, which is
     * the kind of contract that breaks silently.
     */
    simulated: boolean;
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
    /**
     * The service that is not running, and the one chosen instead.
     *
     * Present only for a cancellation the device opted into acting on, which is
     * the case where the alarm has moved and the person waking up needs to be
     * told a different train. Sent with the push rather than looked up on the
     * phone, because this arrives while they are asleep and the screen that
     * shows it has to work at 06:00 with no network.
     *
     * Optional so an older app ignores it rather than failing to parse a message
     * that moves an alarm.
     */
    cancelledService?: string | null;
    replacement?: {
        service: string | null;
        departureAt: IsoDateTimeString;
        fromName: string;
    } | null;
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
    /**
     * `NO_REPLACEMENT` is a cancellation with nothing acceptable to take
     * instead: every remaining service falls outside the hours the user said
     * they would travel. The alarm stays where it is, and this notice is the
     * only way they would ever know.
     */
    kind: 'DELAY' | 'CANCELLATION' | 'NO_REPLACEMENT';
    /** Worst delay across the journey, in minutes. Zero for a cancellation. */
    minutes: number;
    /** The service it happened to, when there is one worth naming. */
    service: string | null;
    /** True when a staged test produced this rather than NS. */
    simulated: boolean;
}

export type PushMessage = WakeChangedPush | DisruptionNoticePush;
