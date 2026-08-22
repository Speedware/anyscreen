package com.anyscreen.player

import android.content.Context
import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

class ContentCache(context: Context) {
    private val client = OkHttpClient()
    private val executor = Executors.newFixedThreadPool(2)
    private val inFlight = ConcurrentHashMap<String, Boolean>()
    private val dir: File = File(context.filesDir, "content_cache").apply { mkdirs() }

    private fun keyFor(url: String): String {
        var hash = 0
        for (c in url) hash = 31 * hash + c.code
        val ext = url.substringAfterLast('.', "").take(5).filter { it.isLetterOrDigit() }
        return if (ext.isNotEmpty()) "$hash.$ext" else hash.toString()
    }

    fun cachedFileOrNull(url: String): File? {
        val file = File(dir, keyFor(url))
        return if (file.exists() && file.length() > 0) file else null
    }

    fun prefetch(items: List<PlaylistItem>) {
        for (item in items) {
            if (item.type != "video" && item.type != "image") continue
            if (!item.url.startsWith("http")) continue
            if (cachedFileOrNull(item.url) != null) continue
            if (inFlight.putIfAbsent(item.url, true) != null) continue

            executor.submit {
                try {
                    download(item.url)
                } catch (e: Exception) {
                    Log.w("ContentCache", "Failed to prefetch ${item.url}: ${e.message}")
                } finally {
                    inFlight.remove(item.url)
                }
            }
        }
    }

    fun clearAll() {
        dir.listFiles()?.forEach { it.delete() }
    }

    private fun totalCachedBytes(): Long =
        dir.listFiles()?.filter { it.isFile && !it.name.endsWith(".part") }?.sumOf { it.length() } ?: 0L

    fun cacheSummary(items: List<PlaylistItem>): JSONObject {
        val cachedItems = JSONArray()
        for (item in items) {
            val file = cachedFileOrNull(item.url) ?: continue
            val entry = JSONObject()
            entry.put("name", item.name)
            entry.put("type", item.type)
            entry.put("sizeBytes", file.length())
            cachedItems.put(entry)
        }
        val summary = JSONObject()
        summary.put("cachedItems", cachedItems)
        summary.put("cachedBytesTotal", totalCachedBytes())
        return summary
    }

    private fun download(url: String) {
        val target = File(dir, keyFor(url))
        val temp = File(dir, "${keyFor(url)}.part")
        val request = Request.Builder().url(url).build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return
            val body = response.body ?: return
            temp.outputStream().use { out -> body.byteStream().copyTo(out) }
            temp.renameTo(target)
        }
    }
}
