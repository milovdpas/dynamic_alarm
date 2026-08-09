import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/assets/Stylesheet';
import { ThemedText } from '@/components/ui/ThemedText';

interface DetailRowProps {
    label: string;
    value: string;
    /** Renders the value in the danger colour, for muted volume, missing permissions. */
    warn?: boolean;
}

export default function DetailRow({ label, value, warn = false }: DetailRowProps) {
    return (
        <View style={styles.row}>
            <ThemedText type="small" themeColor="textSecondary">
                {label}
            </ThemedText>
            <ThemedText type="small" themeColor={warn ? 'danger' : 'text'} style={styles.value}>
                {value}
            </ThemedText>
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: Spacing.medium,
    },
    value: {
        flexShrink: 1,
        textAlign: 'right',
    },
});
