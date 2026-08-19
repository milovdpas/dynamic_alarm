import appConfig from '@/config';

/**
 * The sentence to show for a failed request.
 *
 * One copy of this, rather than the four near-identical ones that had grown
 * across the screens. They had already drifted, and the drift is the kind that
 * only shows up when something is broken and the message is wrong.
 *
 * The code is looked up in translations, and an unknown one falls back rather
 * than rendering a key. `ApiRequestError.code` carries both the server's codes
 * and the client's own, so a screen branches on one set of names.
 *
 * `details` is optional and carries the few facts a sentence interpolates. The
 * server sends data rather than prose for exactly this reason: "still used by
 * Work mornings" is worth saying, and it can only be said in the reader's own
 * language if the names arrive as names.
 *
 * The one conditional: an unreachable server means something different in a
 * development build that guessed its address from Metro than in a real build
 * pointing at a domain. Telling someone on a phone with no signal to check that
 * the address is a LAN IP rather than localhost is advice for a problem they do
 * not have, and it was the app's most confusing message.
 */
export function apiErrorMessage(
    t: Translate,
    code: string | null,
    details?: unknown,
): string {
    if (code === null) {
        return t('api.error.unknown');
    }

    const params = values(details);
    const key =
        code === 'NETWORK_UNREACHABLE' && appConfig.apiUrlInferred
            ? 'api.error.NETWORK_UNREACHABLE_LOCAL'
            : `api.error.${code}`;

    /**
     * A sentence naming something we were given, when we were given it.
     *
     * `RESOURCE_IN_USE` reads far better with the names of the schedules in the
     * way than without, and far worse than either if it renders `{{blockedBy}}`
     * onto the screen. i18next leaves an uninterpolated placeholder in place, so
     * a key that needs a value it did not get has to be avoided rather than
     * repaired, which is what the `_named` variant is for.
     */
    if (params !== undefined) {
        const named = t(`${key}_named`, params);
        if (named !== `${key}_named` && !named.includes('{{')) {
            return named;
        }
    }

    const copy = t(key, params);
    // The last net. An unknown code returns its own key, and a known one that
    // wanted a value nobody passed keeps its braces; neither belongs on screen.
    return copy === key || copy.includes('{{') ? t('api.error.unknown') : copy;
}

/**
 * The parts of `details` a sentence is allowed to interpolate.
 *
 * Whitelisted rather than spread, because `details` is whatever the server put
 * there. A refusal is not the place to discover that an unexpected shape has
 * reached a string, and a list of names is the only thing any copy asks for
 * today: `RESOURCE_IN_USE` names the schedules standing in the way of a delete,
 * which is the difference between "cannot delete this" and telling somebody
 * which two things to change first.
 */
function values(details: unknown): Record<string, string> | undefined {
    if (typeof details !== 'object' || details === null) {
        return undefined;
    }

    const blockedBy = (details as { blockedBy?: unknown }).blockedBy;
    if (!Array.isArray(blockedBy)) {
        return undefined;
    }

    const names = blockedBy.filter((name): name is string => typeof name === 'string');
    /**
     * An empty list is no list, and must not select the naming sentence.
     *
     * Returning `{ blockedBy: '' }` was enough to look like values had arrived,
     * so the `_named` variant was chosen and rendered "This is still used by: ."
     * An array that is empty, or that held nothing this function is willing to
     * put into a sentence, is the same situation as no details at all.
     */
    if (names.length === 0) {
        return undefined;
    }

    return { blockedBy: names.join(', ') };
}

/** i18next's `t`, narrowed to what this file needs of it. */
type Translate = (key: string, params?: Record<string, string>) => string;
