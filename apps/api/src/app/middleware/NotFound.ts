import type { Request, Response } from 'express';
import { ERROR_CODES } from '@alarm/types';

import { sendError } from '../utils/ApiResponses';

/** Unmatched routes answer in the same shape as everything else. */
export function notFound(req: Request, res: Response): void {
    sendError(res, ERROR_CODES.NOT_FOUND, `No route for ${req.method} ${req.path}`, 404);
}
