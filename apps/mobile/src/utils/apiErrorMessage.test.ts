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
    'api.error.RESOURCE_IN_USE': 'Something else still uses this.',
    'api.error.RESOURCE_IN_USE_named': 'This is still used by: {{blockedBy}}.',
    'api.error.unknown': 'Something went wrong reaching the API.',
};

/**
 * i18next, closely enough: an unknown key comes back as itself, and a
 * placeholder with no value passed is left in the sentence rather than removed.
 * That second behaviour is the one worth imitating, because it is how
 * `{{blockedBy}}` came to be renderable on screen.
 */
const t = (key: string, params?: Record<string, string>) => {
    const copy = KNOWN[key] ?? key;
    return Object.entries(params ?? {}).reduce(
        (text, [name, value]) => text.replaceAll(`{{${name}}}`, value),
        copy,
    );
};

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

describe('a sentence that names something it was not given', () => {
    it('interpolates the names when the failure carried them', () => {
        expect(
            apiErrorMessage(t, 'RESOURCE_IN_USE', { blockedBy: ['Work mornings', 'Gym'] }),
        ).toBe('This is still used by: Work mornings, Gym.');
    });

    it('falls back to the wording that needs no names when it has none', () => {
        // Not the `_named` variant, and not `{{blockedBy}}` on screen either.
        expect(apiErrorMessage(t, 'RESOURCE_IN_USE')).toBe('Something else still uses this.');
    });

    it('falls back for details that name nothing, rather than trailing off', () => {
        /*
         * Asserted against the whole sentence, not against the absence of
         * braces. The looser version passed while `{ blockedBy: [] }` produced
         * "This is still used by: .", because an empty string interpolates
         * cleanly and leaves nothing for a placeholder check to find. A test
         * that only rules out the previous bug will keep passing through the
         * next one.
         */
        const unnamed = 'Something else still uses this.';

        expect(apiErrorMessage(t, 'RESOURCE_IN_USE', undefined)).toBe(unnamed);
        expect(apiErrorMessage(t, 'RESOURCE_IN_USE', null)).toBe(unnamed);
        expect(apiErrorMessage(t, 'RESOURCE_IN_USE', {})).toBe(unnamed);
        expect(apiErrorMessage(t, 'RESOURCE_IN_USE', { blockedBy: [] })).toBe(unnamed);
        expect(apiErrorMessage(t, 'RESOURCE_IN_USE', { blockedBy: [1, 2] })).toBe(unnamed);
        expect(apiErrorMessage(t, 'RESOURCE_IN_USE', { blockedBy: 'nope' })).toBe(unnamed);
    });

    it('names only the entries it can actually put in a sentence', () => {
        // A mixed array keeps the strings rather than falling back entirely:
        // naming one of the two things in the way still beats naming neither.
        expect(
            apiErrorMessage(t, 'RESOURCE_IN_USE', { blockedBy: ['Work mornings', 7, null] }),
        ).toBe('This is still used by: Work mornings.');
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
