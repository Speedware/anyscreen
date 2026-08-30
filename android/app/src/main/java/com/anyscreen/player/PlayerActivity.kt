package com.anyscreen.player

import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.view.TextureView
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import androidx.appcompat.app.AppCompatActivity
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import coil.ImageLoader
import coil.decode.GifDecoder
import coil.load
import com.anyscreen.player.databinding.ActivityPlayerBinding
import okhttp3.Call
import okhttp3.Callback
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException

class PlayerActivity : AppCompatActivity(), SocketManager.Listener {

    private lateinit var binding: ActivityPlayerBinding
    private lateinit var prefs: Prefs
    private lateinit var contentCache: ContentCache
    private lateinit var telemetryReporter: TelemetryReporter
    private lateinit var remoteCommandHandler: RemoteCommandHandler
    private val httpClient = OkHttpClient()
    private val mainHandler = Handler(Looper.getMainLooper())

    private val imageLoader by lazy {
        ImageLoader.Builder(this)
            .components { add(GifDecoder.Factory()) }
            .build()
    }

    private var socketManager: SocketManager? = null
    private var exoPlayer: ExoPlayer? = null
    private var playlist: Playlist? = null
    private var currentIndex = 0
    private var lastItem: PlaylistItem? = null
    private var advanceRunnable: Runnable? = null
    private var videoWatchdogRunnable: Runnable? = null
    private var appliedRotation: Int? = null
    private var lastVideoPositionMs: Long? = null
    private var currentVisibleView: View? = null
    private var schedulePlan: SchedulePlan? = null
    private var activeScheduleId: String? = null
    private val heartbeatRunnable = object : Runnable {
        override fun run() {
            sendHeartbeat()
            mainHandler.postDelayed(this, HEARTBEAT_INTERVAL_MS)
        }
    }
    private val previewRunnable = object : Runnable {
        override fun run() {
            capturePreview()
            mainHandler.postDelayed(this, PREVIEW_INTERVAL_MS)
        }
    }
    private val scheduleEvalRunnable = object : Runnable {
        override fun run() {
            reevaluateScheduleIfChanged()
            mainHandler.postDelayed(this, SCHEDULE_EVAL_INTERVAL_MS)
        }
    }

    private fun sendHeartbeat() {
        val telemetry = telemetryReporter.collect()
        val cacheSummary = contentCache.cacheSummary(playlist?.items ?: emptyList())
        cacheSummary.keys().forEach { key -> telemetry.put(key, cacheSummary.get(key)) }
        socketManager?.sendHeartbeat(lastItem?.name, lastItem?.type, computePlaying(), telemetry)
    }

