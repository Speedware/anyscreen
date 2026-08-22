package com.anyscreen.player

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return

        val prefs = Prefs(context)
        val target = if (prefs.isPaired && prefs.serverUrl != null) {
            PlayerActivity::class.java
        } else {
            PairingActivity::class.java
        }
        context.startActivity(Intent(context, target).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
