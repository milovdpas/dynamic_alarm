import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Spacing } from '@/assets/Stylesheet';
import ActionButton from '@/components/buttons/ActionButton';
import { ThemedText } from '@/components/ui/ThemedText';
import { ThemedView } from '@/components/ui/ThemedView';
import RoutineStepsEditor from '@/components/ui/RoutineStepsEditor';
import { useOnboarding } from '@/utils/contexts/OnboardingContext';

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
    const { draft, update } = useOnboarding();

    return (
        <ThemedView style={styles.flex}>
            <SafeAreaView style={styles.flex} edges={['bottom']}>
                <ScrollView
                    contentContainerStyle={styles.content}
                    keyboardShouldPersistTaps="handled"
                >
                    <ThemedText type="subtitle">{t('onboarding.routine_intro')}</ThemedText>

                    <RoutineStepsEditor
                        steps={draft.routineSteps}
                        onChange={(routineSteps) => {
                            update({ routineSteps });
                        }}
                    />

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
});
