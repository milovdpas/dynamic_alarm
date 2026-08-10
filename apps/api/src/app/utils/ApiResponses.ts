import type { Response } from 'express';
import { ERROR_CODES } from '@alarm/types';
import type { ApiFailure, ApiSuccess, ErrorCode } from '@alarm/types';

/**
 * The only two shapes any endpoint returns.
 *
 * Both are declared in `@alarm/types`, so the app's parsing and the API's
 * responses cannot drift: changing one fails to compile the other.
 */
export function sendSuccess<T>(res: Response, data: T, status = 200): void {
    const body: ApiSuccess<T> = { success: true, data };
    res.status(status).json(body);
}

export function sendError(
    res: Response,
    code: ErrorCode,
    message: string,
    status = 400,
    details?: unknown,
): void {
    const body: ApiFailure = { success: false, error: { code, message, details } };
    res.status(status).json(body);
}

/** Thrown by services; the error middleware turns it into a response. */
export class ApiError extends Error {
    constructor(
        readonly code: ErrorCode,
        message: string,
        readonly status = 400,
        readonly details?: unknown,
    ) {
        super(message);
        this.name = 'ApiError';
    }

    static notFound(what: string): ApiError {
        return new ApiError(ERROR_CODES.NOT_FOUND, `${what} not found`, 404);
    }

    static unauthorized(message = 'Missing or invalid device token'): ApiError {
        return new ApiError(ERROR_CODES.UNAUTHORIZED, message, 401);
    }

    static validation(message: string, details?: unknown): ApiError {
        return new ApiError(ERROR_CODES.VALIDATION_FAILED, message, 422, details);
    }
}
