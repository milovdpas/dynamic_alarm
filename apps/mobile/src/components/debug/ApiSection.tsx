import { useTranslation } from 'react-i18next';

import ActionButton from '@/components/buttons/ActionButton';
import DetailRow from '@/components/ui/DetailRow';
import Section from '@/components/debug/Section';
import WarningBanner from '@/components/ui/WarningBanner';
import { apiErrorMessage } from '@/utils/apiErrorMessage';
import { useApiConnection } from '@/utils/hooks/useApiConnection';

/**
 * Whether the API is reachable, and what this device is to it.
 *
 * `connected` means the server answered this launch, from a read that refuses the
 * cache. Anything weaker would make this panel agree with itself while every
 * request behind it failed, which is the one thing a diagnostic must not do.
 */
export default function ApiSection() {
    const { t } = useTranslation();
    const { connection, retry } = useApiConnection();

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
                <WarningBanner
                    title={t(`api.${connection.state}`)}
                    message={apiErrorMessage(t, connection.errorCode)}
                />
            )}
            {connection !== null && connection.state !== 'registering' && (
                <ActionButton label={t('api.retry')} onPress={retry} />
            )}
        </Section>
    );
}
