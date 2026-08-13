import type { RequestHandler } from 'express';

/**
 * Path parameters for a route ending in `/:id`.
 *
 * The index signature is what lets middleware typed against Express default
 * params sit in the same chain. The declared `id` then wins over it, so
 * `req.params.id` is a `string` rather than the `string | undefined` that
 * `noUncheckedIndexedAccess` gives every other key.
 *
 * The route has to name it: `router.get<IdParams>(...)`. Express infers params
 * from a literal path, and ours come from `API_ENDPOINTS`, which is typed as a
 * plain string. Saying it at the route is the right place anyway, since that is
 * where the `:id` is written.
 */
export interface IdParams {
    [key: string]: string;
    id: string;
}

/**
 * A route handler, typed against what its own route guarantees.
 *
 * There is no wrapper around handlers. Express 5 forwards a rejected promise to
 * the error middleware by itself, `deviceAuth` guarantees `req.device`, and
 * `validateBody` guarantees the body, so a handler is the handler and nothing
 * else. What is left is naming those guarantees for the compiler.
 *
 * ```ts
 * list:   Handler                                              = ...
 * detail: Handler<unknown, IdParams>                           = ...
 * create: Handler<BodyOf<typeof createPlaceSchema>>            = ...
 * update: Handler<BodyOf<typeof updatePlaceSchema>, IdParams>  = ...
 * ```
 *
 * Naming the params explicitly is what makes `req.params.id` a `string`. Left
 * as Express's default index signature it is `string | undefined`, because
 * `noUncheckedIndexedAccess` is on, and every handler would need a check for a
 * value the route pattern already promises.
 */
export type Handler<Body = unknown, Params = Record<string, string>> = RequestHandler<
    Params,
    unknown,
    Body
>;
