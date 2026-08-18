import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/assets/Stylesheet';
import { ThemedText } from '@/components/ui/ThemedText';

/**
 * A titled block in the diagnostics panel.
 *
 * Its own file because the panel's sections live in their own files now, and a
 * wrapper defined inside the screen would have to be passed to each of them.
 */
export default function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <View style={styles.section}>
            <ThemedText type="subtitle">{title}</ThemedText>
            {children}
        </View>
    );
}

const styles = StyleSheet.create({
    section: {
        gap: Spacing.small,
    },
});
