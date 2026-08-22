package com.anyscreen.player

import android.app.ActivityManager
import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiManager
import android.os.StatFs
import org.json.JSONObject
import kotlin.math.roundToInt

class TelemetryReporter(private val context: Context) {

    fun collect(): JSONObject {
        val json = JSONObject()

        try {
            val stat = StatFs(context.filesDir.path)
            val freeGb = (stat.availableBytes / (1024.0 * 1024.0 * 1024.0) * 10).roundToInt() / 10.0
            json.put("storageFreeGb", freeGb)
        } catch (e: Exception) { }

        try {
            val activityManager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            val info = ActivityManager.MemoryInfo()
            activityManager.getMemoryInfo(info)
            json.put("ramFreeMb", info.availMem / (1024 * 1024))
        } catch (e: Exception) { }

        collectConnection(json)

        return json
    }

    @Suppress("DEPRECATION")
    private fun collectConnection(json: JSONObject) {
        try {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            val network = cm.activeNetwork ?: return
            val caps = cm.getNetworkCapabilities(network) ?: return

            when {
                caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> {
                    json.put("connectionType", "ethernet")
                }
                caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> {
                    json.put("connectionType", "wifi")
                    val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
                    val rssi = wifiManager.connectionInfo?.rssi
                    if (rssi != null && rssi != 0) {
                        val level = WifiManager.calculateSignalLevel(rssi, 5)
                        json.put("wifiSignalLevel", level)
                    }
                }
            }
        } catch (e: Exception) { }
    }
}
