import type { Response } from 'express';
import { ERROR_CODES } from '@alarm/types';
import type { ApiErrorResponse, ErrorCode } from '@alarm/types';

/**
 * How every response leaves this API.
 *
 * **A successful response is the resource, unwrapped.** The status code already
 * says whether it worked, so a `success` flag restated it and a `data` field
 * made every caller unwrap a level to reach anything. A failure is a flat
 * `{ code, message, details }` with a 4xx or 5xx, for the same reason.
 *
 * **Nothing here throws, and neither does anything that calls it.** A refused
 * request is an ordinary outcome, not an exception: a place that does not exist,
 * a payload that is wrong, a delete that something still depends on. Services
 * return those outcomes and controllers render them, so the path a request
 * takes is visible in the code rather than in whatever a `catch` somewhere else
 * decides to do with it.
 *
 * Exceptions are left for the cases where the code itself is wrong, plus
 * upstream failures such as an NS rate limit, where the alternative would be
 * threading a result type through three layers to model something that is
 * genuinely exceptional. Those reach `errorHandler` and become a 500 or a 429.
 */

/**
 * Sends the resource, against a response type that must be named.
 *
 * The type argument is deliberately impossible to infer. `sendSuccess(res, x)`
 * with an inferred `T` can never fail, because the argument is what defines the
 * expectation, so the check is circular and the compiler waves through any
 * shape at all. `NoInfer` blocks that inference and the `never` default makes
 * omitting the type a compile error, which leaves exactly one way to call this:
 *
 * ```ts
 * sendSuccess<PlaceResponse>(res, place.toDto());
 * ```
 *
 * Now the mapper's output has to satisfy what the endpoint promised, and the
 * app imports that same name to parse it. Renaming a field in `@alarm/types`
 * breaks the API and the app together, at build time, rather than becoming a
 * screen that renders `undefined`.
 */
export function sendSuccess<T = never>(res: Response, data: NoInfer<T>, status = 200): void {
    res.status(status).json(data);
}

export function sendError(
    res: Response,
    code: ErrorCode,
    message: string,
    status = 400,
    details?: unknown,
): void {
    const body: ApiErrorResponse = { code, message, details };
    res.status(status).json(body);
}

/**
 * Also the answer for another device's resource.
 *
 * A 403 would confirm the id exists to anyone holding any token. The device id
 * is part of the lookup rather than checked after it, so a real id and an
 * invented one are indistinguishable, which from this device's side they are.
 */
export function sendNotFound(res: Response, what: string): void {
    sendError(res, ERROR_CODES.NOT_FOUND, `${what} not found`, 404);
}

export function sendUnauthorized(res: Response): void {
    sendError(res, ERROR_CODES.UNAUTHORIZED, 'Missing or invalid device token', 401);
}

export function sendValidationFailed(res: Response, message: string, details?: unknown): void {
    sendError(res, ERROR_CODES.VALIDATION_FAILED, message, 422, details);
}

/**
 * Understood and refused, such as arming a schedule that is paused.
 *
 * Distinct from a 422: nothing about the payload is wrong, so telling the app
 * to fix its input would send it in circles.
 *
 * The `message` is for whoever is reading a log or a failing test. The app never
 * shows it: it renders from the code, in the language its owner chose.
 */
export function sendConflict(res: Response, message: string): void {
    sendError(res, ERROR_CODES.VALIDATION_FAILED, message, 409);
}

/**
 * Refused because something still depends on it.
 *
 * The names travel in `details` rather than inside a sentence. "Place is still
 * used by: Work mornings" told the user what to do next and could only ever say
 * it in English, so the names are data now and the wording belongs to the app.
 */
export function sendInUse(res: Response, what: string, blockedBy: string[]): void {
    sendError(
        res,
        ERROR_CODES.RESOURCE_IN_USE,
        `${what} is still used by: ${blockedBy.join(', ')}`,
        409,
        { blockedBy },
    );
}
