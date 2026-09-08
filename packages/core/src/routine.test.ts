import { describe, expect, it } from 'vitest';

import { routineDurationMinutes } from './routine';

const routine = {
    steps: [
        { id: 'shower', label: 'Shower', minutes: 10, order: 0, enabled: true },
        { id: 'dressed', label: 'Get dressed', minutes: 8, order: 1, enabled: true },
        { id: 'breakfast', label: 'Breakfast', minutes: 15, order: 2, enabled: false },
    ],
};

describe('how long a routine takes', () => {
    it('adds the enabled steps and counts a disabled one as zero', () => {
        expect(routineDurationMinutes(routine)).toBe(18);
    });

    it('leaves out a step skipped for one morning', () => {
        // The calendar's "no shower on Thursday". The step itself is untouched;
        // only that morning is shorter, and the wake time moves later by it.
        expect(routineDurationMinutes(routine, ['shower'])).toBe(8);
    });

    it('does not double count a step that is both disabled and skipped', () => {
        expect(routineDurationMinutes(routine, ['breakfast'])).toBe(18);
    });

    it('ignores an id that is not a step', () => {
        // Validation refuses these upstream; here they must at least not throw
        // or subtract anything.
        expect(routineDurationMinutes(routine, ['nonsense'])).toBe(18);
    });
});
