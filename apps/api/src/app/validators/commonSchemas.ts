import { z } from 'zod';

/**
 * The `:id` every detail route carries.
 *
 * Worth checking rather than passing straight to a lookup. Without it a
 * malformed id costs a database round trip and comes back as "not found", which
 * sends the caller looking for a deleted record instead of at the id they built
 * wrong.
 */
export const idParamSchema = z.object({
    id: z.uuid(),
});
