import type { Routine, RoutineStep } from '@alarm/types';

/**
 * Total minutes of a routine, counting only enabled steps.
 *
 * Disabled steps stay in the list rather than being deleted, "I'll skip
 * breakfast today" is a toggle, not a reason to lose the step and have to
 * retype it tomorrow.
 */
/**
 * How long the routine takes, in the minutes the plan counts back from departure.
 *
 * Disabled steps stay in the list and count zero, which is how "not today" works
 * without losing the step. `skippedStepIds` is the same idea for one morning
 * rather than for the routine: a step somebody has ticked off for a particular
 * date, stored on that morning and gone with it. Both are measured here so a
 * tick, a refresh and a re-plan all agree on what the morning takes.
 */
export function routineDurationMinutes(
    routine: Pick<Routine, 'steps'>,
    skippedStepIds: readonly string[] = [],
): number {
    const skipped = new Set(skippedStepIds);
    return routine.steps.reduce(
        (total, step) => total + (step.enabled && !skipped.has(step.id) ? step.minutes : 0),
        0,
    );
}

/** Steps in display order, without mutating the input array. */
export function sortedSteps(steps: RoutineStep[]): RoutineStep[] {
    return [...steps].sort((a, b) => a.order - b.order);
}
