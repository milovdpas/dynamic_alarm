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
 * The one conditional: an unreachable server means something different in a
 * development build that guessed its address from Metro than in a real build
 * pointing at a domain. Telling someone on a phone with no signal to check that
 * the address is a LAN IP rather than localhost is advice for a problem they do
 * not have, and it was the app's most confusing message.
 */
export function apiErrorMessage(t: (key: string) => string, code: string | null): string {
    if (code === null) {
        return t('api.error.unknown');
    }

    const key =
        code === 'NETWORK_UNREACHABLE' && appConfig.apiUrlInferred
            ? 'api.error.NETWORK_UNREACHABLE_LOCAL'
            : `api.error.${code}`;

    const copy = t(key);
    return copy === key ? t('api.error.unknown') : copy;
}
