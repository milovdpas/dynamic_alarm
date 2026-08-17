import { describe, expect, it, vi } from 'vitest';

/**
 * The config, which normally reads `expo-constants`.
 *
 * `apiUrlInferred` is the only field this file uses, and it decides between two
 * pieces of advice that contradict each other, so it is set per test.
 */
const config = { apiUrlInferred: false };
vi.mock('@/config', () => ({ default: config }));

const { apiErrorMessage } = await import('@/utils/apiErrorMessage');

/**
 * Stands in for i18next: a known key returns its sentence, an unknown one
 * returns the key, which is what i18next does and what the fallback relies on.
 */
const KNOWN: Record<string, string> = {
    'api.error.NETWORK_UNREACHABLE': 'Could not reach the server.',
    'api.error.NETWORK_UNREACHABLE_LOCAL': 'Nothing answered at that address.',
    'api.error.OFFLINE_WRITE': 'No connection, so this change was not saved.',
    'api.error.UNEXPECTED_FAILURE': 'Something went wrong inside the app.',
    'api.error.unknown': 'Something went wrong reaching the API.',
};
const t = (key: string) => KNOWN[key] ?? key;

describe('choosing what to tell somebody about a failed request', () => {
    it('translates the code it was given', () => {
        expect(apiErrorMessage(t, 'OFFLINE_WRITE')).toBe(
            'No connection, so this change was not saved.',
        );
    });

    it('falls back rather than rendering a translation key on screen', () => {
        // A server code this app has never heard of still has to produce a
        // sentence. `api.error.TEAPOT` in the middle of a screen is worse than
        // saying something vague.
        expect(apiErrorMessage(t, 'TEAPOT')).toBe('Something went wrong reaching the API.');
    });

    it('handles no code at all', () => {
        expect(apiErrorMessage(t, null)).toBe('Something went wrong reaching the API.');
    });
});

describe('the one conditional: whose network is being blamed', () => {
    it('gives the plain message when the address was configured', () => {
        config.apiUrlInferred = false;

        expect(apiErrorMessage(t, 'NETWORK_UNREACHABLE')).toBe('Could not reach the server.');
    });

    it('gives the development advice only when the address was guessed from Metro', () => {
        // Telling somebody on a phone with no signal to check that the address
        // is a LAN IP rather than localhost is advice for a problem they do not
        // have, and it was this app's most confusing message.
        config.apiUrlInferred = true;

        expect(apiErrorMessage(t, 'NETWORK_UNREACHABLE')).toBe('Nothing answered at that address.');
    });

    it('does not apply that advice to any other code', () => {
        config.apiUrlInferred = true;

        // A bug inside the app is not a wrongly configured address, and this
        // exact conflation is what sent a morning's debugging at the router.
        expect(apiErrorMessage(t, 'UNEXPECTED_FAILURE')).toBe(
            'Something went wrong inside the app.',
        );
    });
});
