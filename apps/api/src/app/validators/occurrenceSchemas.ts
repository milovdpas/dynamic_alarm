import { z } from 'zod';

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
