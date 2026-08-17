import { z } from 'zod';
import { SimulationKind } from '@alarm/types';

/**
 * What the device says it actually armed.
 *
 * The time is required rather than inferred from the occurrence, because "I
 * armed something" and "I armed 06:58" are different claims. Only the second
 * lets the server tell a delivered push from a dropped one, which is the entire
 * reason this endpoint exists.
 */
export const ackOccurrenceSchema = z.object({
    ackedWakeAt: z.iso.datetime({ offset: true }),
});

/**
 * A staged pretend disruption, or null to clear one.
 *
 * `minutes` is bounded rather than free. A simulated delay is meant to move an
 * alarm and be watched; four hours of it just makes the journey infeasible,
 * which is a different test with a different name.
 */
export const simulateOccurrenceSchema = z.object({
    kind: z.nativeEnum(SimulationKind).nullable(),
    minutes: z.number().int().min(1).max(180).optional(),
});
