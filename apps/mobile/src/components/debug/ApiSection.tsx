import { useTranslation } from 'react-i18next';

import ActionButton from '@/components/buttons/ActionButton';
import DetailRow from '@/components/ui/DetailRow';
import Section from '@/components/debug/Section';
import WarningBanner from '@/components/ui/WarningBanner';
import { ThemedText } from '@/components/ui/ThemedText';
import { apiErrorMessage } from '@/utils/apiErrorMessage';
import type { ApiConnection } from '@/api/registration';

/**
 * Whether the API is reachable, and what this device is to it.
 *
 * `connected` means the server answered this launch, from a read that refuses the
 * cache. Anything weaker would make this panel agree with itself while every
 * request behind it failed, which is the one thing a diagnostic must not do.
 */
interface ApiSectionProps {
    /**
     * Passed in rather than fetched here, so the panel and the report it copies
     * describe the same check. Two `useApiConnection` calls would be two live
     * reads that can disagree, which in a diagnostic is worse than useless.
     */
    connection: ApiConnection | null;
    retry: () => void;
}

export default function ApiSection({ connection, retry }: ApiSectionProps) {
    const { t } = useTranslation();

    return (
        <Section title={t('api.title')}>
            {/*
             * Three states, not two. Folding `undefined` in with `null` said "no
             * API address" for as long as the check was still running, directly
             * above a row that correctly said "registering this device".
             */}
            <DetailRow
                label={t('api.address')}
                value={
                    connection === null
                        ? t('common.unknown')
                        : connection.apiUrl === null
                          ? t('api.not_configured')
                          : connection.inferred
                            ? t('api.address_inferred', { url: connection.apiUrl })
                            : connection.apiUrl
                }
                warn={connection?.apiUrl === null}
            />
            <DetailRow
                label={t('api.title')}
                value={connection === null ? t('api.registering') : t(`api.${connection.state}`)}
                warn={connection?.state === 'unreachable' || connection?.state === 'not_configured'}
            />
            <DetailRow
                label={t('api.push_token')}
                value={
                    connection === null
                        ? t('common.unknown')
                        : t(`api.push.${connection.pushToken}`)
                }
                warn={
                    connection !== null &&
                    connection.pushToken !== 'registered' &&
                    connection.pushToken !== 'not_attempted'
                }
            />
            {connection?.errorCode != null && (
                <>
                    <WarningBanner
                        title={t(`api.${connection.state}`)}
                        message={apiErrorMessage(t, connection.errorCode)}
                    />
                    {/*
                     * Shown raw because they are data, not copy: a code the
                     * server chose and a message it wrote, neither of which has
                     * a translation to have. Everything else on this screen goes
                     * through `t()`.
                     *
                     * Worth the space because `state` says "unreachable" for a
                     * dead network, a 401 and a 500 alike, so these two are the
                     * only things that tell them apart, and hiding them behind a
                     * copy button meant nobody read them.
                     */}
                    <ThemedText type="small" themeColor="textSecondary">
                        {connection.errorCode}
                        {connection.errorDetail == null ? '' : `: ${connection.errorDetail}`}
                    </ThemedText>
                </>
            )}
            {connection !== null && connection.state !== 'registering' && (
                <ActionButton label={t('api.retry')} onPress={retry} />
            )}
        </Section>
    );
}
