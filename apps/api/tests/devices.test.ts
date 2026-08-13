import { describe, expect, it } from 'vitest';
import { API_ENDPOINTS } from '@alarm/types';
import type { DeviceResponse, RegisterDeviceResponse } from '@alarm/types';

import Device from '../src/app/models/Device.entity';
import { api, asDevice, data } from './support/client';
import { seedDevice } from './support/factories';

describe('device registration', () => {
    it('returns a token and stores only its hash', async () => {
        const response = await api.post(API_ENDPOINTS.DEVICES.REGISTER).send({
            platform: 'android',
            timezone: 'Europe/Amsterdam',
            appVersion: '1.0.0',
        });

        expect(response.status).toBe(201);
        const body = data<RegisterDeviceResponse>(response);
        expect(body.token).toEqual(expect.any(String));

        // The point of hashing: a database dump must not hand over the ability
        // to impersonate every device and read where its owner lives.
        const stored = await Device.findOneBy({ id: body.deviceId });
        expect(stored?.tokenHash).not.toBe(body.token);
        expect(stored?.tokenHash).not.toContain(body.token);
    });

    it('rejects a platform it does not support', async () => {
        const response = await api.post(API_ENDPOINTS.DEVICES.REGISTER).send({
            platform: 'windows-phone',
            timezone: 'Europe/Amsterdam',
            appVersion: '1.0.0',
        });

        expect(response.status).toBe(422);
    });
});

describe('device authentication', () => {
    it('refuses a request with no authorization header', async () => {
        const response = await api.get(API_ENDPOINTS.PLACES.LIST);
        expect(response.status).toBe(401);
    });

    it('refuses a token that does not resolve to a device', async () => {
        const response = await asDevice('not-a-real-token').get(API_ENDPOINTS.PLACES.LIST);
        expect(response.status).toBe(401);
    });

    it('refuses a token in the wrong scheme', async () => {
        const { token } = await seedDevice();
        const response = await api
            .get(API_ENDPOINTS.PLACES.LIST)
            .set('authorization', `Token ${token}`);

        expect(response.status).toBe(401);
    });
});

describe('device update', () => {
    it('clears the push token when null is sent', async () => {
        const { device, token } = await seedDevice({ pushToken: 'ExponentPushToken[abc]' });

        const response = await asDevice(token).patch(API_ENDPOINTS.DEVICES.UPDATE(device.id), {
            pushToken: null,
        });

        expect(response.status).toBe(200);
        // Null and omitted mean different things here. Null is "notification
        // permission was revoked", and collapsing the two would leave the server
        // pushing at a token the device no longer has.
        expect(data<DeviceResponse>(response).hasPushToken).toBe(false);
        expect((await Device.findOneBy({ id: device.id }))?.pushToken).toBeNull();
    });

    it('leaves the push token alone when it is omitted', async () => {
        const { device, token } = await seedDevice({ pushToken: 'ExponentPushToken[abc]' });

        const response = await asDevice(token).patch(API_ENDPOINTS.DEVICES.UPDATE(device.id), {
            appVersion: '1.0.1',
        });

        expect(data<DeviceResponse>(response).hasPushToken).toBe(true);
    });

    it('never returns the token itself', async () => {
        const { device, token } = await seedDevice({ pushToken: 'ExponentPushToken[abc]' });

        const response = await asDevice(token).patch(API_ENDPOINTS.DEVICES.UPDATE(device.id), {
            timezone: 'Europe/Amsterdam',
        });

        expect(JSON.stringify(response.body)).not.toContain('ExponentPushToken');
    });
});
