import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { API_ENDPOINTS, ERROR_CODES } from '@alarm/types';
import type { HealthResponse } from '@alarm/types';

import Device from '../src/app/models/Device.entity';
import { PlaceService } from '../src/app/services/PlaceService';
import { api, asDevice, error } from './support/client';
import { seedDevice } from './support/factories';

/**
 * The limits that stand between one caller and everybody else's alarms.
 *
 * NS allows 300 requests per 5 minutes across every user of this deployment, and
 * the app's whole design is arranged around spending roughly 35 of them per
 * occurrence per night. None of that arithmetic survives one caller in a loop,
 * and until these existed nothing stopped one: autosuggest sat behind
 * `deviceAuth`, which is a real protection right up until you notice that
 * registration hands a token to anyone who asks.
 */

afterEach(() => {
    vi.restoreAllMocks();
});

function register() {
    return api.post(API_ENDPOINTS.DEVICES.REGISTER).send({
        platform: 'android',
        timezone: 'Europe/Amsterdam',
        appVersion: '1.0.0',
    });
}

describe('the door in', () => {
    it('lets an ordinary install through', async () => {
        expect((await register()).status).toBe(201);
    });

    it('stops one address minting tokens without end', async () => {
        // Twenty an hour is far above a real phone, which registers once per
        // install, and far below useful to anyone farming credentials in order
        // to spend the shared NS budget through them.
        for (let attempt = 0; attempt < 20; attempt += 1) {
            await register();
        }

        const refused = await register();

        expect(refused.status).toBe(429);
        expect(error(refused).code).toBe(ERROR_CODES.RATE_LIMITED);
        // Says when, rather than leaving a client to guess and retry into the
        // same wall.
        expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
        expect(await Device.count()).toBe(20);
    });
});

describe('spending the shared provider budget', () => {
    /*
     * Autosuggest is the route being limited, and NS is what it would otherwise
     * spend. Stubbed rather than called: the assertion is about the ceiling, and
     * a suite that spent sixty real requests to prove a limit exists would be
     * the very behaviour the limit is there to stop.
     */
    beforeEach(() => {
        vi.spyOn(PlaceService.prototype, 'autosuggest').mockResolvedValue([]);
    });

    it('stops one device draining what every device draws on', async () => {
        const { token } = await seedDevice();
        const client = asDevice(token);
        const path = `${API_ENDPOINTS.PLACES.AUTOSUGGEST}?q=utr`;

        // Sixty in five minutes is a fifth of the ceiling for one phone, which
        // leaves room for the monitor loop and for everybody else. Real use is
        // nowhere near it: the client debounces and the schema wants three
        // characters before it asks anything at all.
        let refused: Awaited<ReturnType<typeof client.get>> | null = null;
        for (let attempt = 0; attempt < 61; attempt += 1) {
            const response = await client.get(path);
            if (response.status === 429) {
                refused = response;
                break;
            }
        }

        expect(refused).not.toBeNull();
        expect(error(refused as never).code).toBe(ERROR_CODES.RATE_LIMITED);
    });

    it('counts each device separately, so one noisy phone is not everyone', async () => {
        const noisy = asDevice((await seedDevice()).token);
        const quiet = asDevice((await seedDevice()).token);
        const path = `${API_ENDPOINTS.PLACES.AUTOSUGGEST}?q=utr`;

        for (let attempt = 0; attempt < 61; attempt += 1) {
            await noisy.get(path);
        }

        // Not 429. A ceiling that punished the wrong phone would be worse than
        // none, because the phone it punished has an alarm to arm.
        expect((await quiet.get(path)).status).not.toBe(429);
    });

    it('leaves reads that cost no provider call alone', async () => {
        const client = asDevice((await seedDevice()).token);

        for (let attempt = 0; attempt < 70; attempt += 1) {
            const response = await client.get(API_ENDPOINTS.PLACES.LIST);
            expect(response.status).toBe(200);
        }
    });
});

describe('what every response says about itself', () => {
    it('does not announce the framework', async () => {
        const response = await api.get(API_ENDPOINTS.HEALTH);

        expect(response.headers['x-powered-by']).toBeUndefined();
    });

    it('refuses to have its body re-read as something executable', async () => {
        const response = await api.get(API_ENDPOINTS.HEALTH);

        expect(response.headers['x-content-type-options']).toBe('nosniff');
        // Paths here carry occurrence and schedule ids, and a referrer header
        // puts them in the logs of wherever a link happens to lead.
        expect(response.headers['referrer-policy']).toBe('no-referrer');
    });
});

describe('health', () => {
    it('answers by asking the database, not by remembering that it once could', async () => {
        const response = await api.get(API_ENDPOINTS.HEALTH);

        expect(response.status).toBe(200);
        const body = response.body as HealthResponse;
        expect(body.status).toBe('ok');
        expect(body.database).toBe(true);
    });

    it('is reachable without a device token, because a probe has none', async () => {
        expect((await api.get(API_ENDPOINTS.HEALTH)).status).toBe(200);
    });
});
