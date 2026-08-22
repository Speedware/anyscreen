package com.anyscreen.player

import android.os.Handler
import android.os.Looper
import io.socket.client.IO
import io.socket.client.Socket
import io.socket.emitter.Emitter
import org.json.JSONObject

class SocketManager(private val serverUrl: String) {

    interface Listener {
        fun onPairingCode(code: String)
        fun onPaired(deviceId: String, token: String)
        fun onPairExpired()
        fun onAuthenticated()
        fun onAuthError()
        fun onPlaylistUpdate()
        fun onCommand(type: String, payload: JSONObject)
        fun onConnectError(message: String?)
    }

    private var socket: Socket? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private var pairCheckRunnable: Runnable? = null
    var listener: Listener? = null

    private fun startPairCheck() {
        stopPairCheck()
        val runnable = object : Runnable {
            override fun run() {
                socket?.emit("pair:check")
                mainHandler.postDelayed(this, PAIR_CHECK_INTERVAL_MS)
            }
        }
        pairCheckRunnable = runnable
        mainHandler.postDelayed(runnable, PAIR_CHECK_INTERVAL_MS)
    }

    private fun stopPairCheck() {
        pairCheckRunnable?.let { mainHandler.removeCallbacks(it) }
        pairCheckRunnable = null
    }

    private fun runOnMain(block: () -> Unit) = mainHandler.post(block)

    private fun open(auth: Map<String, String>) {
        val options = IO.Options()
        options.auth = auth
        options.reconnection = true
        options.reconnectionDelay = 2000
        socket = IO.socket("$serverUrl/device", options)
        registerHandlers()
        socket?.connect()
    }

    fun connectForPairing(kind: String = "android") {
        open(mapOf("kind" to kind))
    }

    fun connectAuthenticated(deviceId: String, token: String) {
        open(mapOf("deviceId" to deviceId, "token" to token))
    }

    private fun registerHandlers() {
        socket?.on("pair:code", Emitter.Listener { args ->
            val data = args.getOrNull(0) as? JSONObject ?: return@Listener
            runOnMain {
                listener?.onPairingCode(data.optString("code"))
                startPairCheck()
            }
        })
        socket?.on("pair:expired", Emitter.Listener {
            runOnMain {
                stopPairCheck()
                listener?.onPairExpired()
            }
        })
        socket?.on("pair:success", Emitter.Listener { args ->
            val data = args.getOrNull(0) as? JSONObject ?: return@Listener
            runOnMain {
                stopPairCheck()
                listener?.onPaired(data.optString("deviceId"), data.optString("token"))
            }
        })
        socket?.on("authenticated", Emitter.Listener {
            runOnMain { listener?.onAuthenticated() }
        })
        socket?.on("auth:error", Emitter.Listener {
            runOnMain { listener?.onAuthError() }
        })
        socket?.on("playlist:update", Emitter.Listener {
            runOnMain { listener?.onPlaylistUpdate() }
        })
        socket?.on("command", Emitter.Listener { args ->
            val data = args.getOrNull(0) as? JSONObject ?: return@Listener
            runOnMain { listener?.onCommand(data.optString("type"), data.optJSONObject("payload") ?: JSONObject()) }
        })
        socket?.on(Socket.EVENT_CONNECT_ERROR, Emitter.Listener { args ->
            runOnMain { listener?.onConnectError(args.getOrNull(0)?.toString()) }
        })
    }

    fun sendHeartbeat(itemName: String?, itemType: String?, playing: Boolean, telemetry: JSONObject) {
        val payload = JSONObject()
        payload.put("itemName", itemName)
        payload.put("itemType", itemType)
        payload.put("playing", playing)
        payload.put("telemetry", telemetry)
        socket?.emit("heartbeat", payload)
    }

    fun sendPreview(url: String) {
        val payload = JSONObject()
        payload.put("url", url)
        socket?.emit("preview", payload)
    }

    fun sendPreviewSite(domain: String) {
        val payload = JSONObject()
        payload.put("site", domain)
        socket?.emit("preview", payload)
    }

    fun sendCommandAck(type: String, result: JSONObject) {
        val payload = JSONObject(result.toString())
        payload.put("type", type)
        socket?.emit("command:ack", payload)
    }

    fun disconnect() {
        stopPairCheck()
        socket?.disconnect()
        socket?.off()
        socket = null
    }

    companion object {
        private const val PAIR_CHECK_INTERVAL_MS = 30000L
    }
}
