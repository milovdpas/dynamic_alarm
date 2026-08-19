import { describe, expect, it, vi } from 'vitest';
import { AlarmEventType, PUSH_MESSAGE_TYPE, WakeChangeReason } from '@alarm/types';
import type { AlarmEventDto, WakeChangedPush } from '@alarm/types';

/**
 * The sentence the server used to write, now written here.
 *
 * It is the same words in both places on purpose: the notification that wakes
 * somebody at 03:00 and the timeline entry they read at 09:00 are describing one
 * event, and two wordings for it is how a screen stops being believed.
 */

// i18n reads a stored language through Storage, which reaches a native module.
vi.mock('@/utils/modules/Storage', () => ({
    default: {
        getItem: () => Promise.resolve(null),
        setItem: () => Promise.resolve(),
        removeItem: () => Promise.resolve(),
    },
    isPersistent: () => true,
}));

const i18n = (await import('@/i18n/i18n')).default;
const { describeAlarmEvent, describeWakeChange } = await import('@/alarm/wakeChangeCopy');

/** 05:34 UTC, which is 07:34 in Amsterdam. The conversion is half the point. */
const WAKE_AT = '2026-08-19T05:34:00.000Z';

function push(overrides: Partial<WakeChangedPush> = {}): WakeChangedPush {
    return {
        type: PUSH_MESSAGE_TYPE.WAKE_CHANGED,
        occurrenceId: 'occurrence-1',
        wakeAt: WAKE_AT,
        reason: WakeChangeReason.DELAY,
        simulated: false,
        emergency: false,
        ...overrides,
    };
}

function event(overrides: Partial<AlarmEventDto> = {}): AlarmEventDto {
    return {
        id: 'event-1',
        occurrenceId: 'occurrence-1',
        type: AlarmEventType.MOVED_LATER,
        fromAt: '2026-08-19T05:20:00.000Z',
        toAt: WAKE_AT,
        reason: WakeChangeReason.DELAY,
        simulated: false,
        createdAt: '2026-08-19T03:00:00.000Z',
        ...overrides,
    };
}

describe('describing why an alarm moved', () => {
    it('names the new time in the zone the user lives in', async () => {
        await i18n.changeLanguage('en');

        // Not 05:34. The API serialises with `toISOString()`, and showing that
        // unconverted is exactly two hours of somebody's morning.
        expect(describeWakeChange(push())).toContain('07:34');
    });

    it('words each reason differently, because they are different news', async () => {
        await i18n.changeLanguage('en');

        const delay = describeWakeChange(push({ reason: WakeChangeReason.DELAY }));
        const cancelled = describeWakeChange(push({ reason: WakeChangeReason.CANCELLATION }));
        const traffic = describeWakeChange(push({ reason: WakeChangeReason.TRAFFIC_WORSE }));

        expect(new Set([delay, cancelled, traffic]).size).toBe(3);
    });

    it('marks a test as a test', async () => {
        await i18n.changeLanguage('en');

        // Someone woken early by a staged disruption has to be able to see that
        // is what happened, or a simulation is indistinguishable from the
        // product being wrong.
        expect(describeWakeChange(push({ simulated: true }))).toContain('TEST');
    });

    it('renders no translation key, whatever the reason', async () => {
        await i18n.changeLanguage('en');

        for (const reason of Object.values(WakeChangeReason)) {
            const copy = describeWakeChange(push({ reason }));
            expect(copy).not.toContain('event.');
            expect(copy).not.toContain('{{');
        }
    });
});

describe('the language it comes out in', () => {
    it('follows the app, which is the whole reason this moved off the server', async () => {
        await i18n.changeLanguage('nl');
        const dutch = describeWakeChange(push({ reason: WakeChangeReason.CANCELLATION }));

        await i18n.changeLanguage('en');
        const english = describeWakeChange(push({ reason: WakeChangeReason.CANCELLATION }));

        expect(dutch).not.toBe(english);
        expect(dutch).toContain('07:34');
    });

    it('has Dutch copy for every reason, not a fallback to English', async () => {
        await i18n.changeLanguage('nl');
        const dutch = Object.values(WakeChangeReason).map((reason) =>
            describeWakeChange(push({ reason })),
        );

        await i18n.changeLanguage('en');
        const english = Object.values(WakeChangeReason).map((reason) =>
            describeWakeChange(push({ reason })),
        );

        dutch.forEach((copy, index) => {
            expect(copy).not.toBe(english[index]);
        });
    });
});

describe('a payload from a server that is a version ahead', () => {
    it('says something rather than rendering a translation key', async () => {
        await i18n.changeLanguage('en');

        // The push guard accepts a reason it does not recognise, because
        // dropping the message would stop the alarm moving. The copy has to
        // survive that: `event.SOMETHING_NEW` on a lock screen is worse than a
        // vague sentence.
        const copy = describeWakeChange(
            push({ reason: 'SOMETHING_NEW' as WakeChangeReason }),
        );

        expect(copy).not.toContain('event.');
        expect(copy).not.toContain('{{');
        expect(copy.length).toBeGreaterThan(0);
    });
});

describe('the same words for a recorded event', () => {
    it('says what the push said, so the two never disagree', async () => {
        await i18n.changeLanguage('en');

        expect(describeAlarmEvent(event({ reason: WakeChangeReason.CANCELLATION }))).toBe(
            describeWakeChange(push({ reason: WakeChangeReason.CANCELLATION })),
        );
    });

    it('reads the time it moved to, not the time it was written', async () => {
        await i18n.changeLanguage('en');

        // `createdAt` is 03:00 and `toAt` is 07:34. The entry is about the alarm,
        // not about when the server noticed.
        expect(describeAlarmEvent(event())).toContain('07:34');
    });

    it('still says something when an event carries no time', async () => {
        await i18n.changeLanguage('en');

        const copy = describeAlarmEvent(event({ toAt: null }));

        expect(copy).not.toContain('{{');
        expect(copy).not.toContain('event.');
    });
});
