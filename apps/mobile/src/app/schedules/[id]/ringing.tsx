import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { DEFAULT_REMINDERS } from '@alarm/types';
import type { ReminderConfig, Schedule } from '@alarm/types';

import { updateSchedule } from '@/api';
import { Spacing } from '@/assets/Stylesheet';
import ReminderPicker from '@/components/alarms/ReminderPicker';
import ActionButton from '@/components/buttons/ActionButton';
import { ThemedText } from '@/components/ui/ThemedText';
import { ThemedView } from '@/components/ui/ThemedView';
import WarningBanner from '@/components/ui/WarningBanner';
import { useScheduleBundle } from '@/schedule/useScheduleBundle';
import { apiErrorMessage } from '@/utils/apiErrorMessage';
import { ApiRequestError } from '@/utils/modules/Axios';

/**
 * How this schedule wakes you, as opposed to when.
 *
 * Its own section rather than part of "your morning", and the reason is the data
 * model rather than taste: a routine belongs to the device and **more than one
 * schedule can share it**, which is why deleting one reports the schedules
 * standing in the way. Reminders belong to a single schedule. Putting them on
 * the routine screen would mean one control there changing one schedule while
 * everything around it changed several, with nothing on screen saying so.
 *
 * It is also a different kind of question. The deadline, the journey and the
 * routine are all stages of the calculation that produces a wake time; this is
 * what happens when that time arrives, and it changes none of the arithmetic.
 *
 * Deliberately somewhere to grow. A per-schedule tone, or a lock that applies to
 * the commute but not to Saturday, would belong here rather than needing a
 * section invented for them later.
 */
export default function RingingScreen() {
    const { t } = useTranslation();
    const { id } = useLocalSearchParams<{ id: string }>();
    const { bundle, errorCode: loadError } = useScheduleBundle(id);

    return (
        <ThemedView style={styles.flex}>
            <SafeAreaView style={styles.flex} edges={['bottom']}>
                <ScrollView contentContainerStyle={styles.content}>
                    {loadError !== null && (
                        <WarningBanner
                            title={t('schedules.failed')}
                            message={apiErrorMessage(t, loadError)}
                        />
                    )}
                    {bundle !== null && <RingingForm id={id} schedule={bundle.schedule} />}
                </ScrollView>
            </SafeAreaView>
        </ThemedView>
    );
}

function RingingForm({ id, schedule }: { id: string; schedule: Schedule }) {
    const { t } = useTranslation();
    const router = useRouter();

    // Mounted with its value rather than seeded from an effect, so a reload
    // cannot overwrite a change in progress. Same reasoning as the other forms.
    const [reminders, setReminders] = useState<ReminderConfig>(
        schedule.reminders ?? DEFAULT_REMINDERS,
    );
    const [errorCode, setErrorCode] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const save = useCallback(async () => {
        setSaving(true);
        try {
            await updateSchedule(id, { reminders });
            router.back();
        } catch (error) {
            setErrorCode(ApiRequestError.from(error).code);
        } finally {
            setSaving(false);
        }
    }, [id, reminders, router]);

    return (
        <>
            {errorCode !== null && (
                <WarningBanner
                    title={t('schedules.save_failed')}
                    message={apiErrorMessage(t, errorCode)}
                />
            )}

            <ThemedText type="small" themeColor="textSecondary">
                {t('schedules.section_ringing_intro')}
            </ThemedText>

            <ReminderPicker value={reminders} onChange={setReminders} disabled={saving} />

            {/*
             * No re-arm notice here, unlike the other three screens. Nothing on
             * this page changes the wake time, so the armed morning survives and
             * telling somebody their alarm is being worked out again would be
             * false.
             */}

            <ActionButton
                label={saving ? t('schedules.saving') : t('common.save')}
                variant="primary"
                disabled={saving}
                onPress={() => void save()}
            />
        </>
    );
}

const styles = StyleSheet.create({
    flex: { flex: 1 },
    content: { padding: Spacing.large, gap: Spacing.medium },
});
