import supertest from 'supertest';
import type { Response } from 'supertest';
import type { ApiErrorResponse } from '@alarm/types';

import { createApp } from '../../src/app';

/**
 * The real app, over an ephemeral port.
 *
 * Built once per test file rather than per test. It holds no request state, and
 * rebuilding it would re-run the route wiring hundreds of times to prove
 * nothing.
 */
const app = createApp();

/** Unauthenticated, for registration and for checking that auth is enforced. */
export const api = supertest(app);

/**
 * The same app with a device's bearer token attached.
 *
 * Worth the wrapper: every protected test would otherwise repeat the header,
 * and a forgotten one fails as a 401 that reads like a broken assertion rather
 * than a missing line.
 */
export function asDevice(token: string) {
    const auth = `Bearer ${token}`;
    return {
        get: (path: string): supertest.Test => api.get(path).set('authorization', auth),
        post: (path: string, body?: unknown): supertest.Test =>
            api.post(path).set('authorization', auth).send(body as object),
        patch: (path: string, body?: unknown): supertest.Test =>
            api.patch(path).set('authorization', auth).send(body as object),
        delete: (path: string): supertest.Test => api.delete(path).set('authorization', auth),
    };
}

/**
 * The body of a successful response, or a failure naming what came back.
 *
 * There is no envelope to unwrap: this exists for the error message. Without
 * it, an unexpected 422 surfaces as `Cannot read property 'id' of undefined`,
 * which says nothing about the validation issue that caused it.
 */
export function data<T>(response: Response): T {
    if (response.status >= 400) {
        const body = response.body as ApiErrorResponse;
        throw new Error(`Expected success, got ${response.status}: ${body.message}`);
    }
    return response.body as T;
}

/** The failure body, for asserting on refusals. */
export function error(response: Response): ApiErrorResponse {
    return response.body as ApiErrorResponse;
}
