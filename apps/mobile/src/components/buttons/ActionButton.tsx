import { Pressable, StyleSheet } from 'react-native';

import { Radius, Spacing } from '@/assets/Stylesheet';
import { ThemedText } from '@/components/ui/ThemedText';
import { useThemeColor } from '@/utils/hooks/useThemeColor';

interface ActionButtonProps {
    label: string;
    onPress: () => void;
    disabled?: boolean;
    variant?: 'default' | 'primary';
}

export default function ActionButton({
    label,
    onPress,
    disabled = false,
    variant = 'default',
}: ActionButtonProps) {
    const border = useThemeColor({}, 'border');
    const primary = useThemeColor({}, 'primary');

    return (
        <Pressable
            style={[
                styles.button,
                { borderColor: variant === 'primary' ? primary : border },
                disabled && styles.disabled,
            ]}
            onPress={onPress}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ disabled }}
        >
            <ThemedText type="smallBold" themeColor={variant === 'primary' ? 'primary' : 'text'}>
                {label}
            </ThemedText>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    button: {
        paddingVertical: Spacing.medium,
        paddingHorizontal: Spacing.large,
        borderRadius: Radius.medium,
        borderWidth: StyleSheet.hairlineWidth,
        alignItems: 'center',
    },
    disabled: {
        opacity: 0.35,
    },
});
