import { describe, expect, it } from 'vitest';
import { API_ENDPOINTS } from '@alarm/types';
import type { ListPlacesResponse, PlaceResponse } from '@alarm/types';

import Place from '../src/app/models/Place.entity';
import { api, asDevice, data, error } from './support/client';
import {
    AMSTERDAM_ZUID,
    UTRECHT,
    seedCommute,
    seedDevice,
    seedPlace,
    seedSchedule,
} from './support/factories';

describe('creating places', () => {
    it('reads coordinates back as numbers', async () => {
        const { token } = await seedDevice();

        const response = await asDevice(token).post(API_ENDPOINTS.PLACES.CREATE, {
            label: 'Home',
            address: 'Utrecht',
            ...UTRECHT,
        });

        expect(response.status).toBe(201);
        const place = data<PlaceResponse>(response);
        // MySQL returns DECIMAL as a string, and a latitude arriving as
        // "52.090700" survives arithmetic as string concatenation and reaches
        // NS as nonsense. The column transformer is what stops that.
        expect(place.lat).toBeTypeOf('number');
        expect(place.lat).toBe(UTRECHT.lat);
        expect(place.lng).toBe(UTRECHT.lng);
    });

    it('omits a missing address rather than returning null', async () => {
        const { token } = await seedDevice();

        const response = await asDevice(token).post(API_ENDPOINTS.PLACES.CREATE, {
            label: 'Home',
            ...UTRECHT,
        });

        // The column is nullable but the wire type says optional. An explicit
        // null would be a third case the app has to handle for no reason.
        expect(data<PlaceResponse>(response).address).toBeUndefined();
    });

    it('rejects coordinates outside the Netherlands', async () => {
        const { token } = await seedDevice();

        const response = await asDevice(token).post(API_ENDPOINTS.PLACES.CREATE, {
            label: 'Somewhere in the Atlantic',
            lat: 40.7,
            lng: -74,
        });

        // These pass a plain range check. Left alone they become an NS call
        // that finds nothing, and an alarm the app cannot explain.
        expect(response.status).toBe(422);
    });
});

describe('place ownership', () => {
    it('lists only this device places', async () => {
        const { token: mine } = await seedDevice();
        const { device: other } = await seedDevice();
        await seedPlace(other, { label: 'Their home' });

        const response = await asDevice(mine).get(API_ENDPOINTS.PLACES.LIST);

        expect(data<ListPlacesResponse>(response)).toHaveLength(0);
    });

    it('answers 404, not 403, for another device place', async () => {
        const { device: owner } = await seedDevice();
        const theirs = await seedPlace(owner);
        const { token: intruder } = await seedDevice();

        const response = await asDevice(intruder).get(API_ENDPOINTS.PLACES.DETAIL(theirs.id));

        // 403 would confirm the id exists. The device id is part of the lookup
        // rather than checked after it, so a real id and an invented one are
        // indistinguishable, which is the truth from this device's side.
        expect(response.status).toBe(404);
    });

    it('will not let another device update a place', async () => {
        const { device: owner } = await seedDevice();
        const theirs = await seedPlace(owner, { label: 'Home' });
        const { token: intruder } = await seedDevice();

        const response = await asDevice(intruder).patch(API_ENDPOINTS.PLACES.DETAIL(theirs.id), {
            label: 'Hacked',
        });

        expect(response.status).toBe(404);
        expect((await Place.findOneBy({ id: theirs.id }))?.label).toBe('Home');
    });
});

describe('updating and deleting places', () => {
    it('leaves coordinates alone when only the label is sent', async () => {
        const { device, token } = await seedDevice();
        const place = await seedPlace(device);

        const response = await asDevice(token).patch(API_ENDPOINTS.PLACES.DETAIL(place.id), {
            label: 'Home (new flat)',
        });

        const updated = data<PlaceResponse>(response);
        expect(updated.label).toBe('Home (new flat)');
        expect(updated.lat).toBe(UTRECHT.lat);
    });

    it('deletes a place nothing points at', async () => {
        const { device, token } = await seedDevice();
        const place = await seedPlace(device);

        const response = await asDevice(token).delete(API_ENDPOINTS.PLACES.DETAIL(place.id));

        expect(response.status).toBe(204);
        expect(await Place.findOneBy({ id: place.id })).toBeNull();
    });

    it('refuses with 409 while a schedule still uses it, naming the schedule', async () => {
        const { token, home, work, routine, device } = await seedCommute();
        await seedSchedule(device, { origin: home, destination: work, routine }, {
            name: 'Work mornings',
        });

        const response = await asDevice(token).delete(API_ENDPOINTS.PLACES.DETAIL(home.id));

        // The foreign key would refuse this anyway, but as a driver error it
        // reaches the user as "something went wrong" rather than as a sentence
        // they can act on.
        expect(response.status).toBe(409);
        expect(error(response).message).toContain('Work mornings');
        expect(await Place.findOneBy({ id: home.id })).not.toBeNull();
    });

    it('refuses when the place is only the destination', async () => {
        const { token, home, work, routine, device } = await seedCommute();
        await seedSchedule(device, { origin: home, destination: work, routine });

        const response = await asDevice(token).delete(API_ENDPOINTS.PLACES.DETAIL(work.id));

        expect(response.status).toBe(409);
    });
});

describe('autosuggest', () => {
    it('rejects a query shorter than three characters', async () => {
        const { token } = await seedDevice();

        const response = await asDevice(token).get(`${API_ENDPOINTS.PLACES.AUTOSUGGEST}?q=ut`);

        // Enforced server-side rather than trusted to the client. This proxies
        // an NS endpoint on a 300-per-5-minutes budget shared by every user, and
        // it is the one route a phone can fire per keystroke.
        expect(response.status).toBe(422);
    });

    it('requires authentication', async () => {
        const response = await api.get(`${API_ENDPOINTS.PLACES.AUTOSUGGEST}?q=Utrecht`);

        // An open proxy to a key with a shared ceiling is a way for anyone to
        // switch off journey planning for every user.
        expect(response.status).toBe(401);
    });

    it('matches the literal path before the :id route', async () => {
        const { device, token } = await seedDevice();
        await seedPlace(device, { label: 'Work', ...AMSTERDAM_ZUID });

        const response = await asDevice(token).get(`${API_ENDPOINTS.PLACES.AUTOSUGGEST}?q=ut`);

        // Express matches in order. Were the routes the other way round,
        // "autosuggest" would be read as a place id and answered with a 404
        // that looks like a missing place rather than a routing mistake.
        expect(response.status).toBe(422);
    });
});
