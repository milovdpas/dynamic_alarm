import { View, type ViewProps } from 'react-native';

import type { ThemeColor } from '@/assets/Stylesheet';
import { useThemeColor } from '@/utils/hooks/useThemeColor';

export type ThemedViewProps = ViewProps & {
    themeColor?: ThemeColor;
};

export function ThemedView({ style, themeColor, ...rest }: ThemedViewProps) {
    const backgroundColor = useThemeColor({}, themeColor ?? 'background');

    return <View style={[{ backgroundColor }, style]} {...rest} />;
}
