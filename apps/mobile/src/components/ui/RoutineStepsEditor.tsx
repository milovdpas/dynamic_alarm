import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { APP_CONSTANTS } from '@alarm/types';

import { Radius, Spacing } from '@/assets/Stylesheet';
import ActionButton from '@/components/buttons/ActionButton';
import TextField from '@/components/ui/TextField';
import { ThemedText } from '@/components/ui/ThemedText';
import { useThemeColor } from '@/utils/hooks/useThemeColor';

/** A step being edited. The id is local, and only exists to key the rows. */
export interface EditableStep {
    id: string;
    label: string;
    minutes: number;
    enabled: boolean;
}

/**
 * The morning routine, as a list of steps that can be changed.
 *
 * Shared by onboarding and the schedule editor. It was written twice for a
 * while, and the second copy is exactly how the two would have drifted: the
 * limits, the digits-only handling and the rule that the last step cannot be
 * removed are all easy to get subtly different.
 *
 * Disabling is a switch rather than a tap on the row. The row-tap version was
 * invisible: nothing suggested the label was a control, so the only way to find
 * it was to press something and watch what happened.
 *
 * A disabled step stays in the list and counts zero, which is how "not today"
 * works without losing the step. The total is shown separately because that sum
 * is the number that moves the alarm, and it should never have to be worked out
 * by adding up what is on screen.
 */
export default function RoutineStepsEditor({
    steps,
    onChange,
    disabled = false,
}: {
    steps: EditableStep[];
    onChange: (steps: EditableStep[]) => void;
    disabled?: boolean;
}) {
    const { t } = useTranslation();
    const border = useThemeColor({}, 'border');
    const danger = useThemeColor({}, 'danger');
    const primary = useThemeColor({}, 'primary');
    const selected = useThemeColor({}, 'backgroundSelected');

    const atLimit = steps.length >= APP_CONSTANTS.ROUTINE.MAX_STEPS;
    // The API needs at least one step, so the last row cannot be removed. Better
    // than allowing it and refusing to save: nothing to explain, nothing to undo.
    const canRemove = steps.length > 1;

    const total = steps.reduce((sum, step) => sum + (step.enabled ? step.minutes : 0), 0);

    const patch = (id: string, changes: Partial<EditableStep>): void => {
        onChange(steps.map((step) => (step.id === id ? { ...step, ...changes } : step)));
    };

    const setMinutes = (id: string, text: string): void => {
        // Digits only, and empty means zero rather than NaN. A step that takes no
        // time is a real thing, such as taking medication.
        const minutes = Math.min(
            Number(text.replace(/\D/g, '') || '0'),
            APP_CONSTANTS.ROUTINE.MAX_STEP_MINUTES,
        );
        patch(id, { minutes });
    };

    return (
        <View style={styles.list}>
            {steps.map((step) => (
                <View key={step.id} style={[styles.card, { borderColor: border }]}>
                    <View style={styles.topRow}>
                        <View style={styles.grow}>
                            <TextField
                                label={t('routine.step_label')}
                                value={step.label}
                                onChangeText={(label) => {
                                    patch(step.id, { label });
                                }}
                                placeholder={t('routine.step_placeholder')}
                                maxLength={APP_CONSTANTS.ROUTINE.MAX_LABEL_LENGTH}
                                editable={!disabled}
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
                                editable={!disabled}
                            />
                        </View>
                    </View>

                    <View style={styles.bottomRow}>
                        <View style={styles.switchRow}>
                            <Switch
                                value={step.enabled}
                                onValueChange={(enabled) => {
                                    patch(step.id, { enabled });
                                }}
                                disabled={disabled}
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
                                disabled={disabled}
                                onPress={() => {
                                    onChange(steps.filter((each) => each.id !== step.id));
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
                disabled={atLimit || disabled}
                onPress={() => {
                    onChange([
                        ...steps,
                        {
                            // Unique enough for a list that never leaves this
                            // screen, and the server assigns the real ids.
                            id: `step-${String(Date.now())}`,
                            label: '',
                            minutes: 5,
                            enabled: true,
                        },
                    ]);
                }}
            />

            <ThemedText type="subtitle">{t('routine.total', { count: total })}</ThemedText>
        </View>
    );
}

const styles = StyleSheet.create({
    list: { gap: Spacing.medium },
    card: {
        borderWidth: 1,
        borderRadius: Radius.small,
        padding: Spacing.medium,
        gap: Spacing.small,
    },
    topRow: { flexDirection: 'row', gap: Spacing.small, alignItems: 'flex-end' },
    grow: { flex: 1 },
    minutes: { width: 90 },
    bottomRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.small },
    remove: { paddingVertical: Spacing.extraSmall, paddingHorizontal: Spacing.small },
});
