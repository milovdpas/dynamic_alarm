import type { NextFunction, Request, Response } from 'express';
import { ERROR_CODES } from '@alarm/types';

import { env } from '../../config/app';
import { NsRateLimitError } from '../modules/NsModule';
import { sendError } from '../utils/ApiResponses';

/**
 * The last resort, and deliberately not the usual path.
 *
 * Refusals are answered where they happen: middleware writes its own 401 and
 * 422, and services return outcomes that controllers render. What reaches here
 * is either a fault in the code or an upstream that failed, so there is nothing
 * useful to tell the caller beyond the fact that it did.
 *
 * The message is generic on purpose. An unexpected error's text can carry a
 * query, a path or a key, and none of that belongs in a response. The detail
 * goes to the log, where it is useful and not public.
 */
export function errorHandler(
    error: unknown,
    _req: Request,
    res: Response,
    next: NextFunction,
): void {
    if (res.headersSent) {
        next(error);
        return;
    }

    // Surfaced rather than folded into a 500, and logged loudly. Hitting the NS
    // ceiling means the deployment is spending more than it may, the budget is
    // shared across every user, and no amount of client retrying fixes it.
    //
    // Thrown rather than returned, unlike every other refusal in the app: it
    // originates three layers down in an HTTP module, and threading a result
    // type up through the service and controller to model a rare upstream
    // failure would cost more than it explains.
    if (error instanceof NsRateLimitError) {
        console.error('NS rate limit reached:', error.message);
        res.setHeader('Retry-After', String(error.retryAfterSeconds));
        sendError(
            res,
            ERROR_CODES.TRANSPORT_RATE_LIMITED,
            'Travel information is temporarily unavailable.',
            429,
        );
        return;
    }

    console.error('Unhandled error:', error);
    sendError(
        res,
        ERROR_CODES.INTERNAL_ERROR,
        'Something went wrong.',
        500,
        // Detail only outside production, where the audience is the developer
        // who caused it.
        env.isProduction() ? undefined : String(error),
    );
}
