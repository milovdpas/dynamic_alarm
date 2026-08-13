import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodIssue, ZodType, infer as ZodInfer } from 'zod';

import { sendValidationFailed } from '../utils/ApiResponses';

declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            /**
             * Set by {@link validate}, read through {@link queryOf}.
             *
             * Express 5 made `req.query` a getter with no setter, so the parsed
             * result cannot be written back over the raw one the way a body can.
             * Assigning to it fails silently, which would leave a handler
             * reading unvalidated strings while looking as though it were not.
             */
            validatedQuery: unknown;
            /**
             * Set by {@link validate}, read through {@link paramsOf}.
             *
             * Kept separate for the same reason as the query, plus one of its
             * own: the router rewrites `req.params` for each layer it matches,
             * so anything written there would not survive to the handler.
             */
            validatedParams: unknown;
        }
    }
}

/** Which parts of a request a route validates. All optional, at least one used. */
export interface RequestSchemas {
    body?: ZodType;
    query?: ZodType;
    params?: ZodType;
}

/**
 * Validates any combination of body, query and path parameters in one pass.
 *
 * Declared in the route file next to the auth middleware, so a route states its
 * whole contract in one line: who may call it, what it accepts, and what
 * handles it. The handler then never runs on a request that failed, and cannot
 * forget to check.
 *
 * **Everything is checked before anything is answered.** Stopping at the first
 * failing part would report a bad id, then on the retry a bad body, and the
 * caller would learn about its second mistake only after fixing the first. The
 * issues are reported together, each path prefixed with where it came from, so
 * a `limit` in the query is never confused with a `limit` in the body.
 *
 * The body is replaced with the parsed value rather than merely inspected. Zod
 * returns it stripped of unknown keys and with defaults applied, so what the
 * handler reads is what was agreed rather than whatever was sent with the
 * agreed parts present. Query and params go to their own fields, because
 * Express will not let either be written back.
 *
 * A rejected request is answered here rather than thrown. It is an ordinary
 * outcome of an ordinary request, not a fault in the code, and middleware
 * already holds the response.
 */
export function validate(schemas: RequestSchemas): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
        const issues: ZodIssue[] = [];

        const body = check(schemas.body, req.body, 'body', issues);
        const query = check(schemas.query, req.query, 'query', issues);
        const params = check(schemas.params, req.params, 'params', issues);

        if (issues.length > 0) {
            sendValidationFailed(res, 'Request is not valid', issues);
            return;
        }

        if (schemas.body !== undefined) {
            req.body = body;
        }
        if (schemas.query !== undefined) {
            req.validatedQuery = query;
        }
        if (schemas.params !== undefined) {
            req.validatedParams = params;
        }

        next();
    };
}

/** Shorthand for the common case. */
export function validateBody<S extends ZodType>(schema: S): RequestHandler {
    return validate({ body: schema });
}

/** Shorthand for the common case. */
export function validateQuery<S extends ZodType>(schema: S): RequestHandler {
    return validate({ query: schema });
}

/**
 * Parses one part, collecting its issues under a prefixed path.
 *
 * Returns undefined when there is no schema for this part or when it failed;
 * the caller only reads the value once `issues` is known to be empty.
 */
function check(
    schema: ZodType | undefined,
    value: unknown,
    source: keyof RequestSchemas,
    issues: ZodIssue[],
): unknown {
    if (schema === undefined) {
        return undefined;
    }
    const result = schema.safeParse(value);
    if (!result.success) {
        issues.push(
            ...result.error.issues.map((issue) => ({
                ...issue,
                path: [source, ...issue.path],
            })),
        );
        return undefined;
    }
    return result.data;
}

/**
 * The validated query, typed by the schema its route validated with.
 *
 * The schema is passed only to carry the type, which is why it is unused at
 * runtime. That makes the handler name the same constant its route does, so the
 * two are linked by an identifier rather than by a cast onto an unrelated
 * shape. A body needs none of this, because `validate` writes back over
 * `req.body` and {@link Handler} types it directly.
 */
export function queryOf<S extends ZodType>(req: Request, _schema: S): ZodInfer<S> {
    return req.validatedQuery as ZodInfer<S>;
}

/** As {@link queryOf}, for path parameters. */
export function paramsOf<S extends ZodType>(req: Request, _schema: S): ZodInfer<S> {
    return req.validatedParams as ZodInfer<S>;
}

/** The body a route validated with this schema, for typing its handler. */
export type BodyOf<S extends ZodType> = ZodInfer<S>;
