import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';

import { ApiError } from '../utils/ApiResponses';

/**
 * Shared plumbing for controllers.
 *
 * Two jobs, both about not repeating error handling in every handler.
 */
export default abstract class Controller {
    /**
     * Wraps an async handler so a rejected promise reaches the error middleware.
     *
     * Express 5 forwards rejections automatically, but only for handlers it
     * recognises as returning a promise. Being explicit removes the question,
     * and an unhandled rejection here would hang the request rather than
     * answering it.
     */
    protected handle(
        fn: (req: Request, res: Response) => Promise<void>,
    ): RequestHandler {
        return (req: Request, res: Response, next: NextFunction) => {
            fn(req, res).catch(next);
        };
    }

    /**
     * Parses a request body against a schema, or throws a 422 describing why.
     *
     * Validation lives with the controller rather than the service because it
     * is about the shape of the request, not the rules of the domain. A service
     * called from the monitor loop should not be re-checking HTTP payloads.
     */
    protected parse<T>(schema: ZodType<T>, body: unknown): T {
        const result = schema.safeParse(body);
        if (!result.success) {
            throw ApiError.validation('Request body is not valid', result.error.issues);
        }
        return result.data;
    }
}
