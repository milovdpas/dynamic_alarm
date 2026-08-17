import axios, { isAxiosError, type AxiosRequestConfig } from 'axios';
import { Platform } from 'react-native';
import { API_ENDPOINTS, APP_CONSTANTS, DevicePlatform } from '@alarm/types';
import type { ApiErrorResponse, RegisterDeviceResponse } from '@alarm/types';

import appConfig from '@/config';
import { loadOptionalModule } from './optionalModule';

const DEVICE_TOKEN_KEY = 'deviceToken';

/**
 * Failures the client raises itself, which the server has no code for.
 *
 * They live alongside the server's `ERROR_CODES` and are read the same way, so
 * a screen branches on one set of codes rather than on a mix of codes and
 * exception types.
 */
export const CLIENT_ERROR_CODES = {
    /** No API address configured, and none could be inferred. See config.ts. */
    API_URL_MISSING: 'API_URL_MISSING',
    /** The request never reached a server: wrong host, wifi off, API not running. */
    NETWORK_UNREACHABLE: 'NETWORK_UNREACHABLE',
    /**
     * The server was reached but did not answer in time.
     *
     * Kept apart from `NETWORK_UNREACHABLE` because the two need opposite
     * advice, and because they mean different things for an alarm: a request
     * that timed out may well have succeeded on the server, so telling someone
     * nothing happened would be a guess.
     */
    REQUEST_TIMED_OUT: 'REQUEST_TIMED_OUT',
    /**
     * Something threw that was not an HTTP failure at all.
     *
     * Everything unrecognised used to be reported as `NETWORK_UNREACHABLE`,
     * which meant a bug in this app told the user to check their wifi. That
     * sent a real morning's debugging at the router and the server, both of
     * which were fine. An error we cannot classify is worth saying plainly:
     * the alternative is confident advice about the wrong thing.
     */
    UNEXPECTED_FAILURE: 'UNEXPECTED_FAILURE',
} as const;

/**
 * Any failed request, server or network, as one thing to catch.
 *
 * `code` is what the UI branches on and what it translates. **`message` is not
 * for the user.** It comes from the server in English and exists for a log or a
 * bug report; user-facing copy lives in `i18n/translations/` and is chosen by
 * `code`, like every other string in this app.
 */
export class ApiRequestError extends Error {
    constructor(
        readonly code: string,
        /** Null when the request never reached a server. */
        readonly status: number | null,
        message: string,
        readonly details?: unknown,
    ) {
        super(message);
        this.name = 'ApiRequestError';
    }

