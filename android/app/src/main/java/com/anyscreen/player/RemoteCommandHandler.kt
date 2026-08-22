package com.anyscreen.player

import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.media.AudioManager
import android.os.PowerManager
import org.json.JSONObject

class RemoteCommandHandler(private val context: Context) {
    private val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
    private val adminComponent = ComponentName(context, DeviceOwnerReceiver::class.java)

    fun handle(type: String, payload: JSONObject): JSONObject {
        val result = JSONObject()
        try {
            when (type) {
                "reboot" -> handleReboot(result)
                "screen_off" -> handleScreenOff(result)
                "screen_on" -> handleScreenOn(result)
                "volume" -> handleVolume(payload, result)
                else -> {
                    result.put("ok", false)
                    result.put("error", "Unknown command: $type")
                }
            }
        } catch (e: Exception) {
            result.put("ok", false)
            result.put("error", e.message ?: "unknown error")
        }
        return result
    }

    private fun handleReboot(result: JSONObject) {
        if (!dpm.isDeviceOwnerApp(context.packageName)) {
            result.put("ok", false)
            result.put("error", "Not provisioned as Device Owner — cannot reboot. See android/README.md.")
            return
        }
        result.put("ok", true)
        dpm.reboot(adminComponent)
    }

    private fun handleScreenOff(result: JSONObject) {
        if (!dpm.isAdminActive(adminComponent)) {
            result.put("ok", false)
            result.put("error", "Device admin is not active — cannot lock the screen. See android/README.md.")
            return
        }
        dpm.lockNow()
        result.put("ok", true)
    }

    private fun handleScreenOn(result: JSONObject) {
        val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        @Suppress("DEPRECATION")
        val wakeLock = powerManager.newWakeLock(
            PowerManager.FULL_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP or PowerManager.ON_AFTER_RELEASE,
            "Anyscreen:ScreenOn"
        )
        wakeLock.acquire(10_000)
        result.put("ok", true)
    }

    private fun handleVolume(payload: JSONObject, result: JSONObject) {
        val level = payload.optInt("level", -1)
        if (level !in 0..100) {
            result.put("ok", false)
            result.put("error", "payload.level must be 0-100")
            return
        }
        val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val max = audioManager.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
        audioManager.setStreamVolume(AudioManager.STREAM_MUSIC, level * max / 100, 0)
        result.put("ok", true)
    }
}
