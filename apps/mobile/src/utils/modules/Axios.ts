import axios, { type AxiosRequestConfig } from 'axios';

import appConfig from '@/config';
import { loadOptionalModule } from './optionalModule';

const DEVICE_TOKEN_KEY = 'deviceToken';

type SecureStoreModule = typeof import('expo-secure-store');

let secureStore: SecureStoreModule | null | undefined;

/**
 * Loaded lazily, like every other native module here, see CONVENTIONS.md.
 *
 * Unlike theme and language, a missing secure store gets **no memory fallback**.
 * A device token that silently evaporates would re-register the device on every
 * launch and quietly orphan its schedules; failing the call is the honest
 * outcome.
 */
function getSecureStore(): SecureStoreModule | null {
    if (secureStore === undefined) {
        secureStore = loadOptionalModule(() => require('expo-secure-store') as SecureStoreModule);
    }
    return secureStore;
}

/**
 * Thin HTTP wrapper for the alarm API.
 *
 * The device token is read per request rather than cached in memory, so a
 * freshly registered device starts authenticating immediately without needing a
 * reload, registration and first authenticated call happen seconds apart
 * during onboarding.
 */
export default class Axios {
    static async getToken(): Promise<string | null> {
        try {
            return (await getSecureStore()?.getItemAsync(DEVICE_TOKEN_KEY)) ?? null;
        } catch {
            return null;
        }
    }

    static async setToken(token: string): Promise<void> {
        const store = getSecureStore();
        if (store === null) {
            throw new Error('Secure storage is unavailable. Rebuild the development client.');
        }
        await store.setItemAsync(DEVICE_TOKEN_KEY, token);
    }

    static async clearToken(): Promise<void> {
        await getSecureStore()?.deleteItemAsync(DEVICE_TOKEN_KEY);
    }

    private static async config(): Promise<AxiosRequestConfig> {
        const token = await Axios.getToken();
        return {
            baseURL: appConfig.apiUrl,
            timeout: 15000,
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        };
    }

    static async get<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
        const response = await axios.get<T>(endpoint, { ...(await Axios.config()), params });
        return response.data;
    }

    static async post<T>(endpoint: string, data?: unknown): Promise<T> {
        const response = await axios.post<T>(endpoint, data, await Axios.config());
        return response.data;
    }

    static async patch<T>(endpoint: string, data?: unknown): Promise<T> {
        const response = await axios.patch<T>(endpoint, data, await Axios.config());
        return response.data;
    }

    static async delete<T>(endpoint: string): Promise<T> {
        const response = await axios.delete<T>(endpoint, await Axios.config());
        return response.data;
    }
}
