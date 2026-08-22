package com.anyscreen.player

import android.content.Intent
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.anyscreen.player.databinding.ActivityPairingBinding

class PairingActivity : AppCompatActivity(), SocketManager.Listener {

    private lateinit var binding: ActivityPairingBinding
    private lateinit var prefs: Prefs
    private var socketManager: SocketManager? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityPairingBinding.inflate(layoutInflater)
        setContentView(binding.root)
        prefs = Prefs(this)

        binding.changeServerLink.setOnClickListener {
            socketManager?.disconnect()
            prefs.serverUrl = null
            prefs.clearCredentials()
            showServerSetup()
        }
        binding.serverUrlSubmit.setOnClickListener { submitServerUrl() }

        if (prefs.isPaired && prefs.serverUrl != null) {
            goToPlayer()
            return
        }

        if (prefs.serverUrl == null) {
            showServerSetup()
        } else {
            beginPairing()
        }
    }

    private fun showServerSetup() {
        binding.serverSetupGroup.visibility = android.view.View.VISIBLE
        binding.pairingGroup.visibility = android.view.View.GONE
        binding.statusText.text = ""
    }

    private fun submitServerUrl() {
        var url = binding.serverUrlInput.text.toString().trim()
        if (url.isEmpty()) return
        if (!url.startsWith("http://") && !url.startsWith("https://")) url = "https://$url"
        url = url.trimEnd('/')
        prefs.serverUrl = url
        binding.serverSetupGroup.visibility = android.view.View.GONE
        beginPairing()
    }

    private fun beginPairing() {
        val serverUrl = prefs.serverUrl ?: return
        binding.statusText.text = "Connecting to $serverUrl ..."
        socketManager?.disconnect()
        socketManager = SocketManager(serverUrl).also {
            it.listener = this
            it.connectForPairing()
        }
    }

    private fun goToPlayer() {
        startActivity(Intent(this, PlayerActivity::class.java))
        finish()
    }

    override fun onPairingCode(code: String) {
        binding.pairingGroup.visibility = android.view.View.VISIBLE
        renderCodeDigits(code)
        binding.statusText.text = "Waiting for pairing..."
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun renderCodeDigits(code: String) {
        val container = binding.pairingCodeContainer
        container.removeAllViews()
        for (digit in code) {
            val box = TextView(this).apply {
                text = digit.toString()
                textSize = 40f
                setTextColor(ContextCompat.getColor(this@PairingActivity, R.color.accent))
                setTypeface(typeface, Typeface.BOLD)
                gravity = Gravity.CENTER
                background = ContextCompat.getDrawable(this@PairingActivity, R.drawable.pairing_digit_box)
            }
            val params = LinearLayout.LayoutParams(dp(64), dp(84))
            params.marginEnd = dp(10)
            box.layoutParams = params
            container.addView(box)
        }
    }

    override fun onPaired(deviceId: String, token: String) {
        prefs.storeCredentials(deviceId, token)
        socketManager?.disconnect()
        goToPlayer()
    }

    override fun onPairExpired() {
        binding.statusText.text = "Pairing code expired — getting a new one..."
        beginPairing()
    }

    override fun onAuthenticated() {
        goToPlayer()
    }

    override fun onAuthError() {
        prefs.clearCredentials()
        binding.statusText.text = "Pairing expired or was revoked — restarting pairing."
        beginPairing()
    }

    override fun onPlaylistUpdate() { }

    override fun onCommand(type: String, payload: org.json.JSONObject) { }

    override fun onConnectError(message: String?) {
        binding.statusText.text = "Cannot reach server${if (message != null) ": $message" else ""}. Retrying..."
    }

    override fun onDestroy() {
        super.onDestroy()
        socketManager?.disconnect()
    }
}
