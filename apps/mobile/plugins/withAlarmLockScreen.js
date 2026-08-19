const { withAndroidManifest, withMainActivity, AndroidConfig } = require('expo/config-plugins');

const PACKAGE = 'expo.modules.alarmsound';
const SPECIAL_USE_SUBTYPE_PROPERTY = 'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE';

/**
 * Registers the native alarm chain and lets it take over the lock screen.
 *
 * Two separate jobs, both of which must survive `expo prebuild` regenerating
 * `android/`, which is why they live in a config plugin rather than in the
 * manifest directly.
 *
 * **Lock screen, and only for the alarm.** A full-screen intent only *launches*
 * an activity, it does not grant it the right to appear above the keyguard.
 * Without `showWhenLocked` and `turnScreenOn`, Android starts MainActivity
 * behind the lock screen: the alarm rings but nothing is visible until the phone
 * is unlocked by hand. This is precisely what separates our alarm from the
 * system Clock app.
 *
 * Those two were manifest attributes until 2026-08-19, which granted them to
 * MainActivity permanently. The effect is easy to miss and hard to accept once
 * seen: with the app in the foreground, locking the phone showed the app instead
 * of the lock screen, so anybody who picked up a locked phone could read
 * somebody's schedules, addresses and wake times without unlocking it.
 *
 * They are set at runtime instead, from the launch intent, so they are true for
 * an alarm and false for every other way into the app. In `onCreate` rather than
 * from JavaScript, because the alarm case has to be right before the first frame
 * is drawn, including when the process was dead a moment earlier.
 *
 * **The alarm chain.** `AlarmManager` fires a broadcast to `AlarmReceiver`,
 * which starts `AlarmService` to play the tone. Neither exists unless declared
 * here, and an undeclared receiver fails silently at 06:53 rather than at build
 * time.
 */
const withAlarmLockScreen = (config) =>
    withLockScreenOnlyForAlarms(withAndroidManifest(config, (androidConfig) => {
        const manifest = androidConfig.modResults;
        const mainActivity = AndroidConfig.Manifest.getMainActivityOrThrow(manifest);

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
    }));


/** The extra `AlarmService` puts on the intent it launches the app with. */
const RINGING_EXTRA = 'alarmRinging';

const LOCK_SCREEN_METHOD = `
  /**
   * Shows this activity over the lock screen, but only for an alarm.
   *
   * Granted in the manifest until 2026-08-19, which meant the app was drawn
   * above the keyguard whenever it happened to be in the foreground: locking the
   * phone showed the app rather than the lock screen, and a locked phone read
   * out somebody's schedule to anyone who picked it up.
   *
   * Read from the intent rather than asked of JavaScript, because when the alarm
   * fires with the process dead this has to be true before the first frame, and
   * a React bridge that is still starting cannot answer in time.
   */
  private fun applyLockScreenFlags(launchIntent: android.content.Intent?) {
    val ringing = launchIntent?.getBooleanExtra("${RINGING_EXTRA}", false) == true
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(ringing)
      setTurnScreenOn(ringing)
    }
  }

  override fun onNewIntent(newIntent: android.content.Intent) {
    super.onNewIntent(newIntent)
    // An alarm arriving while the app is already open comes through here rather
    // than onCreate, and it needs the same treatment.
    applyLockScreenFlags(newIntent)
  }
`;

/**
 * Teaches MainActivity to take the lock screen only when an alarm sent it there.
 *
 * `android/` is generated, so this is a plugin rather than an edit: a hand
 * change survives until the next prebuild and then disappears, and what it takes
 * with it is the difference between an alarm that covers the lock screen and one
 * nobody can see.
 */
const withLockScreenOnlyForAlarms = (config) =>
    withMainActivity(config, (mainActivityConfig) => {
        let contents = mainActivityConfig.modResults.contents;

        if (contents.includes('applyLockScreenFlags')) {
            return mainActivityConfig;
        }

        const anchor = '    super.onCreate(null)\n  }';
        if (!contents.includes(anchor)) {
            // Loud, because the silent version of this failure is an alarm that
            // rings behind the lock screen with nothing on the screen to stop it.
            console.warn(
                '[withAlarmLockScreen] Could not find onCreate in MainActivity. The alarm ' +
                    'will ring without covering the lock screen.',
            );
            return mainActivityConfig;
        }

        contents = contents.replace(
            anchor,
            `    super.onCreate(null)\n    applyLockScreenFlags(intent)\n  }\n${LOCK_SCREEN_METHOD}`,
        );

        mainActivityConfig.modResults.contents = contents;
        return mainActivityConfig;
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
