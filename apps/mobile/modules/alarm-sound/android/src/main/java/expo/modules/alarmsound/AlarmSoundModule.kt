package expo.modules.alarmsound

import android.app.Activity
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val RINGTONE_PICKER_REQUEST_CODE = 8021

/**
 * Alarm audio and ringtone selection for Android.
 *
 * Two jobs neither Expo nor notify-kit covers:
 *
 *  1. **The system ringtone picker.** Android exposes the user's own alarm tones
 *     through `ACTION_RINGTONE_PICKER`, so the app never has to bundle or
 *     enumerate sounds, it shows the OS's own list and gets back a URI.
 *
 *  2. **Playback on the alarm stream.** `expo-audio` cannot set Android audio
 *     usage, so it plays on the media stream: silenced by the media volume
 *     slider and suppressed by Do Not Disturb. `USAGE_ALARM` is what makes the
 *     sound behave like an alarm instead of like a podcast.
 */
class AlarmSoundModule : Module() {
  private var mediaPlayer: MediaPlayer? = null
  private var pickerPromise: Promise? = null

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("AlarmSound")

    /**
     * Re-arms on every app start, not only on `BOOT_COMPLETED`.
     *
     * Boot broadcasts are less dependable than they look. An app in the stopped
     * state receives none at all until it is launched by hand, delivery can be
     * deferred by App Standby, and OEM ROMs vary. Relying on that single signal
     * means an alarm can quietly cease to exist with nothing to say so.
     *
     * Re-arming here is cheap and idempotent: `setAlarmClock` with the same
     * PendingIntent replaces rather than duplicates, and an alarm already moved
     * to the missed list is not seen twice.
     */
    OnCreate { NativeAlarmScheduler.rearmAll(context, "app") }

    AsyncFunction("getDefaultAlarmSound") {
      val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
        ?: return@AsyncFunction null
      mapOf("uri" to uri.toString(), "label" to titleFor(uri))
    }

    AsyncFunction("getSoundLabel") { uri: String ->
      titleFor(Uri.parse(uri))
    }

