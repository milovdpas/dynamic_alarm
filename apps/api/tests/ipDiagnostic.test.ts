import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { API_ENDPOINTS } from '@alarm/types';
import type { IpDebugResponse } from '@alarm/types';

import { createApp } from '../src/app';

/**
 * The endpoint that exists to settle how many proxies to trust.
 *
 * These tests run with `TRUST_PROXY_HOPS` at its development default of zero,
 * so what they pin down is the shape of the answer and the one property that
 * must hold at that setting: a forwarded header sent by the caller changes
 * nothing about who the caller is taken to be. The number itself is not
 * knowable from here. That is the whole reason the route has to be deployed.
 *
 * Its own app rather than the shared one, because the route is behind a flag and
 * the shared app is built with whatever the environment says. Building both here
 * is also the only way to assert that the flag actually withholds it.
 */

let previous: string | undefined;
let api: supertest.Agent;

beforeAll(() => {
    previous = process.env.IP_DIAGNOSTIC;
    process.env.IP_DIAGNOSTIC = 'true';
    api = supertest(createApp());
});

afterAll(() => {
    if (previous === undefined) {
        delete process.env.IP_DIAGNOSTIC;
    } else {
        process.env.IP_DIAGNOSTIC = previous;
    }
});

async function ask(headers: Record<string, string> = {}): Promise<IpDebugResponse> {
    let request = api.get(API_ENDPOINTS.IP);
    for (const [name, value] of Object.entries(headers)) {
        request = request.set(name, value);
    }
    const response = await request;
    expect(response.status).toBe(200);
    return response.body as IpDebugResponse;
}

describe('whether it is served at all', () => {
    it('is absent unless the deployment asked for it', async () => {
        // "Temporary" enforced by something other than remembering. The route
        // hands the proxy chain and the request's headers to an unauthenticated
        // caller, so a deployment that never sets the flag never serves it.
        process.env.IP_DIAGNOSTIC = 'false';
        const withoutFlag = supertest(createApp());
        process.env.IP_DIAGNOSTIC = 'true';

        expect((await withoutFlag.get(API_ENDPOINTS.IP)).status).toBe(404);
    });

    it('is served when it is', async () => {
        expect((await api.get(API_ENDPOINTS.IP)).status).toBe(200);
    });

    it('stays off for a value the deploy never set', async () => {
        /*
         * The property the deployment template rests on. CI renders `.env` with
         * envsubst, and a repository variable nobody configured substitutes to
         * an empty string rather than disappearing, so the line reaches the
         * container as `IP_DIAGNOSTIC=`. Empty has to mean off, or forgetting to
         * set a variable would publish the endpoint.
         */
        for (const value of ['', '   ', 'yes', '1']) {
            process.env.IP_DIAGNOSTIC = value;
            const app = supertest(createApp());
            expect((await app.get(API_ENDPOINTS.IP)).status).toBe(404);
        }
        process.env.IP_DIAGNOSTIC = 'true';
    });
});

describe('what the API can tell about who is calling', () => {
    it('answers without a device token, because a phone testing this has none', async () => {
        const body = await ask();

        expect(body.resolvedIp).not.toBe('');
        expect(body.socket.address).not.toBeNull();
    });

    it('reports the socket separately from the resolved address', async () => {
        // These are the same thing only when nothing is in front. Telling them
        // apart in the response is what makes the difference visible when
        // something is.
        const body = await ask();

        expect(body.socket).toMatchObject({
            address: expect.any(String) as string,
            port: expect.any(Number) as number,
            private: true,
        });
        expect(body.rateLimitKey).toBe(body.resolvedIp);
    });

    it('says what it is configured to trust, and where that came from', async () => {
        const body = await ask();

        expect(body.trustProxy.configuredHops).toBe(0);
        expect(body.trustProxy.nodeEnv).toBe('test');
    });
});

describe('the forwarded chain, split so a position can be pointed at', () => {
    it('numbers each entry from both ends', async () => {
        const body = await ask({ 'x-forwarded-for': '203.0.113.7, 70.41.3.18, 10.0.0.5' });

        expect(body.forwarded.count).toBe(3);
        expect(body.forwarded.hops.map((hop) => [hop.index, hop.fromRight, hop.value])).toEqual([
            [0, 2, '203.0.113.7'],
            [1, 1, '70.41.3.18'],
            [2, 0, '10.0.0.5'],
        ]);
    });

    it('marks which entries could not be a phone on the internet', async () => {
        const body = await ask({ 'x-forwarded-for': '203.0.113.7, 10.0.0.5, 192.168.1.1' });

        expect(body.forwarded.hops.map((hop) => hop.private)).toEqual([false, true, true]);
    });

    it('keeps an entry that is not an address at all, and says so', async () => {
        // A caller may write anything into the left of the chain. Seeing it come
        // back is the clearest possible demonstration of why the left cannot be
        // trusted.
        const body = await ask({ 'x-forwarded-for': 'banana, 203.0.113.7' });

        expect(body.forwarded.hops[0]).toMatchObject({ value: 'banana', valid: false });
        expect(body.forwarded.hops[1]).toMatchObject({ value: '203.0.113.7', valid: true });
    });

    it('reduces an IPv4 address wearing an IPv6 costume', async () => {
        // Node hands back the mapped form on a dual-stack socket, and comparing
        // it raw against what a phone reports fails on notation alone.
        const body = await ask({ 'x-forwarded-for': '::ffff:203.0.113.7' });

        expect(body.forwarded.hops[0]?.normalised).toBe('203.0.113.7');
    });
});