    /** Narrows anything thrown by axios into the shape above. */
    static from(error: unknown): ApiRequestError {
        if (error instanceof ApiRequestError) {
            return error;
        }
        if (isAxiosError(error)) {
            const body = error.response?.data as ApiErrorResponse | undefined;
            if (error.response === undefined || body === undefined) {
                // A timeout also arrives with no response, and lumping the two
                // together produced the app's most misleading message: a request
                // the server was still working on, reported as "nothing answered
                // at that address, check your wifi".
                const timedOut =
                    error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT';
                return new ApiRequestError(
                    timedOut
                        ? CLIENT_ERROR_CODES.REQUEST_TIMED_OUT
                        : CLIENT_ERROR_CODES.NETWORK_UNREACHABLE,
                    null,
                    error.message,
                );
            }
            return new ApiRequestError(
                body.code,
                error.response.status,
                body.message,
                body.details,
            );
        }
        return new ApiRequestError(
            CLIENT_ERROR_CODES.UNEXPECTED_FAILURE,
            null,
            error instanceof Error ? error.message : String(error),
        );
    }
}

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

    /**
     * The device token, registering this device first if it has none.
     *
     * Every screen fetches on mount, and registration used to be a separate
     * thing the launch happened to start first. On a fresh install those raced:
     * the first screens sent their requests with no token, got a 401 each, and
     * showed "this device is no longer recognised" on an app that had simply not
     * finished introducing itself. Clearing the app's data reproduced it every
     * time.
     *
     * Doing it here means no authenticated request can go out before there is
     * something to authenticate with, whichever screen asks first.
     *
     * Concurrent callers share one attempt. Half a dozen requests on launch
     * would otherwise create half a dozen devices, and the user would keep the
     * last one to finish writing its token.
     */
    static async ensureToken(): Promise<string | null> {
        const existing = await Axios.getToken();
        if (existing !== null) {
            return existing;
        }

        Axios.registering ??= Axios.register().finally(() => {
            Axios.registering = null;
        });
        return Axios.registering;
    }

    /**
     * Registers this device, with a bare request rather than the usual client.
     *
     * `Axios.post` would call `config()`, which calls this, so it goes direct.
     * Nothing is lost: registration is the one call that cannot be
     * authenticated, so it needs none of what the wrapper adds.
     *
     * Returns null rather than throwing when the API cannot be reached. The
     * caller is a request that is about to fail anyway, and it will fail with
     * its own error rather than one about registration.
     */
    private static async register(): Promise<string | null> {
        try {
            const response = await axios.post<RegisterDeviceResponse>(
                `${appConfig.apiUrl ?? ''}${API_ENDPOINTS.DEVICES.REGISTER}`,
                {
                    platform: Platform.OS === 'ios' ? DevicePlatform.IOS : DevicePlatform.ANDROID,
                    timezone: APP_CONSTANTS.TIMEZONE,
                    appVersion: appConfig.appVersion,
                },
                { timeout: 15000 },
            );
            await Axios.setToken(response.data.token);
            return response.data.token;
        } catch {
            return null;
        }
    }

    static async clearToken(): Promise<void> {
        await getSecureStore()?.deleteItemAsync(DEVICE_TOKEN_KEY);
    }

    /**
     * Throws away a token the server has just rejected, and only that one.
     *
     * The comparison is the point. Several screens fetch at once, so a token the
     * API no longer knows produces a burst of 401s together. Clearing
     * unconditionally would let the second one delete the token the first had
     * already replaced it with, and the app would register a new device per
     * screen until one of them happened to finish last.
     */
    private static async discardRejectedToken(rejected: string): Promise<void> {
        if ((await Axios.getToken()) !== rejected) {
            return;
        }
        try {
            await Axios.clearToken();
        } catch {
            // Nothing else to try. The retry below will see the same token and
            // give up, which is the same outcome as before this existed.
        }
    }

    /** In flight registration, so concurrent callers share one attempt. */
    private static registering: Promise<string | null> | null = null;

    private static async config(): Promise<{ requestConfig: AxiosRequestConfig; token: string | null }> {
        if (appConfig.apiUrl === null) {
            // Refused rather than sent at a guessed address. A relative request
            // would fail as a network error and send whoever debugs it looking
            // at the wifi instead of at the missing configuration.
            throw new ApiRequestError(
                CLIENT_ERROR_CODES.API_URL_MISSING,
                null,
                'No API URL configured, and no Metro host to infer one from. ' +
                    'Set EXPO_PUBLIC_API_URL. See apps/mobile/.env.example.',
            );
        }

        const token = await Axios.ensureToken();
        const requestConfig: AxiosRequestConfig = {
            baseURL: appConfig.apiUrl,
            /**
             * Generous, because the slow endpoints are slow for a real reason.
             * Arming a morning plans a journey, which is two or three calls to
             * NS and TomTom from the server before it can answer. Fifteen
             * seconds cut those off often enough to look like an outage.
             */
            timeout: 40000,
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        };
        return { requestConfig, token };
    }

    /**
     * Every verb funnels through here so a failure has one shape.
     *
     * Without it each caller sees a raw `AxiosError` and has to know where the
     * server put its error code, which is how translated messages turn into
     * `error.response.data.error.message` scattered across screens.
     *
     * It is also the one place a rejected device token can be recovered from,
     * which is why the retry lives here rather than in any screen.
     */
    private static async request<T>(send: (config: AxiosRequestConfig) => Promise<{ data: T }>) {
        const { requestConfig, token } = await Axios.config();

        try {
            const response = await send(requestConfig);
            return response.data;
        } catch (error) {
            const failure = ApiRequestError.from(error);
            if (failure.status !== 401 || token === null) {
                throw failure;
            }

            /*
             * The token is real and the server does not know it. That happens
             * whenever the app is pointed at a different API than the one that
             * issued it: a phone that ran a development build against the laptop
             * keeps its token when a preview build replaces it, because the
             * package id is the same and secure storage survives the install.
             *
             * Before this, the only cure was clearing the app's data by hand,
             * and the copy on screen said "it will register again" while nothing
             * in the app did. `clearToken` existed and had no callers.
             */
            await Axios.discardRejectedToken(token);
            const replacement = await Axios.ensureToken();
            if (replacement === null || replacement === token) {
                throw failure;
            }

            try {
                const retry = await send((await Axios.config()).requestConfig);
                return retry.data;
            } catch (retryError) {
                // Not retried again. Two 401s with two different tokens is the
                // server refusing this device, not a stale credential.
                throw ApiRequestError.from(retryError);
            }
        }
    }

    static async get<T>(endpoint: string, params?: Record<string, unknown>): Promise<T> {
        return Axios.request<T>((config) => axios.get<T>(endpoint, { ...config, params }));
    }

    static async post<T>(endpoint: string, data?: unknown): Promise<T> {
        return Axios.request<T>((config) => axios.post<T>(endpoint, data, config));
    }

    static async patch<T>(endpoint: string, data?: unknown): Promise<T> {
        return Axios.request<T>((config) => axios.patch<T>(endpoint, data, config));
    }

    static async delete<T>(endpoint: string): Promise<T> {
        return Axios.request<T>((config) => axios.delete<T>(endpoint, config));
    }
}
