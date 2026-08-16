import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { Schedule, Weekday } from '@alarm/types';

import { updateSchedule } from '@/api';
import { Spacing } from '@/assets/Stylesheet';
import ActionButton from '@/components/buttons/ActionButton';
import TextField from '@/components/ui/TextField';
import { ThemedText } from '@/components/ui/ThemedText';
import { ThemedView } from '@/components/ui/ThemedView';
import TimeField from '@/components/ui/TimeField';
import WarningBanner from '@/components/ui/WarningBanner';
import WeekdayPicker from '@/components/ui/WeekdayPicker';
import { useScheduleBundle } from '@/schedule/useScheduleBundle';
import { apiErrorMessage } from '@/utils/apiErrorMessage';
import { ApiRequestError } from '@/utils/modules/Axios';

/**
 * When you have to be there, and on which days.
 *
 * The deadline the whole calculation counts back from, so it is the one number
 * a user should be able to change without meeting anything else.
 */
export default function DeadlineScreen() {
    const { t } = useTranslation();
    const { id } = useLocalSearchParams<{ id: string }>();
    const { bundle, errorCode: loadError } = useScheduleBundle(id);

    // The form mounts with its values, rather than being seeded from an effect
    // afterwards. Seeding meant a reload could overwrite what was being typed,
    // and it needed a flag to stop it, which is a bug waiting for the day the
    // flag is wrong.
    return (
        <ThemedView style={styles.flex}>
            <SafeAreaView style={styles.flex} edges={['bottom']}>
                <ScrollView
                    contentContainerStyle={styles.content}
                    keyboardShouldPersistTaps="handled"
                >
                    {loadError !== null && (
                        <WarningBanner
                            title={t('schedules.failed')}
                            message={apiErrorMessage(t, loadError)}
                        />
                    )}
                    {bundle !== null && <DeadlineForm id={id} schedule={bundle.schedule} />}
                </ScrollView>
            </SafeAreaView>
        </ThemedView>
    );
}

function DeadlineForm({ id, schedule }: { id: string; schedule: Schedule }) {
    const { t } = useTranslation();
    const router = useRouter();

    const [name, setName] = useState(schedule.name);
    const [arrivalTime, setArrivalTime] = useState(schedule.arrivalTime.slice(0, 5));
    const [days, setDays] = useState<Weekday[]>(schedule.daysOfWeek);
    const [errorCode, setErrorCode] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const valid = name.trim() !== '' && /^\d{1,2}:\d{2}$/.test(arrivalTime) && days.length > 0;

    const save = useCallback(async () => {
        setSaving(true);
        try {
            await updateSchedule(id, { name: name.trim(), arrivalTime, daysOfWeek: days });
            router.back();
        } catch (error) {
            setErrorCode(ApiRequestError.from(error).code);
        } finally {
            setSaving(false);
        }
    }, [arrivalTime, days, id, name, router]);

    return (
        <>
            {errorCode !== null && (
                <WarningBanner
                    title={t('schedules.save_failed')}
                    message={apiErrorMessage(t, errorCode)}
                />
            )}

            <TextField
                label={t('schedules.name')}
                value={name}
                onChangeText={setName}
                editable={!saving}
            />

            <TimeField
                label={t('schedule.arrival_time')}
                value={arrivalTime}
                onChange={setArrivalTime}
            />

            <ThemedText type="small" themeColor="textSecondary">
                {t('schedules.days')}
            </ThemedText>
            <WeekdayPicker value={days} onChange={setDays} disabled={saving} />

            <ThemedText type="small" themeColor="textSecondary">
                {t('schedules.rearm_notice')}
            </ThemedText>

            <ActionButton
                label={saving ? t('schedules.saving') : t('common.save')}
                variant="primary"
                disabled={!valid || saving}
                onPress={() => void save()}
            />
        </>
    );
}

const styles = StyleSheet.create({
    flex: { flex: 1 },
    content: { padding: Spacing.large, gap: Spacing.medium },
});
