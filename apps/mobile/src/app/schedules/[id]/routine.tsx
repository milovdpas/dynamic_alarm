import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useLocalSearchParams, useRouter } from 'expo-router';

import type { Routine } from '@alarm/types';

import { updateRoutine } from '@/api';
import { Spacing } from '@/assets/Stylesheet';
import ActionButton from '@/components/buttons/ActionButton';
import RoutineStepsEditor from '@/components/ui/RoutineStepsEditor';
import type { EditableStep } from '@/components/ui/RoutineStepsEditor';
import { ThemedText } from '@/components/ui/ThemedText';
import { ThemedView } from '@/components/ui/ThemedView';
import WarningBanner from '@/components/ui/WarningBanner';
import { useScheduleBundle } from '@/schedule/useScheduleBundle';
import { apiErrorMessage } from '@/utils/apiErrorMessage';
import { ApiRequestError } from '@/utils/modules/Axios';

/**
 * How long the morning takes, which is the half of the calculation the user
 * owns.
 *
 * The journey says when to leave; this says how long before that to wake. It is
 * also the number people revise most often, since a routine written during
 * onboarding is a guess made before living with it.
 */
export default function RoutineScreen() {
    const { t } = useTranslation();
    const { id } = useLocalSearchParams<{ id: string }>();
    const { bundle, errorCode: loadError } = useScheduleBundle(id);

    // Mounted with its steps rather than seeded afterwards, so a reload while
    // editing cannot overwrite them.
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
                    {bundle?.routine != null && <RoutineForm routine={bundle.routine} />}
                </ScrollView>
            </SafeAreaView>
        </ThemedView>
    );
}

function RoutineForm({ routine }: { routine: Routine }) {
    const { t } = useTranslation();
    const router = useRouter();

    const [steps, setSteps] = useState<EditableStep[]>(() =>
        routine.steps.map((step, index) => ({
            // Server ids where they exist, an index otherwise. These key the
            // rows; position is what the API reads as the order.
            id: step.id ?? `step-${String(index)}`,
            label: step.label,
            minutes: step.minutes,
            enabled: step.enabled,
        })),
    );
    const [errorCode, setErrorCode] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const valid = steps.length > 0 && steps.every((step) => step.label.trim() !== '');

    const save = useCallback(async () => {
        setSaving(true);
        try {
            await updateRoutine(routine.id, {
                steps: steps.map(({ label, minutes, enabled }) => ({
                    label: label.trim(),
                    minutes,
                    enabled,
                })),
            });
            router.back();
        } catch (error) {
            setErrorCode(ApiRequestError.from(error).code);
        } finally {
            setSaving(false);
        }
    }, [routine.id, router, steps]);

    return (
        <>
            {errorCode !== null && (
                <WarningBanner
                    title={t('schedules.save_failed')}
                    message={apiErrorMessage(t, errorCode)}
                />
            )}

            <ThemedText type="small" themeColor="textSecondary">
                {t('onboarding.routine_intro')}
            </ThemedText>

            <RoutineStepsEditor steps={steps} onChange={setSteps} disabled={saving} />

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
