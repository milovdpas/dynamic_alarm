import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PUSH_MESSAGE_TYPE, WakeChangeReason } from '@alarm/types';
import type { DisruptionNoticePush, WakeChangedPush } from '@alarm/types';

/** What the fake notifications module was asked to show, in order. */
const posted: { identifier?: string; title?: string }[] = [];
const store = new Map<string, string>();

vi.mock('@/utils/modules/Storage', () => ({
    default: {
        getItem: (key: string) => Promise.resolve(store.get(key) ?? null),
        setItem: (key: string, value: string) => {
            store.set(key, value);
            return Promise.resolve();
        },
        removeItem: (key: string) => {
            store.delete(key);
            return Promise.resolve();
        },
    },
}));

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
// A notifications module that records what it is asked to show.
vi.mock('@/utils/modules/optionalModule', () => ({
    loadOptionalModule: () => ({
        AndroidImportance: { DEFAULT: 3 },
        setNotificationChannelAsync: () => Promise.resolve(),
        scheduleNotificationAsync: (request: { identifier?: string; content: { title?: string } }) => {
            posted.push({ identifier: request.identifier, title: request.content.title });
            return Promise.resolve(request.identifier ?? 'generated');
        },
    }),
}));
// The harness is Node with no React Native. The module only reads the platform
// to pick a channel, so a stub with a platform is all it needs.
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));

const { noticeCopy, postNotice, shouldAnnounce } = await import('./announce');

const NOW = new Date('2026-09-08T20:00:00.000Z');

beforeEach(() => {
    posted.length = 0;
    store.clear();
});

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

describe('one card per morning', () => {
    /*
     * Seen on a phone on 2026-09-08. One simulated delay produced two
     * notifications, "your alarm moved" and "something about your journey",
     * which Android grouped under a row whose tap opened the app instead of the
     * morning. The move's sentence already carries the news.
     */
    it('posts under the morning, so a later card replaces an earlier one', async () => {
        await postNotice(wakeChanged('2026-09-10T05:31:00.000Z'), NOW);

        expect(posted[0]?.identifier).toBe('notice-occ');
    });

    it('keeps a notice quiet when the move it explains was just announced', async () => {
        await postNotice(wakeChanged('2026-09-10T05:31:00.000Z'), NOW);

        const shown = await postNotice(notice(), new Date(NOW.getTime() + 2 * 60_000));

        expect(shown).toBe(false);
        expect(posted).toHaveLength(1);
    });

    it('shows a notice on its own when nothing moved', async () => {
        // The user has not opted into being woken later: the time stays, and
        // the news is the only thing there is to say.
        expect(await postNotice(notice(), NOW)).toBe(true);
        expect(posted[0]?.title).toContain('notice.title_disruption');
    });

    it('shows a notice again once the move is old news', async () => {
        await postNotice(wakeChanged('2026-09-10T05:31:00.000Z'), NOW);

        const shown = await postNotice(notice(), new Date(NOW.getTime() + 11 * 60_000));

        expect(shown).toBe(true);
    });

    it('lets a move through after a notice, and it takes the same card', async () => {
        // Order is not guaranteed on the way in. Whichever arrives second wins
        // the card, and a move is always worth showing.
        await postNotice(notice(), NOW);
        await postNotice(wakeChanged('2026-09-10T05:31:00.000Z'), new Date(NOW.getTime() + 1000));

        expect(posted.map((request) => request.identifier)).toEqual(['notice-occ', 'notice-occ']);
    });
});
