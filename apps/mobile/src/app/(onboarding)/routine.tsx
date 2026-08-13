import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { APP_CONSTANTS } from '@alarm/types';

import { Radius, Spacing } from '@/assets/Stylesheet';
import ActionButton from '@/components/buttons/ActionButton';
import TextField from '@/components/ui/TextField';
import { ThemedText } from '@/components/ui/ThemedText';
import { ThemedView } from '@/components/ui/ThemedView';
import { useOnboarding } from '@/utils/contexts/OnboardingContext';
import { useThemeColor } from '@/utils/hooks/useThemeColor';

/**
 * How long the morning takes, which is the part only the user knows.
 *
 * Steps start from the documented defaults rather than from an empty list: a
 * question with a plausible answer already in it gets corrected, an empty form
 * gets abandoned. Everything about them is editable, because a morning routine
 * that cannot be changed is a guess presented as a fact.
 *
 * Disabling is a switch rather than a tap on the row. The row-tap version was
 * invisible: nothing on screen suggested the label was a control, so the only
 * way to find it was to press something and watch what happened.
 *
 * A disabled step stays in the list and counts zero. That is how "not today"
 * works without losing the step, and it is why the total is shown on its own:
 * that sum is the number that moves the alarm, and it should never have to be
 * worked out by adding up what is on screen.
 */
export default function RoutineStep() {
    const { t } = useTranslation();
    const router = useRouter();
    const { draft, routineMinutes, addStep, removeStep, updateStep } = useOnboarding();

    const border = useThemeColor({}, 'border');
    const danger = useThemeColor({}, 'danger');
    const primary = useThemeColor({}, 'primary');
    const selected = useThemeColor({}, 'backgroundSelected');

    const atLimit = draft.routineSteps.length >= APP_CONSTANTS.ROUTINE.MAX_STEPS;
    // The API needs at least one step, so the last row cannot be removed. Better
    // than allowing it and refusing to continue: nothing to explain, and nothing
    // to undo.
    const canRemove = draft.routineSteps.length > 1;

    const setMinutes = (id: string, text: string) => {
        // Digits only, and empty means zero rather than NaN. A step that takes
        // no time is a real thing, such as taking medication.
        const minutes = Math.min(
            Number(text.replace(/\D/g, '') || '0'),
            APP_CONSTANTS.ROUTINE.MAX_STEP_MINUTES,
        );
        updateStep(id, { minutes });
    };

    return (
        <ThemedView style={styles.flex}>
            <SafeAreaView style={styles.flex} edges={['bottom']}>
                <ScrollView
                    contentContainerStyle={styles.content}
                    keyboardShouldPersistTaps="handled"
                >
                    <ThemedText type="subtitle">{t('onboarding.routine_intro')}</ThemedText>

                    {draft.routineSteps.map((step) => (
                        <View key={step.id} style={[styles.card, { borderColor: border }]}>
                            <View style={styles.topRow}>
                                <View style={styles.grow}>
                                    <TextField
                                        label={t('routine.step_label')}
                                        value={step.label}
                                        onChangeText={(label) => {
                                            updateStep(step.id, { label });
                                        }}
                                        placeholder={t('routine.step_placeholder')}
                                        maxLength={APP_CONSTANTS.ROUTINE.MAX_LABEL_LENGTH}
                                    />
                                </View>
                                <View style={styles.minutes}>
                                    <TextField
                                        label={t('routine.minutes')}
                                        value={String(step.minutes)}
                                        onChangeText={(text) => {
                                            setMinutes(step.id, text);
                                        }}
                                        keyboardType="number-pad"
                                        maxLength={3}
                                    />
                                </View>
                            </View>

                            <View style={styles.bottomRow}>
                                <View style={styles.switchRow}>
                                    <Switch
                                        value={step.enabled}
                                        onValueChange={(enabled) => {
                                            updateStep(step.id, { enabled });
                                        }}
                                        trackColor={{ true: primary, false: border }}
                                        accessibilityLabel={t('routine.counted')}
                                    />
                                    <ThemedText
                                        type="small"
                                        themeColor={step.enabled ? 'text' : 'textSecondary'}
                                    >
                                        {step.enabled ? t('routine.counted') : t('routine.skipped')}
                                    </ThemedText>
                                </View>

                                {canRemove && (
                                    <Pressable
                                        onPress={() => {
                                            removeStep(step.id);
                                        }}
                                        style={({ pressed }) => [
                                            styles.remove,
                                            pressed && { backgroundColor: selected },
                                        ]}
                                        accessibilityRole="button"
                                        accessibilityLabel={t('routine.remove_step', {
                                            label: step.label,
                                        })}
                                    >
                                        <ThemedText type="smallBold" style={{ color: danger }}>
                                            {t('routine.remove')}
                                        </ThemedText>
                                    </Pressable>
                                )}
                            </View>
                        </View>
                    ))}

                    <ActionButton
                        label={atLimit ? t('routine.max_reached') : t('routine.add')}
                        onPress={addStep}
                        disabled={atLimit}
                    />

                    <ThemedText type="subtitle">
                        {t('routine.total', { count: routineMinutes })}
                    </ThemedText>

                    <ActionButton
                        label={t('common.next')}
                        variant="primary"
                        onPress={() => {
                            router.push('/(onboarding)/schedule');
                        }}
                    />
                </ScrollView>
            </SafeAreaView>
        </ThemedView>
    );
}

const styles = StyleSheet.create({
    flex: {
        flex: 1,
    },
    content: {
        padding: Spacing.medium,
        gap: Spacing.medium,
    },
    card: {
        borderWidth: 1,
        borderRadius: Radius.medium,
        padding: Spacing.small,
        gap: Spacing.small,
    },
    topRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: Spacing.small,
    },
    grow: {
        flex: 1,
    },
    minutes: {
        width: 80,
    },
    bottomRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    switchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.small,
    },
    remove: {
        paddingHorizontal: Spacing.small,
        paddingVertical: Spacing.extraSmall,
        borderRadius: Radius.small,
    },
});
