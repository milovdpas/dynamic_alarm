import { Colors, type ThemeColor } from '@/assets/Stylesheet';
import { useTheme } from '@/utils/contexts/ThemeContext';

export function useThemeColor(props: { light?: string; dark?: string }, colorName: ThemeColor) {
    const { theme } = useTheme();
    const colorFromProps = props[theme];

    if (colorFromProps) {
        return colorFromProps;
    }
    return Colors[theme][colorName];
}
