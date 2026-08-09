package expo.modules.alarmsound

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * Catches the fired alarm and hands it to the foreground service.
 *
 * A `BroadcastReceiver` gets only a few seconds of runtime and must not do
 * anything slow, so it does the minimum: look the alarm up and start the
 * service that actually rings. The system holds a wake lock for the duration of
 * `onReceive`, which is what lets this work with the screen off.
 */
class AlarmReceiver : BroadcastReceiver() {

    companion object {
        const val ACTION_FIRE = "expo.modules.alarmsound.FIRE"
        const val ACTION_DISMISS = "expo.modules.alarmsound.DISMISS"
        const val ACTION_SNOOZE = "expo.modules.alarmsound.SNOOZE"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val alarmId = intent.getStringExtra(NativeAlarmScheduler.EXTRA_ALARM_ID) ?: return

        when (intent.action) {
            ACTION_FIRE -> {
                val alarm = AlarmStore.find(context, alarmId) ?: return
                startService(
                    context,
                    Intent(context, AlarmService::class.java).apply {
                        action = AlarmService.ACTION_START
                        putExtra(NativeAlarmScheduler.EXTRA_ALARM_ID, alarm.id)
                    },
                )
            }

            ACTION_DISMISS ->
                startService(
                    context,
                    Intent(context, AlarmService::class.java).apply {
                        action = AlarmService.ACTION_STOP
                        putExtra(NativeAlarmScheduler.EXTRA_ALARM_ID, alarmId)
                    },
                )

            ACTION_SNOOZE ->
                startService(
                    context,
                    Intent(context, AlarmService::class.java).apply {
                        action = AlarmService.ACTION_SNOOZE
                        putExtra(NativeAlarmScheduler.EXTRA_ALARM_ID, alarmId)
                    },
                )
        }
    }

    private fun startService(context: Context, intent: Intent) {
        // From Android 8 a background app may only start a service in the
        // foreground state, and the service must call startForeground quickly
        // or the system kills it.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }
    }
}

/**
 * Puts alarms back after a restart.
 *
 * `AlarmManager` forgets every registration on reboot. Nothing here touches
 * JavaScript, because `BOOT_COMPLETED` arrives long before any React context
 * exists.
 *
 * Note that on an encrypted device this only arrives after the user unlocks the
 * phone for the first time. A phone that reboots overnight and is not touched
 * has no alarm armed until morning, which is a real hole worth surfacing in the
 * UI rather than hiding.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        // The source is recorded verbatim rather than lumped together. A
        // package replacement fires this receiver too, and reading an install
        // as though it were a reboot makes the diagnostic actively misleading.
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED -> NativeAlarmScheduler.rearmAll(context, "boot_completed")
            Intent.ACTION_LOCKED_BOOT_COMPLETED ->
                NativeAlarmScheduler.rearmAll(context, "locked_boot")
            "android.intent.action.QUICKBOOT_POWERON" ->
                NativeAlarmScheduler.rearmAll(context, "quickboot")
            Intent.ACTION_MY_PACKAGE_REPLACED ->
                NativeAlarmScheduler.rearmAll(context, "app_updated")
        }
    }
}
