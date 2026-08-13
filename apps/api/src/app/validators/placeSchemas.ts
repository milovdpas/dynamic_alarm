import { z } from 'zod';

/**
 * Coordinates, bounded to the Netherlands plus a margin.
 *
 * A latitude and longitude that pass a plain range check can still be in the
 * Atlantic, and the failure that produces is an NS call that finds nothing
 * followed by an alarm the app cannot explain. Rejecting it here names the
 * problem while the user can still see the field they typed it into.
 */
const lat = z.number().min(50.5).max(53.8);
const lng = z.number().min(3.2).max(7.3);

export const createPlaceSchema = z.object({
    label: z.string().trim().min(1).max(64),
    address: z.string().trim().max(255).optional(),
    lat,
    lng,
    nsStationCode: z.string().trim().min(1).max(8).optional(),
});

export const updatePlaceSchema = createPlaceSchema.partial();

export const autosuggestQuerySchema = z.object({
    /**
     * Three characters minimum, enforced on the server rather than trusted to
     * the client. This proxies the NS Places API, which draws on the same 300
     * requests per 5 minutes as journey planning, and an address field that
     * fires per keystroke would spend the whole deployment's budget on one
     * person typing their street name.
     */
    q: z.string().trim().min(3).max(100),
    limit: z.coerce.number().int().min(1).max(10).default(5),
});
