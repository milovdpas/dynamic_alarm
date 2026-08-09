import ExpoModulesCore
import AVFoundation

/**
 * iOS side of the alarm sound module.
 *
 * Deliberately thin, because iOS gives us far less to work with than Android:
 *
 *  - There is **no public API for the system alarm tones**. Apple's built-in
 *    alarm sounds are proprietary and unavailable to third-party apps, so
 *    `pickAlarmSound` has nothing to offer and returns nil. iOS must ship
 *    bundled audio instead.
 *  - There is no equivalent of `USAGE_ALARM`. The closest is an
 *    `AVAudioSession` category that ignores the mute switch, which only works
 *    while the app is running.
 *
 * When AlarmKit lands in M4 the sound is configured on the alarm itself via
 * `AlertSound`, not played from here at all. This exists so shared code can
 * call the same functions on both platforms without branching.
 */
public class AlarmSoundModule: Module {
  private var player: AVAudioPlayer?

  public func definition() -> ModuleDefinition {
    Name("AlarmSound")

    AsyncFunction("getDefaultAlarmSound") { () -> [String: String]? in
      // No system alarm tone is reachable; the caller falls back to a bundled asset.
      return nil
    }

    AsyncFunction("getSoundLabel") { (_: String) -> String in
      return "Alarm sound"
    }

    AsyncFunction("pickAlarmSound") { (_: String?) -> [String: String]? in
      // iOS exposes no ringtone picker to third-party apps.
      return nil
    }

    AsyncFunction("play") { (uri: String?, loop: Bool?, volume: Double?) in
      guard let uri, let url = URL(string: uri) else { return }

      // Ignore the ring/silent switch for as long as we are foregrounded. This
      // is nowhere near an AlarmKit guarantee, and the UI says so.
      try? AVAudioSession.sharedInstance().setCategory(.playback, options: [])
      try? AVAudioSession.sharedInstance().setActive(true)

      self.player?.stop()
      let player = try AVAudioPlayer(contentsOf: url)
      player.numberOfLoops = (loop ?? true) ? -1 : 0
      player.volume = Float(min(max(volume ?? 1.0, 0.0), 1.0))
      player.prepareToPlay()
      player.play()
      self.player = player
    }

    AsyncFunction("stop") {
      self.player?.stop()
      self.player = nil
      try? AVAudioSession.sharedInstance().setActive(false)
    }

    AsyncFunction("isPlaying") { () -> Bool in
      return self.player?.isPlaying ?? false
    }

    AsyncFunction("getAlarmVolume") { () -> [String: Any] in
      // iOS has no separate alarm stream, so there is nothing meaningful to
      // report. Claiming a value here would make the UI lie about mute state.
      return ["current": 0, "max": 0, "isMuted": false]
    }

    OnDestroy {
      self.player?.stop()
      self.player = nil
    }
  }
}