describe('the table the hop count is read off', () => {
    it('lists what req.ip would be at each setting', async () => {
        const body = await ask({ 'x-forwarded-for': '203.0.113.7, 70.41.3.18' });

        // Socket first, then the chain right to left, which is the order
        // Express walks. `candidates[n]` is the answer at `trust proxy: n`.
        expect(body.chain).toEqual([body.socket.address, '70.41.3.18', '203.0.113.7']);
        expect(body.candidates.map((candidate) => candidate.hops)).toEqual([0, 1, 2]);
        expect(body.candidates[1]?.resolvedIp).toBe('70.41.3.18');
        expect(body.candidates[2]?.resolvedIp).toBe('203.0.113.7');
    });

    it('marks the setting in force, so the current answer is findable', async () => {
        const body = await ask({ 'x-forwarded-for': '203.0.113.7' });

        const current = body.candidates.filter((candidate) => candidate.current);
        expect(current).toHaveLength(1);
        expect(current[0]?.hops).toBe(0);
        expect(current[0]?.resolvedIp).toBe(body.resolvedIp);
    });
});

describe('trusting nothing means believing nothing', () => {
    it('ignores a forwarded header the caller invented', async () => {
        /*
         * The property the whole exercise is about. At zero hops a caller can
         * write whatever they like into `X-Forwarded-For` and it changes nothing
         * about the key they are limited under. If this ever fails after
         * `TRUST_PROXY_HOPS` is raised, the rate limits are bypassable by
         * anybody who can set a header.
         */
        const body = await ask({ 'x-forwarded-for': '1.2.3.4' });

        expect(body.resolvedIp).not.toBe('1.2.3.4');
        expect(body.rateLimitKey).not.toBe('1.2.3.4');
        expect(body.resolvedIp).toBe(body.socket.address);
        // Still reported, because seeing what was ignored is the point.
        expect(body.forwarded.raw).toBe('1.2.3.4');
    });

    it('leaves req.ips empty, because no hop is trusted', async () => {
        const body = await ask({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' });

        expect(body.forwarded.expressIps).toEqual([]);
    });
});

describe('what it refuses to hand back', () => {
    it('redacts the headers that carry a credential', async () => {
        const body = await ask({
            authorization: 'Bearer a-real-looking-token',
            cookie: 'session=secret',
            'x-monitor-token': 'the-monitor-secret',
        });

        expect(body.headers.authorization).toBe('[redacted]');
        expect(body.headers.cookie).toBe('[redacted]');
        expect(body.headers['x-monitor-token']).toBe('[redacted]');
        expect(JSON.stringify(body)).not.toContain('a-real-looking-token');
        expect(JSON.stringify(body)).not.toContain('the-monitor-secret');
    });

    it('still echoes the ordinary ones, which hold no secret from their sender', async () => {
        const body = await ask({ 'user-agent': 'dynamic-alarm-test' });

        expect(body.headers['user-agent']).toBe('dynamic-alarm-test');
    });
});

describe('reading the spoof test back in words', () => {
    it('says outright that the setting resisted an invented value', async () => {
        /*
         * The check that ends the exercise. Infrastructure appends addresses, so
         * an entry that is not one was written by the caller, and whether it is
         * what resolved answers the whole question in a single call.
         */
        const body = await ask({ 'x-forwarded-for': 'test' });

        expect(body.resolvedIp).not.toBe('test');
        expect(body.findings.join(' ')).toContain('not spoofable');
    });

    it('does not claim the question is unsettled because of a value nobody could route to', async () => {
        /*
         * `isPrivate('test')` is false, because it is not a private address; it
         * is not an address at all. Counting it as a second public entry made
         * the response say the count "cannot be settled from this response
         * alone" in exactly the response that settled it.
         */
        const body = await ask({ 'x-forwarded-for': 'test' });

        expect(body.findings.join(' ')).not.toContain('cannot be settled');
    });

    it('marks which chain entries are addresses at all', async () => {
        // Two entries here, not the three production shows: nothing in front of
        // this server appends, so the chain is the socket plus what was sent.
        const body = await ask({ 'x-forwarded-for': 'test' });

        expect(body.candidates.map((candidate) => candidate.valid)).toEqual([true, false]);
        expect(body.candidates.at(-1)).toMatchObject({ resolvedIp: 'test', valid: false });
    });

    it('still warns when two real public addresses leave it ambiguous', async () => {
        // Both plausible, neither obviously the caller's. That genuinely cannot
        // be resolved without knowing the phone's own address.
        const body = await ask({ 'x-forwarded-for': '203.0.113.7, 198.51.100.9' });

        expect(body.findings.join(' ')).toContain('cannot be settled');
    });
});

describe('the sentences, so the JSON does not have to be interpreted', () => {
    it('explains what the current setting resolves to', async () => {
        const body = await ask({ 'x-forwarded-for': '203.0.113.7' });

        expect(body.findings.length).toBeGreaterThan(0);
        expect(body.findings.join(' ')).toContain('X-Forwarded-For');
    });

    it('names the chain length when one arrived', async () => {
        const body = await ask({ 'x-forwarded-for': '203.0.113.7, 70.41.3.18' });

        expect(body.findings.join(' ')).toContain('2 entries');
    });

    it('says so when no forwarded header arrived at all', async () => {
        const body = await ask();

        expect(body.findings.join(' ')).toContain('No X-Forwarded-For header');
    });
});
