import { describe, expect, it, vi } from 'vitest';
import { PUSH_MESSAGE_TYPE, WakeChangeReason } from '@alarm/types';
import type { DisruptionNoticePush, WakeChangedPush } from '@alarm/types';

// Keys and their arguments come straight back, so a test can assert which
// sentence was chosen without depending on the words.
vi.mock('@/i18n/i18n', () => ({
    default: {
        t: (key: string, options?: Record<string, unknown>) =>
            options === undefined ? key : `${key} ${JSON.stringify(options)}`,
        language: 'en',
    },
}));
vi.mock('@/utils/time', () => ({
    relativeDay: (_t: unknown, date: string) => `DAY(${date})`,
    clock: (iso: string) => `CLOCK(${iso})`,
}));
vi.mock('@/utils/modules/optionalModule', () => ({ loadOptionalModule: () => null }));
// The harness is Node with no React Native. The module only reads the platform
// to pick a channel, so a stub with a platform is all it needs.
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));

const { noticeCopy, shouldAnnounce } = await import('./announce');

const NOW = new Date('2026-09-08T20:00:00.000Z');

function wakeChanged(wakeAt: string): WakeChangedPush {
    return {
        type: PUSH_MESSAGE_TYPE.WAKE_CHANGED,
        occurrenceId: 'occ',
        date: wakeAt.slice(0, 10),
        wakeAt,
        reason: WakeChangeReason.CANCELLATION,
        simulated: false,
        emergency: false,
    };
}

function notice(overrides: Partial<DisruptionNoticePush> = {}): DisruptionNoticePush {
    return {
        type: PUSH_MESSAGE_TYPE.DISRUPTION_NOTICE,
        occurrenceId: 'occ',
        date: '2026-09-10',
        wakeAt: '2026-09-10T05:31:00.000Z',
        kind: 'CANCELLATION',
        minutes: 0,
        service: 'Intercity 3052',
        simulated: false,
        ...overrides,
    };
}

describe('which pushes are shown rather than only acted on', () => {
    it('shows a change to a morning beyond the arming window', () => {
        // Thursday, pushed on Tuesday evening. Nothing else would tell you.
        expect(shouldAnnounce(wakeChanged('2026-09-10T05:31:00.000Z'), NOW)).toBe(true);
    });

    it('stays silent about tonight, which the ring screen will explain', () => {
        // Six hours out. A notification at 03:00 about twelve minutes gained
        // costs more sleep than it announces.
        expect(shouldAnnounce(wakeChanged('2026-09-09T02:00:00.000Z'), NOW)).toBe(false);
    });

    it('treats a notice the same way as a move', () => {
        expect(shouldAnnounce(notice(), NOW)).toBe(true);
        expect(shouldAnnounce(notice({ wakeAt: '2026-09-09T02:00:00.000Z' }), NOW)).toBe(false);
    });

    it('stays silent when it cannot tell which morning', () => {
        expect(shouldAnnounce(notice({ wakeAt: null }), NOW)).toBe(false);
    });
});

describe('what the notification says', () => {
    it('leads with the day, because that is the news', () => {
        const copy = noticeCopy(wakeChanged('2026-09-10T05:31:00.000Z'));

        expect(copy.title).toContain('notice.title_wake_changed');
        expect(copy.title).toContain('DAY(2026-09-10)');
    });

    it('describes a move with the same sentence the trail uses', () => {
        const copy = noticeCopy(wakeChanged('2026-09-10T05:31:00.000Z'));

        expect(copy.body).toContain('event.cancellation');
    });

    it('names the cancelled service on a notice', () => {
        const copy = noticeCopy(notice());

        expect(copy.title).toContain('notice.title_disruption');
        expect(copy.body).toContain('disruption.cancelled');
        expect(copy.body).toContain('Intercity 3052');
    });

    it('falls back to "your journey" when the service has no name', () => {
        const copy = noticeCopy(notice({ service: null, kind: 'DELAY', minutes: 12 }));

        expect(copy.body).toContain('disruption.delayed');
        expect(copy.body).toContain('ring.your_journey');
    });

    it('says when nothing acceptable is left', () => {
        expect(noticeCopy(notice({ kind: 'NO_REPLACEMENT' })).body).toContain('ring.no_replacement');
    });
});