    AsyncFunction("pickAlarmSound") { currentUri: String?, promise: Promise ->
      val activity = appContext.currentActivity
        ?: throw Exceptions.MissingActivity()

      // Only one picker can be open at a time; resolve any earlier caller as
      // cancelled rather than leaving its promise dangling forever.
      pickerPromise?.resolve(null)
      pickerPromise = promise

      val intent = Intent(RingtoneManager.ACTION_RINGTONE_PICKER).apply {
        putExtra(RingtoneManager.EXTRA_RINGTONE_TYPE, RingtoneManager.TYPE_ALARM)
        putExtra(RingtoneManager.EXTRA_RINGTONE_TITLE, "Alarm sound")
        putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_DEFAULT, true)
        // No silent option, a silent alarm is not a thing this app offers.
        putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_SILENT, false)
        putExtra(
          RingtoneManager.EXTRA_RINGTONE_DEFAULT_URI,
          RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
        )
        if (currentUri != null) {
          putExtra(RingtoneManager.EXTRA_RINGTONE_EXISTING_URI, Uri.parse(currentUri))
        }
      }
      activity.startActivityForResult(intent, RINGTONE_PICKER_REQUEST_CODE)
    }

    /**
     * @param uri     Sound to play; null falls back to the device's default alarm.
     * @param loop    Alarms loop until dismissed, the default.
     * @param volume  0..1, applied on top of the system alarm volume.
     */
    AsyncFunction("play") { uri: String?, loop: Boolean?, volume: Double? ->
      val soundUri = uri?.takeIf { it.isNotBlank() }?.let { Uri.parse(it) }
        ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
        ?: throw IllegalStateException("No alarm sound available on this device")

      stopInternal()

      mediaPlayer = MediaPlayer().apply {
        setAudioAttributes(
          AudioAttributes.Builder()
            // The two lines that make this an alarm: audible through Do Not
            // Disturb and governed by the alarm volume, not the media volume.
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        )
        setDataSource(context, soundUri)
        isLooping = loop ?: true
        val level = (volume ?: 1.0).coerceIn(0.0, 1.0).toFloat()
        setVolume(level, level)
        prepare()
        start()
      }
    }

    AsyncFunction("stop") {
      stopInternal()
    }

    AsyncFunction("isPlaying") {
      mediaPlayer?.isPlaying == true
    }

    /**
     * Arms an alarm that survives the app being killed or the phone rebooting.
     *
     * Everything needed to ring is written to disk here, because at fire time
     * there is no JavaScript to ask. See {@link AlarmService}.
     */
    AsyncFunction("scheduleAlarm") { config: Map<String, Any?> ->
      val id = config["id"] as? String ?: throw IllegalArgumentException("alarm id is required")
      val triggerAt =
        (config["triggerAtMillis"] as? Number)?.toLong()
          ?: throw IllegalArgumentException("triggerAtMillis is required")

      NativeAlarmScheduler.schedule(
        context,
        StoredAlarm(
          id = id,
          triggerAtMillis = triggerAt,
          title = config["title"] as? String ?: "",
          body = config["body"] as? String ?: "",
          soundUri = (config["soundUri"] as? String)?.takeIf { it.isNotBlank() },
          occurrenceId = (config["occurrenceId"] as? String)?.takeIf { it.isNotBlank() },
          dismissLabel = config["dismissLabel"] as? String ?: "",
          snoozeLabel = (config["snoozeLabel"] as? String)?.takeIf { it.isNotBlank() },
          missedTitle = config["missedTitle"] as? String ?: "",
          missedBody = config["missedBody"] as? String ?: "",
        ),
      )
    }

    AsyncFunction("cancelAlarm") { id: String -> NativeAlarmScheduler.cancel(context, id) }

    AsyncFunction("cancelAllAlarms") { NativeAlarmScheduler.cancelAll(context) }

    /** Ids the system currently holds, read back from the durable store. */
    AsyncFunction("getScheduledAlarmIds") { AlarmStore.all(context).map { it.id } }

    /**
     * Alarms that were due while the device was off, and so never rang.
     *
     * The app reads these on launch so it can say what happened, rather than
     * leaving the user to work out for themselves why a morning was silent.
     */
    AsyncFunction("getMissedAlarms") {
      AlarmStore.missed(context).map { alarm ->
        mapOf(
          "id" to alarm.id,
          "triggerAtMillis" to alarm.triggerAtMillis,
          "title" to alarm.title,
          "occurrenceId" to alarm.occurrenceId,
        )
      }
    }

    AsyncFunction("clearMissedAlarms") { AlarmStore.clearMissed(context) }

    /** Whether the boot receiver has ever actually run, and what it did. */
    AsyncFunction("getAlarmDiagnostics") { AlarmStore.diagnostics(context) }

    /**
     * Whether the app is exempt from battery optimisation.
     *
     * A restricted app can be denied broadcasts, including `BOOT_COMPLETED`,
     * which is how an alarm silently stops surviving a reboot. `setAlarmClock`
     * is already exempt from Doze, so this is about the app being alive to
     * re-arm at all, not about the alarm itself being deferred.
     */
    AsyncFunction("isIgnoringBatteryOptimizations") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
        true
      } else {
        val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        power.isIgnoringBatteryOptimizations(context.packageName)
      }
    }

    /**
     * Opens the system prompt asking for that exemption.
     *
     * Play restricts `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` to apps with a core
     * need for it. An alarm clock is the textbook qualifying case.
     */
    AsyncFunction("requestIgnoreBatteryOptimizations") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        val intent =
          Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
            data = Uri.parse("package:${context.packageName}")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          }
        context.startActivity(intent)
      }
    }

    /**
     * Whether an alarm is sounding right now, and which one.
     *
     * The app asks this on launch and on resume. A full-screen intent starts the
     * activity directly rather than through a notification press, so this is the
     * only reliable way to know we were opened because something is ringing.
     */
    AsyncFunction("getRingingAlarm") {
      val id = AlarmService.ringingAlarmId
      if (id == null) {
        null
      } else {
        mapOf("alarmId" to id, "isRinging" to AlarmService.isRinging)
      }
    }

    AsyncFunction("stopRingingAlarm") { id: String ->
      context.startService(
        Intent(context, AlarmService::class.java).apply {
          action = AlarmService.ACTION_STOP
          putExtra(NativeAlarmScheduler.EXTRA_ALARM_ID, id)
        }
      )
    }

    AsyncFunction("snoozeRingingAlarm") { id: String ->
      context.startService(
        Intent(context, AlarmService::class.java).apply {
          action = AlarmService.ACTION_SNOOZE
          putExtra(NativeAlarmScheduler.EXTRA_ALARM_ID, id)
        }
      )
    }

    AsyncFunction("canScheduleExactAlarms") {
      NativeAlarmScheduler.canScheduleExactAlarms(context)
    }

    AsyncFunction("openExactAlarmSettings") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val intent =
          Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).apply {
            data = Uri.parse("package:${context.packageName}")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          }
        context.startActivity(intent)
      }
    }

    /**
     * Whether this app may launch a full-screen activity over the lock screen.
     *
     * Android 14 turned `USE_FULL_SCREEN_INTENT` from an install-time grant into
     * something only calling and alarm apps keep, and for anything installed
     * outside the Play Store, it commonly starts denied. Without it the alarm
     * degrades to a notification with no way to tell the user why, so we check
     * explicitly rather than discovering it at 06:53.
     *
     * Always true below API 34, where the permission is granted at install.
     */
    // Expressed as if/else rather than an early `return@AsyncFunction`: the
    // lambda's return type is inferred through a reified generic, and labelled
    // returns make that inference needlessly fragile.
    AsyncFunction("canUseFullScreenIntent") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        val manager =
          context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.canUseFullScreenIntent()
      } else {
        // Below API 34 the permission is granted at install time.
        true
      }
    }

    /** Opens the system screen where the user grants the above. */
    AsyncFunction("openFullScreenIntentSettings") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        val intent = Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT).apply {
          data = Uri.parse("package:${context.packageName}")
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
      }
    }

    /**
     * Sends the app to the background, revealing whatever was behind it.
     *
     * Used when the alarm took over the screen rather than being opened by the
     * user. After dismissing, the phone should go back to the lock screen it
     * was showing, not strand the user on our home screen. `moveTaskToBack`
     * rather than `finish()` so app state survives for the next alarm.
     *
     * Must run on the UI thread; Expo dispatches AsyncFunction bodies off it.
     */
    AsyncFunction("moveAppToBackground") {
      val activity = appContext.currentActivity
      if (activity != null) {
        activity.runOnUiThread { activity.moveTaskToBack(true) }
      }
    }

    /** Whether the alarm stream is audible at all, a muted alarm wakes nobody. */
    AsyncFunction("getAlarmVolume") {
      val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      val current = audioManager.getStreamVolume(AudioManager.STREAM_ALARM)
      val max = audioManager.getStreamMaxVolume(AudioManager.STREAM_ALARM)
      mapOf(
        "current" to current,
        "max" to max,
        "isMuted" to (current == 0)
      )
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != RINGTONE_PICKER_REQUEST_CODE) {
        return@OnActivityResult
      }
      val promise = pickerPromise ?: return@OnActivityResult
      pickerPromise = null

      if (payload.resultCode != Activity.RESULT_OK) {
        promise.resolve(null)
        return@OnActivityResult
      }
      val picked: Uri? = payload.data?.getParcelableExtra(
        RingtoneManager.EXTRA_RINGTONE_PICKED_URI
      )
      if (picked == null) {
        promise.resolve(null)
      } else {
        promise.resolve(mapOf("uri" to picked.toString(), "label" to titleFor(picked)))
      }
    }

    // Never leave a MediaPlayer holding the alarm stream after teardown.
    OnDestroy {
      stopInternal()
    }
  }

  private fun stopInternal() {
    mediaPlayer?.let { player ->
      runCatching {
        if (player.isPlaying) {
          player.stop()
        }
      }
      player.release()
    }
    mediaPlayer = null
  }

  private fun titleFor(uri: Uri): String =
    runCatching { RingtoneManager.getRingtone(context, uri)?.getTitle(context) }
      .getOrNull() ?: "Alarm sound"
}
