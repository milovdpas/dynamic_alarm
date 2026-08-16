import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { useThemeColor } from '@/utils/hooks/useThemeColor';

/**
 * The three places this app has.
 *
 * Tabs rather than a home screen with links, decided after the first week of
 * real use: editing a schedule is not a rare configuration task, it is the
 * second thing anyone does once the alarm works, and putting it behind a row on
 * the home screen said the opposite.
 *
 * Each tab draws its own header, so this layout hides the one the tab navigator
 * would add. Two headers is what the onboarding group taught us to avoid.
 */
export default function TabsLayout() {
    const { t } = useTranslation();
    const active = useThemeColor({}, 'primary');
    const inactive = useThemeColor({}, 'textSecondary');
    const background = useThemeColor({}, 'background');
    const border = useThemeColor({}, 'border');

    return (
        <Tabs
            screenOptions={{
                headerShown: false,
                tabBarActiveTintColor: active,
                tabBarInactiveTintColor: inactive,
                tabBarStyle: { backgroundColor: background, borderTopColor: border },
            }}
        >
            <Tabs.Screen
                name="index"
                options={{
                    title: t('tabs.today'),
                    tabBarIcon: ({ color, size }) => (
                        <MaterialCommunityIcons name="alarm" color={color} size={size} />
                    ),
                }}
            />
            <Tabs.Screen
                name="schedules"
                options={{
                    title: t('tabs.schedules'),
                    tabBarIcon: ({ color, size }) => (
                        <MaterialCommunityIcons name="calendar-clock" color={color} size={size} />
                    ),
                }}
            />
            <Tabs.Screen
                name="settings"
                options={{
                    title: t('tabs.settings'),
                    tabBarIcon: ({ color, size }) => (
                        <MaterialCommunityIcons name="cog-outline" color={color} size={size} />
                    ),
                }}
            />
        </Tabs>
    );
}
