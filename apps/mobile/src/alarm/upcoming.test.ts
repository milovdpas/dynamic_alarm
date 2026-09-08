import { describe, expect, it } from 'vitest';

import { upcomingOnly } from './upcoming';

const NOW = new Date('2026-09-07T05:00:00.000Z');

function at(iso: string) {
    return { id: iso, currentWakeAt: iso };
}

describe('which mornings are still to come', () => {
    it('drops a morning whose wake time has passed', () => {
        /*
         * The bug in one line. A rung morning stayed listed as armed, so the app
         * never planned the next one and tried to arm a time in the past, which
         * Android refused and the screen blamed on the device.
         */
        const kept = upcomingOnly([at('2026-09-06T05:43:00.000Z')], NOW);

        expect(kept).toEqual([]);
    });

    it('keeps a morning that is still ahead', () => {
        const kept = upcomingOnly([at('2026-09-08T05:43:00.000Z')], NOW);

        expect(kept.map((each) => each.id)).toEqual(['2026-09-08T05:43:00.000Z']);
    });

    it('treats this very second as already rung', () => {
        // The scheduler refuses a time that is not strictly in the future, so
        // keeping it would fail the same way, one second later.
        expect(upcomingOnly([at('2026-09-07T05:00:00.000Z')], NOW)).toEqual([]);
    });

    it('keeps order and drops only what has passed', () => {
        const kept = upcomingOnly(
            [
                at('2026-09-06T05:43:00.000Z'),
                at('2026-09-08T05:43:00.000Z'),
                at('2026-09-09T05:43:00.000Z'),
            ],
            NOW,
        );

        expect(kept.map((each) => each.id)).toEqual([
            '2026-09-08T05:43:00.000Z',
            '2026-09-09T05:43:00.000Z',
        ]);
    });
});
