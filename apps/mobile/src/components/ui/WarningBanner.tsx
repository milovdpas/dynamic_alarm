import { StyleSheet, View } from 'react-native';

import { Radius, Spacing } from '@/assets/Stylesheet';
import { ThemedText } from '@/components/ui/ThemedText';
import { useThemeColor } from '@/utils/hooks/useThemeColor';

interface WarningBannerProps {
    title: string;
    message: string;
}

/**
 * Used when the app cannot do something the user is relying on, no native
 * alarm support, muted alarm volume, an unreachable journey.
 *
 * These states must be loud. Quietly degrading is how someone ends up trusting
 * an alarm that was never going to ring.
 */
export default function WarningBanner({ title, message }: WarningBannerProps) {
    const warning = useThemeColor({}, 'warning');
    const background = useThemeColor({}, 'backgroundElement');

    return (
        <View style={[styles.banner, { backgroundColor: background, borderLeftColor: warning }]}>
            <ThemedText type="smallBold" themeColor="warning">
                {title}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
                {message}
            </ThemedText>
        </View>
    );
}

const styles = StyleSheet.create({
    banner: {
        padding: Spacing.medium,
        borderRadius: Radius.medium,
        borderLeftWidth: 4,
        gap: Spacing.extraSmall,
    },
});
