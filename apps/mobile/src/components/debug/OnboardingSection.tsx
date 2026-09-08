import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import ActionButton from '@/components/buttons/ActionButton';
import Section from '@/components/debug/Section';
import { ThemedText } from '@/components/ui/ThemedText';
import { rehearseOnboarding } from '@/utils/contexts/OnboardingContext';

/**
 * The setup flow, on demand, without saving anything.
 *
 * Onboarding is the hardest screen set in the app to look at deliberately: it
 * runs once, and the only way back to it was to wipe storage and start again,
 * which costs the schedules, the routine and the places along with it. So the
 * flow nobody sees twice was also the flow nobody could check.
 *
 * A rehearsal walks every step and stops at the last one, before the first
 * write. The four screens before it were always harmless, since they only edit a
 * draft that lives as long as the provider does; `commit` is the only step that
 * creates anything, and it is the only one that has to know.
 *
 * Every screen carries a banner saying so. A rehearsal that looked exactly like
 * the real thing would end with somebody pressing the last button, watching it
 * succeed and finding no alarm set, which is the failure this app is least
 * allowed to have.
 *
 * The real flow is still reachable, from "add a schedule" on the alarms tab.
 * That one saves.
 */
export default function OnboardingSection() {
    const { t } = useTranslation();
    const router = useRouter();

    return (
        <Section title={t('harness.onboarding')}>
            <ThemedText type="small" themeColor="textSecondary">
                {t('harness.onboarding_help')}
            </ThemedText>
            <ActionButton
                label={t('harness.onboarding_rehearse')}
                onPress={() => {
                    // Requested before navigating, and read once when the group's
                    // provider mounts. Setting it after would race the mount.
                    rehearseOnboarding();
                    router.push('/(onboarding)/places');
                }}
            />
        </Section>
    );
}