    private fun sendBitmapPreview(bitmap: Bitmap) {
        val stream = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, 50, stream)
        val base64 = Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP)
        socketManager?.sendPreview("data:image/jpeg;base64,$base64")
    }

    private fun capturePreview() {
        val item = lastItem ?: return
        when (item.type) {
            "image" -> {
                val imageView = binding.imageView
                if (imageView.drawable == null || imageView.width == 0 || imageView.height == 0) return
                try {
                    val bitmap = Bitmap.createBitmap(320, 180, Bitmap.Config.ARGB_8888)
                    val canvas = android.graphics.Canvas(bitmap)
                    canvas.scale(320f / imageView.width, 180f / imageView.height)
                    imageView.draw(canvas)
                    sendBitmapPreview(bitmap)
                } catch (e: Exception) {
                }
            }
            "video" -> {
                val textureView = binding.videoView.videoSurfaceView as? TextureView ?: return
                if (!textureView.isAvailable) return
                try {
                    val bitmap = textureView.getBitmap(320, 180) ?: return
                    sendBitmapPreview(bitmap)
                } catch (e: Exception) {
                }
            }
            "website" -> {
                val domain = try { Uri.parse(item.url).host ?: item.url } catch (e: Exception) { item.url }
                socketManager?.sendPreviewSite(domain)
            }
        }
    }

    private fun computePlaying(): Boolean {
        if (binding.videoView.visibility != View.VISIBLE) return true
        val player = exoPlayer ?: return true
        val position = player.currentPosition
        if (lastVideoPositionMs == null) {
            lastVideoPositionMs = position
            return true
        }
        val stalled = !player.isPlaying || position == lastVideoPositionMs
        lastVideoPositionMs = position
        return !stalled
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        binding = ActivityPlayerBinding.inflate(layoutInflater)
        setContentView(binding.root)
        applyImmersiveMode()

        prefs = Prefs(this)
        val deviceId = prefs.deviceId
        val token = prefs.deviceToken
        val serverUrl = prefs.serverUrl
        if (deviceId == null || token == null || serverUrl == null) {
            startActivity(Intent(this, PairingActivity::class.java))
            finish()
            return
        }

        contentCache = ContentCache(this)
        telemetryReporter = TelemetryReporter(this)
        remoteCommandHandler = RemoteCommandHandler(this)

        binding.webView.settings.javaScriptEnabled = true

        exoPlayer = ExoPlayer.Builder(this).build().also { player ->
            binding.videoView.player = player
            player.addListener(object : Player.Listener {
                override fun onPlaybackStateChanged(state: Int) {
                    if (state == Player.STATE_ENDED) {
                        clearVideoWatchdog()
                        advance()
                    } else if (state == Player.STATE_READY) {
                        reveal(binding.videoView)
                        val duration = player.duration
                        if (duration != C.TIME_UNSET && duration > 0) {
                            scheduleVideoWatchdog(duration + VIDEO_STALL_GRACE_MS)
                        }
                    }
                }

                override fun onPlayerError(error: PlaybackException) {
                    clearVideoWatchdog()
                    scheduleAdvance(3000)
                }
            })
        }

        prefs.schedulePlanJson?.let { json ->
            try {
                applySchedulePlan(SchedulePlan.fromResponse(json, serverUrl))
            } catch (e: Exception) {
            }
        }
        mainHandler.removeCallbacks(scheduleEvalRunnable)
        mainHandler.post(scheduleEvalRunnable)

        socketManager = SocketManager(serverUrl).also {
            it.listener = this
            it.connectAuthenticated(deviceId, token)
        }
    }

    private fun applyImmersiveMode() {
        @Suppress("DEPRECATION")
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
                View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            )
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        prefs.serverUrl = null
        prefs.clearCredentials()
        startActivity(Intent(this, PairingActivity::class.java))
        finish()
    }

    override fun onPairingCode(code: String) { }

    override fun onPaired(deviceId: String, token: String) { }

    override fun onPairExpired() { }

    override fun onAuthenticated() {
        fetchSchedulePlan()
        mainHandler.removeCallbacks(heartbeatRunnable)
        mainHandler.post(heartbeatRunnable)
        mainHandler.removeCallbacks(previewRunnable)
        mainHandler.post(previewRunnable)
    }

    override fun onAuthError() {
        prefs.clearCredentials()
        startActivity(Intent(this, PairingActivity::class.java))
        finish()
    }

    override fun onPlaylistUpdate() {
        fetchSchedulePlan()
    }

    override fun onCommand(type: String, payload: JSONObject) {
        when (type) {
            "refresh" -> {
                socketManager?.sendCommandAck(type, JSONObject().put("ok", true))
                mainHandler.post { recreate() }
            }
            "clear_cache" -> {
                contentCache.clearAll()
                socketManager?.sendCommandAck(type, JSONObject().put("ok", true))
                mainHandler.post { fetchSchedulePlan() }
            }
            else -> {
                val result = remoteCommandHandler.handle(type, payload)
                socketManager?.sendCommandAck(type, result)
            }
        }
    }

    override fun onConnectError(message: String?) { }

    private fun fetchSchedulePlan() {
        val serverUrl = prefs.serverUrl ?: return
        val token = prefs.deviceToken ?: return
        val request = Request.Builder()
            .url("$serverUrl/api/devices/me/schedule-plan")
            .addHeader("Authorization", "Device $token")
            .build()

        httpClient.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
            }

            override fun onResponse(call: Call, response: Response) {
                val body = response.body?.string() ?: return
                val parsed = try { SchedulePlan.fromResponse(body, serverUrl) } catch (e: Exception) { null } ?: return
                prefs.schedulePlanJson = body
                mainHandler.post { applySchedulePlan(parsed) }
            }
        })
    }

    private fun applySchedulePlan(plan: SchedulePlan) {
        schedulePlan = plan
        applyRotation(plan.rotation)
        applyAutoscale(plan.autoscale)
        plan.default?.let { contentCache.prefetch(it.items) }
        plan.schedules.forEach { it.playable?.let { p -> contentCache.prefetch(p.items) } }

        val (scheduleId, resolved) = plan.resolveNow()
        activeScheduleId = scheduleId
        playlist = resolved
        currentIndex = 0
        playCurrent()
    }

    private fun reevaluateScheduleIfChanged() {
        val plan = schedulePlan ?: return
        val (scheduleId, resolved) = plan.resolveNow()
        if (scheduleId == activeScheduleId) return
        activeScheduleId = scheduleId
        playlist = resolved
        currentIndex = 0
        playCurrent()
    }

    private fun applyRotation(degrees: Int) {
        if (appliedRotation == degrees) return
        appliedRotation = degrees

        val container = binding.contentContainer
        val metrics = resources.displayMetrics
        val screenWidth = metrics.widthPixels
        val screenHeight = metrics.heightPixels

        val params = container.layoutParams as FrameLayout.LayoutParams
        if (degrees == 90 || degrees == 270) {
            params.width = screenHeight
            params.height = screenWidth
        } else {
            params.width = screenWidth
            params.height = screenHeight
        }
        container.layoutParams = params
        container.pivotX = params.width / 2f
        container.pivotY = params.height / 2f
        container.rotation = degrees.toFloat()
    }

    private fun applyAutoscale(autoscale: Boolean) {
        binding.imageView.scaleType = if (autoscale) ImageView.ScaleType.CENTER_CROP else ImageView.ScaleType.FIT_CENTER
        binding.videoView.resizeMode = if (autoscale) AspectRatioFrameLayout.RESIZE_MODE_ZOOM else AspectRatioFrameLayout.RESIZE_MODE_FIT
    }

    private fun playCurrent() {
        clearAdvanceTimer()
        val items = playlist?.items
        if (items.isNullOrEmpty()) {
            lastItem = null
            reveal(binding.idleText)
            sendHeartbeat()
            return
        }
        val item = items[currentIndex % items.size]
        lastItem = item
        lastVideoPositionMs = null
        when (item.type) {
            "video" -> prepareVideo(item)
            "image" -> prepareImage(item)
            "website" -> prepareWebsite(item)
            else -> { advance(); return }
        }
        sendHeartbeat()
    }

    private fun advance() {
        currentIndex += 1
        playCurrent()
    }

    private fun reveal(newView: View) {
        val previous = currentVisibleView
        if (previous === newView) return
        newView.visibility = View.VISIBLE
        listOf(binding.videoView, binding.imageView, binding.webView, binding.idleText).forEach { v ->
            if (v !== newView) v.visibility = View.GONE
        }
        if (previous === binding.videoView) exoPlayer?.pause()
        if (previous === binding.webView) binding.webView.loadUrl("about:blank")
        currentVisibleView = newView
    }

    private fun prepareVideo(item: PlaylistItem) {
        val uri = contentCache.cachedFileOrNull(item.url)?.let { Uri.fromFile(it) } ?: Uri.parse(item.url)
        scheduleVideoWatchdog(FALLBACK_VIDEO_WATCHDOG_MS)
        exoPlayer?.apply {
            setMediaItem(MediaItem.fromUri(uri))
            volume = if (item.muted) 0f else 1f
            prepare()
            playWhenReady = true
        }
    }

    private fun scheduleVideoWatchdog(delayMs: Long) {
        clearVideoWatchdog()
        val runnable = Runnable { advance() }
        videoWatchdogRunnable = runnable
        mainHandler.postDelayed(runnable, delayMs)
    }

    private fun clearVideoWatchdog() {
        videoWatchdogRunnable?.let { mainHandler.removeCallbacks(it) }
        videoWatchdogRunnable = null
    }

    private fun prepareImage(item: PlaylistItem) {
        val source: Any = contentCache.cachedFileOrNull(item.url) ?: item.url
        binding.imageView.load(source, imageLoader) {
            listener(
                onSuccess = { _, _ ->
                    reveal(binding.imageView)
                    scheduleAdvance((item.durationSeconds ?: 10) * 1000L)
                },
                onError = { _, _ ->
                    scheduleAdvance(3000)
                },
            )
        }
    }

    private fun prepareWebsite(item: PlaylistItem) {
        var revealed = false
        binding.webView.webViewClient = object : android.webkit.WebViewClient() {
            override fun onPageFinished(view: android.webkit.WebView?, url: String?) {
                if (revealed) return
                revealed = true
                reveal(binding.webView)
            }
        }
        binding.webView.loadUrl(item.url)
        scheduleAdvance((item.durationSeconds ?: 30) * 1000L)
        mainHandler.postDelayed({
            if (!revealed) {
                revealed = true
                reveal(binding.webView)
            }
        }, 4000)
    }

    private fun scheduleAdvance(delayMs: Long) {
        val runnable = Runnable { advance() }
        advanceRunnable = runnable
        mainHandler.postDelayed(runnable, delayMs)
    }

    private fun clearAdvanceTimer() {
        advanceRunnable?.let { mainHandler.removeCallbacks(it) }
        advanceRunnable = null
    }

    override fun onResume() {
        super.onResume()
        binding.webView.onResume()
    }

    override fun onPause() {
        super.onPause()
        binding.webView.onPause()
    }

    override fun onDestroy() {
        super.onDestroy()
        clearAdvanceTimer()
        clearVideoWatchdog()
        mainHandler.removeCallbacks(heartbeatRunnable)
        mainHandler.removeCallbacks(previewRunnable)
        mainHandler.removeCallbacks(scheduleEvalRunnable)
        socketManager?.disconnect()
        exoPlayer?.release()
    }

    companion object {
        private const val HEARTBEAT_INTERVAL_MS = 5000L
        private const val PREVIEW_INTERVAL_MS = 5000L
        private const val VIDEO_STALL_GRACE_MS = 15000L
        private const val FALLBACK_VIDEO_WATCHDOG_MS = 10 * 60 * 1000L
        private const val SCHEDULE_EVAL_INTERVAL_MS = 15000L
    }
}
