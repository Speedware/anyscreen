package com.anyscreen.player

import org.json.JSONObject

data class PlaylistItem(
    val itemId: String,
    val contentId: String,
    val name: String,
    val type: String,
    val url: String,
    val durationSeconds: Int?,
    val muted: Boolean,
)

data class Playlist(
    val id: String,
    val name: String,
    val items: List<PlaylistItem>,
)

internal fun resolveUrl(url: String, baseUrl: String): String {
    if (url.startsWith("http://") || url.startsWith("https://")) return url
    return baseUrl.trimEnd('/') + (if (url.startsWith("/")) url else "/$url")
}

internal fun parsePlayable(json: JSONObject?, baseUrl: String): Playlist? {
    if (json == null) return null
    val itemsJson = json.getJSONArray("items")
    val items = mutableListOf<PlaylistItem>()
    for (i in 0 until itemsJson.length()) {
        val item = itemsJson.getJSONObject(i)
        items.add(
            PlaylistItem(
                itemId = item.getString("itemId"),
                contentId = item.getString("contentId"),
                name = item.getString("name"),
                type = item.getString("type"),
                url = resolveUrl(item.getString("url"), baseUrl),
                durationSeconds = if (item.isNull("durationSeconds")) null else item.getInt("durationSeconds"),
                muted = item.optBoolean("muted", false),
            )
        )
    }
    return Playlist(id = json.optString("id", ""), name = json.optString("name", ""), items = items)
}
