import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import ActionButton from '@/components/buttons/ActionButton';
import Section from '@/components/debug/Section';
import { ThemedText } from '@/components/ui/ThemedText';

/**
 * Every state the ring screen can be in, on demand.
 *
 * It normally appears over a lock screen at an hour nobody chooses, in states
 * that depend on a train being cancelled, which makes it the hardest screen in
 * the app to look at deliberately.
 *
 * These open the real component with an invented disruption. Nothing rings and
 * nothing is dismissed, so the lock is exercised too: whichever puzzle is set in
 * settings has to be solved to leave, which is the only way to find out whether
 * it is solvable at 06:00 without waiting for one.
 *
 * The states are listed here and built in `ring.tsx`, which is the pairing to
 * keep in mind when adding one: a name with no case there previews nothing.
 */
const PREVIEW_STATES = [
    'NONE',
    'DELAY',
    'CANCELLATION',
    'CANCELLATION_REPLACED',
    'NO_REPLACEMENT',
    'SIMULATED',
] as const;

export default function RingPreviewSection() {
    const { t } = useTranslation();
    const router = useRouter();

    return (
        <Section title={t('ring_preview.title')}>
            <ThemedText type="small" themeColor="textSecondary">
                {t('ring_preview.help')}
            </ThemedText>
            {PREVIEW_STATES.map((state) => (
                <ActionButton
                    key={state}
                    label={t(`ring_preview.${state}`)}
                    onPress={() => {
                        router.push({ pathname: '/ring', params: { preview: state } });
                    }}
                />
            ))}
        </Section>
    );
}
