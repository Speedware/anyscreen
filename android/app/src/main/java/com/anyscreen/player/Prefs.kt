package com.anyscreen.player

import android.content.Context
import android.content.SharedPreferences

class Prefs(context: Context) {
    private val sp: SharedPreferences =
        context.getSharedPreferences("anyscreen_prefs", Context.MODE_PRIVATE)

    var serverUrl: String?
        get() = sp.getString(KEY_SERVER_URL, DEFAULT_SERVER_URL)
        set(value) = sp.edit().putString(KEY_SERVER_URL, value).apply()

    var deviceId: String?
        get() = sp.getString(KEY_DEVICE_ID, null)
        set(value) = sp.edit().putString(KEY_DEVICE_ID, value).apply()

    var deviceToken: String?
        get() = sp.getString(KEY_DEVICE_TOKEN, null)
        set(value) = sp.edit().putString(KEY_DEVICE_TOKEN, value).apply()

    val isPaired: Boolean
        get() = deviceId != null && deviceToken != null

    var schedulePlanJson: String?
        get() = sp.getString(KEY_SCHEDULE_PLAN, null)
        set(value) = sp.edit().putString(KEY_SCHEDULE_PLAN, value).apply()

    fun storeCredentials(deviceId: String, token: String) {
        sp.edit()
            .putString(KEY_DEVICE_ID, deviceId)
            .putString(KEY_DEVICE_TOKEN, token)
            .apply()
    }

    fun clearCredentials() {
        sp.edit().remove(KEY_DEVICE_ID).remove(KEY_DEVICE_TOKEN).apply()
    }

    companion object {
        private const val DEFAULT_SERVER_URL = "https://anyscreen.speedware.tech"
        private const val KEY_SERVER_URL = "server_url"
        private const val KEY_DEVICE_ID = "device_id"
        private const val KEY_DEVICE_TOKEN = "device_token"
        private const val KEY_SCHEDULE_PLAN = "schedule_plan_json"
    }
}
