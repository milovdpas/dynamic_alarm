import type { NextFunction, Request, Response } from 'express';
import { ERROR_CODES } from '@alarm/types';

import { env } from '../../config/app';
import { ApiError, sendError } from '../utils/ApiResponses';

/**
 * Turns anything thrown into one of the two response shapes.
 *
 * An `ApiError` carries its own code and status. Anything else is a bug, so it
 * becomes a 500 with a generic message: an unexpected error's text can contain
 * a query, a path or a key, and none of that belongs in a response. The detail
 * goes to the log instead, where it is useful and not public.
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

    if (error instanceof ApiError) {
        sendError(res, error.code, error.message, error.status, error.details);
        return;
    }

    console.error('Unhandled error:', error);
    sendError(
        res,
        ERROR_CODES.INTERNAL_ERROR,
        'Something went wrong.',
        500,
        // Stacks only outside production, where the audience is the developer
        // who caused it.
        env.isProduction() ? undefined : String(error),
    );
}
