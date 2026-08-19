import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ReplacementPreference } from '@alarm/types';

import { Spacing } from '@/assets/Stylesheet';
import ChoiceRow from '@/components/ui/ChoiceRow';
import TimeField from '@/components/ui/TimeField';
import { ThemedText } from '@/components/ui/ThemedText';

interface ReplacementSectionProps {
    preference: ReplacementPreference;
    onPreferenceChange: (value: ReplacementPreference) => void;
    /** `HH:mm`, or empty for "any hour will do". */
    windowStart: string;
    onWindowStartChange: (value: string) => void;
    windowEnd: string;
    onWindowEndChange: (value: string) => void;
}

/**
 * Which replacement is acceptable when the chosen train is cancelled.
 *
 * Shared by the schedule editor and onboarding, which is the point: onboarding
 * did not ask this until 2026-08-19, so a schedule arrived with `EARLIER` and no
 * window, and the first cancellation could move an alarm to a train an hour
 * earlier on a preference its owner had never seen. Two copies of this UI would
 * be how the screens drift into disagreeing about one field.
 *
 * Public transport only, and the caller decides that: a car journey has no train
 * to be cancelled, so offering the choice would be asking about something that
 * cannot happen.
 */
export default function ReplacementSection({
    preference,
    onPreferenceChange,
    windowStart,
    onWindowStartChange,
    windowEnd,
    onWindowEndChange,
}: ReplacementSectionProps) {
    const { t } = useTranslation();

    return (
        <View style={styles.section}>
            <ThemedText type="subtitle">{t('replacement.title')}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
                {t('replacement.help')}
            </ThemedText>

            <ChoiceRow
                label={t('replacement.preference')}
                value={preference}
                onChange={onPreferenceChange}
                choices={[
                    { value: ReplacementPreference.EARLIER, label: t('replacement.earlier') },
                    { value: ReplacementPreference.LATER, label: t('replacement.later') },
                ]}
            />

            {/*
             * Optional on purpose. Empty means any hour is acceptable, which is
             * what the app did before these existed, and a window nobody has
             * thought about should not silently start rejecting trains.
             */}
            <TimeField
                label={t('replacement.window_start')}
                value={windowStart}
                onChange={onWindowStartChange}
            />
            <TimeField
                label={t('replacement.window_end')}
                value={windowEnd}
                onChange={onWindowEndChange}
            />
            <ThemedText type="small" themeColor="textSecondary">
                {t('replacement.window_help')}
            </ThemedText>
        </View>
    );
}

const styles = StyleSheet.create({
    section: { gap: Spacing.small },
});
