const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

const PACKAGE = 'expo.modules.alarmsound';
const SPECIAL_USE_SUBTYPE_PROPERTY = 'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE';

/**
 * Registers the native alarm chain and lets it take over the lock screen.
 *
 * Two separate jobs, both of which must survive `expo prebuild` regenerating
 * `android/`, which is why they live in a config plugin rather than in the
 * manifest directly.
 *
 * **Lock screen.** A full-screen intent only *launches* an activity, it does not
 * grant it the right to appear above the keyguard. Without `showWhenLocked` and
 * `turnScreenOn`, Android starts MainActivity behind the lock screen: the alarm
 * rings but nothing is visible until the phone is unlocked by hand. This is
 * precisely what separates our alarm from the system Clock app.
 *
 * **The alarm chain.** `AlarmManager` fires a broadcast to `AlarmReceiver`,
 * which starts `AlarmService` to play the tone. Neither exists unless declared
 * here, and an undeclared receiver fails silently at 06:53 rather than at build
 * time.
 */
const withAlarmLockScreen = (config) =>
    withAndroidManifest(config, (androidConfig) => {
        const manifest = androidConfig.modResults;
        const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(manifest);

        mainActivity.$['android:showWhenLocked'] = 'true';
        mainActivity.$['android:turnScreenOn'] = 'true';

        const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);

        application.receiver = upsert(application.receiver, `${PACKAGE}.AlarmReceiver`, {
            'android:name': `${PACKAGE}.AlarmReceiver`,
            // Only our own AlarmManager intents reach it.
            'android:exported': 'false',
            'android:enabled': 'true',
        });

        application.receiver = upsert(application.receiver, `${PACKAGE}.BootReceiver`, {
            'android:name': `${PACKAGE}.BootReceiver`,
            // The system delivers BOOT_COMPLETED, so this one must be exported.
            'android:exported': 'true',
            'android:enabled': 'true',
            'android:directBootAware': 'false',
        });

        const bootReceiver = application.receiver.find(
            (entry) => entry.$['android:name'] === `${PACKAGE}.BootReceiver`,
        );
        bootReceiver['intent-filter'] = [
            {
                action: [
                    { $: { 'android:name': 'android.intent.action.BOOT_COMPLETED' } },
                    { $: { 'android:name': 'android.intent.action.QUICKBOOT_POWERON' } },
                    { $: { 'android:name': 'android.intent.action.MY_PACKAGE_REPLACED' } },
                ],
            },
        ];

        application.service = upsert(application.service, `${PACKAGE}.AlarmService`, {
            'android:name': `${PACKAGE}.AlarmService`,
            'android:exported': 'false',
            // `specialUse` is the honest classification for an alarm clock.
            // `mediaPlayback` would also work and is what several alarm apps
            // declare, but it is meant for user-initiated media and would be a
            // misdeclaration on a Play listing.
            'android:foregroundServiceType': 'specialUse',
        });

        const alarmService = application.service.find(
            (entry) => entry.$['android:name'] === `${PACKAGE}.AlarmService`,
        );
        alarmService.property = [
            {
                $: {
                    'android:name': SPECIAL_USE_SUBTYPE_PROPERTY,
                    'android:value': 'alarm',
                },
            },
        ];

        return androidConfig;
    });

/** Replaces an entry with the same `android:name`, or appends it. */
function upsert(entries, name, attributes) {
    const list = Array.isArray(entries) ? entries : [];
    const existing = list.find((entry) => entry.$ && entry.$['android:name'] === name);
    if (existing) {
        existing.$ = { ...existing.$, ...attributes };
        return list;
    }
    return [...list, { $: attributes }];
}

module.exports = withAlarmLockScreen;
