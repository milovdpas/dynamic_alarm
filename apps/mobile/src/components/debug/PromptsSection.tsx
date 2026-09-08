import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ActionButton from '@/components/buttons/ActionButton';
import Section from '@/components/debug/Section';
import DetailRow from '@/components/ui/DetailRow';
import { ThemedText } from '@/components/ui/ThemedText';
import { EMPTY_MARKS, readPromptMarks, resetPromptMarks, type PromptMarks } from '@/prompts/prompts';
import { showPrompt } from '@/prompts/usePrompts';

/**
 * The two prompts on demand, and what the phone remembers about them.
 *
 * They appear a fortnight and a month after registration, once and monthly, so
 * without this the only way to see either was to wait. Showing one here writes
 * the same marks the real one does, which is the point: the buttons on it are
 * the real buttons, and "I already donated" pressed here is as final as it is
 * anywhere. Reset is the way back.
 */
export default function PromptsSection() {
    const { t } = useTranslation();
    const [marks, setMarks] = useState<PromptMarks>(EMPTY_MARKS);

    const reload = useCallback(() => {
        void readPromptMarks().then(setMarks);
    }, []);

    useEffect(reload, [reload]);

    const when = (iso: string | null): string =>
        iso === null ? t('harness.none') : new Date(iso).toLocaleString();

    return (
        <Section title={t('prompts.debug_title')}>
            <ThemedText type="small" themeColor="textSecondary">
                {t('prompts.debug_help')}
            </ThemedText>

            <DetailRow label={t('prompts.debug_donated')} value={when(marks.donatedAt)} />
            <DetailRow label={t('prompts.debug_last_donate_ask')} value={when(marks.lastDonatePromptAt)} />
            <DetailRow label={t('prompts.debug_rated')} value={when(marks.ratedAt)} />
            <DetailRow label={t('prompts.debug_last_rate_ask')} value={when(marks.lastRatePromptAt)} />

            <ActionButton
                label={t('prompts.debug_show_donate')}
                onPress={() => {
                    showPrompt('DONATE', t);
                    // The dialog writes its mark on a button press, which lands
                    // after this returns; a short delay reads it back.
                    setTimeout(reload, 1500);
                }}
            />
            <ActionButton
                label={t('prompts.debug_show_rate')}
                onPress={() => {
                    showPrompt('RATE', t);
                    setTimeout(reload, 1500);
                }}
            />
            <ActionButton
                label={t('prompts.debug_reset')}
                onPress={() => {
                    void resetPromptMarks().then(reload);
                }}
            />
        </Section>
    );
}
