import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import DetailRow from '@/components/ui/DetailRow';
import Section from '@/components/debug/Section';
import { readRunningBundle } from '@/utils/modules/Updates';

/**
 * Which JavaScript is running.
 *
 * An over-the-air update makes this a real question: the APK is from one day and
 * its bundle may be from another, and nothing else on the phone says so.
 */
export default function BundleSection() {
    const { t } = useTranslation();
    // Read once. The running bundle cannot change without a restart.
    const [bundle] = useState(readRunningBundle);

    return (
        <Section title={t('bundle.title')}>
            <DetailRow
                label={t('bundle.source')}
                value={
                    bundle === null
                        ? t('bundle.development')
                        : bundle.fromUpdate
                          ? t('bundle.from_update')
                          : t('bundle.embedded')
                }
            />
            {bundle !== null && (
                <>
                    <DetailRow
                        label={t('bundle.published')}
                        value={
                            bundle.publishedAt === null
                                ? t('common.unknown')
                                : new Date(bundle.publishedAt).toLocaleString()
                        }
                    />
                    <DetailRow
                        label={t('bundle.channel')}
                        value={bundle.channel ?? t('common.unknown')}
                    />
                    <DetailRow
                        label={t('bundle.runtime')}
                        value={bundle.runtimeVersion ?? t('common.unknown')}
                    />
                    {/*
                     * The full id, not a prefix: it is compared against what
                     * `eas update` printed, and half of a uuid cannot be compared
                     * with anything.
                     */}
                    <DetailRow
                        label={t('bundle.update_id')}
                        value={bundle.updateId ?? t('bundle.embedded')}
                    />
                </>
            )}
        </Section>
    );
}
