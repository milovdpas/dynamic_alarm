import type { Routine, RoutineStep } from '@alarm/types';

/**
 * Total minutes of a routine, counting only enabled steps.
 *
 * Disabled steps stay in the list rather than being deleted, "I'll skip
 * breakfast today" is a toggle, not a reason to lose the step and have to
 * retype it tomorrow.
 */
export function routineDurationMinutes(routine: Pick<Routine, 'steps'>): number {
    return routine.steps.reduce((total, step) => total + (step.enabled ? step.minutes : 0), 0);
}

/** Steps in display order, without mutating the input array. */
export function sortedSteps(steps: RoutineStep[]): RoutineStep[] {
    return [...steps].sort((a, b) => a.order - b.order);
}
