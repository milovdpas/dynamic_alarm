import { describe, expect, it, vi } from 'vitest';
import { PUSH_MESSAGE_TYPE, WakeChangeReason } from '@alarm/types';
import type { DisruptionNoticePush, WakeChangedPush } from '@alarm/types';

/*
 * Stubbed per file rather than globally, as the vitest config explains. Reading
 * a payload touches none of these, but the module imports them, and every one
 * of them reaches React Native or a native module that a node runner cannot
 * evaluate.
 */
vi.mock('@/alarm', () => ({
    canGuaranteeAlarm: () => false,
    getAlarmScheduler: () => {
        throw new Error('not used when only reading a payload');
    },
}));
vi.mock('@/api', () => ({ ackOccurrence: () => Promise.resolve() }));
vi.mock('@/alarm/alarmSound', () => ({ resolveAlarmSoundUri: () => Promise.resolve(null) }));
vi.mock('@/alarm/disruption', () => ({ rememberDisruption: () => Promise.resolve() }));
vi.mock('@/alarm/wakeChangeCopy', () => ({ describeWakeChange: () => 'a sentence' }));
vi.mock('@/push/heldAlarm', () => ({
    readHeldAlarm: () => Promise.resolve(null),
    rememberHeldAlarm: () => Promise.resolve(),
}));
vi.mock('@/push/pushLog', () => ({ recordPushOutcome: () => Promise.resolve() }));
vi.mock('@/i18n/i18n', () => ({ default: { t: (key: string) => key } }));

/**
 * Reading a push, which is the last place a message can be lost silently.
 *
 * Everything upstream of this reports success: the server records the notice as
 * sent, Expo accepts it, the background task runs. If the payload is rejected
 * here, nothing anywhere says so, and the user simply never hears.
 */

const { extractPush } = await import('@/push/wakeChangePush');

function notice(overrides: Partial<DisruptionNoticePush> = {}): DisruptionNoticePush {
    return {
        type: PUSH_MESSAGE_TYPE.DISRUPTION_NOTICE,
        occurrenceId: 'occurrence-1',
        kind: 'DELAY',
        minutes: 12,
        service: 'IC 3051',
        simulated: false,
        ...overrides,
    };
}

function wakeChange(overrides: Partial<WakeChangedPush> = {}): WakeChangedPush {
    return {
        type: PUSH_MESSAGE_TYPE.WAKE_CHANGED,
        occurrenceId: 'occurrence-1',
        wakeAt: '2026-08-19T05:34:00.000Z',
        reason: WakeChangeReason.DELAY,
        simulated: false,
        emergency: false,
        ...overrides,
    };
}

describe('which disruption notices survive being read', () => {
    it('accepts a delay', () => {
        expect(extractPush(notice())).toEqual(notice());
    });

    it('accepts a cancellation', () => {
        const push = notice({ kind: 'CANCELLATION', minutes: 0 });

        expect(extractPush(push)).toEqual(push);
    });

    it('accepts a cancellation with no acceptable replacement', () => {
        /*
         * This is the regression. The guard listed DELAY and CANCELLATION only,
         * so every NO_REPLACEMENT notice was discarded here while the server
         * recorded it as delivered and never sent it again. That notice is the
         * one case the server describes as "the only wrong response is silence":
         * the train is cancelled, nothing runs inside the hours its owner will
         * travel, and the alarm is deliberately staying where it is.
         */
        const push = notice({ kind: 'NO_REPLACEMENT', minutes: 0, service: null });

        expect(extractPush(push)).toEqual(push);
    });

    it('rejects a kind the app does not know', () => {
        expect(extractPush({ ...notice(), kind: 'TEAPOT' })).toBeNull();
    });

    it('rejects a notice with no occurrence to attach it to', () => {
        const { occurrenceId: _dropped, ...rest } = notice();

        expect(extractPush(rest)).toBeNull();
    });
});

describe('finding the payload wherever the platform put it', () => {
    it('reads it out of an Android JSON string body', () => {
        const push = notice({ kind: 'NO_REPLACEMENT', minutes: 0, service: null });

        expect(extractPush({ data: JSON.stringify(push) })).toEqual(push);
    });

    it('reads a wake change out of a nested notification payload', () => {
        const push = wakeChange();

        expect(extractPush({ request: { content: { data: push } } })).toEqual(push);
    });
});

describe('a wake change carries facts rather than a finished sentence', () => {
    it('is readable with no message field at all', () => {
        // The server stopped sending prose: it arrived in English whatever
        // language the phone was set to, and there was nowhere left to translate
        // it once a time had been baked into it.
        const push = wakeChange({ reason: WakeChangeReason.CANCELLATION, simulated: true });

        expect(extractPush(push)).toEqual(push);
    });

    it('still moves an alarm when the payload has changed shape around it', () => {
        /*
         * The guard asks for the id and the time and nothing else, and that is
         * deliberate. It has already lost every push once, by insisting on a
         * `message` field the server had stopped sending, and a guard that
         * insists on whatever replaced it would fail the same way next time.
         * This is the last place a push can be dropped with nothing anywhere
         * saying so, and a usable time is worth acting on.
         */
        const shifted = {
            type: PUSH_MESSAGE_TYPE.WAKE_CHANGED,
            occurrenceId: 'occurrence-1',
            wakeAt: '2026-08-19T05:34:00.000Z',
            somethingAddedLater: 42,
        };

        expect(extractPush(shifted)).toEqual(shifted);
    });

    it('still refuses one with no time to arm', () => {
        // Lenient is not credulous. Without a time there is nothing to do.
        const { wakeAt: _dropped, ...rest } = wakeChange();

        expect(extractPush(rest)).toBeNull();
    });
});
