package com.anyscreen.player

import org.json.JSONObject
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

data class SchedulePlanItem(
    val id: String,
    val daysOfWeek: Set<Int>,
    val startTime: String,
    val endTime: String,
    val timezone: String,
    val priority: Int,
    val updatedAt: String,
    val playable: Playlist?,
)

data class SchedulePlan(
    val schedules: List<SchedulePlanItem>,
    val default: Playlist?,
    val rotation: Int,
    val autoscale: Boolean,
) {
    fun resolveNow(now: Long = System.currentTimeMillis()): Pair<String?, Playlist?> {
        var best: SchedulePlanItem? = null
        for (schedule in schedules) {
            val (day, time) = zonedDayAndTime(now, schedule.timezone)
            if (day !in schedule.daysOfWeek) continue
            if (!inWindow(time, schedule.startTime, schedule.endTime)) continue
            if (best == null || schedule.priority > best!!.priority ||
                (schedule.priority == best!!.priority && schedule.updatedAt > best!!.updatedAt)
            ) {
                best = schedule
            }
        }
        return if (best != null) best!!.id to best!!.playable else null to default
    }

    companion object {
        private fun zonedDayAndTime(nowMs: Long, timezone: String): Pair<Int, String> {
            val tz = TimeZone.getTimeZone(timezone)
            val cal = Calendar.getInstance(tz)
            cal.timeInMillis = nowMs
            val day = cal.get(Calendar.DAY_OF_WEEK) - 1
            val time = String.format(Locale.US, "%02d:%02d", cal.get(Calendar.HOUR_OF_DAY), cal.get(Calendar.MINUTE))
            return day to time
        }

        private fun inWindow(current: String, start: String, end: String): Boolean {
            if (start == end) return false
            return if (start < end) current >= start && current < end
            else current >= start || current < end
        }

        fun fromResponse(body: String, baseUrl: String): SchedulePlan {
            val root = JSONObject(body)
            val schedulesJson = root.getJSONArray("schedules")
            val schedules = mutableListOf<SchedulePlanItem>()
            for (i in 0 until schedulesJson.length()) {
                val s = schedulesJson.getJSONObject(i)
                val daysJson = s.getJSONArray("daysOfWeek")
                val days = mutableSetOf<Int>()
                for (j in 0 until daysJson.length()) days.add(daysJson.getInt(j))
                schedules.add(
                    SchedulePlanItem(
                        id = s.getString("id"),
                        daysOfWeek = days,
                        startTime = s.getString("startTime"),
                        endTime = s.getString("endTime"),
                        timezone = s.optString("timezone", "UTC"),
                        priority = s.optInt("priority", 0),
                        updatedAt = s.optString("updatedAt", ""),
                        playable = parsePlayable(s.optJSONObject("playable"), baseUrl),
                    )
                )
            }
            val rotation = root.optInt("rotation", 0).let { if (it in setOf(0, 90, 180, 270)) it else 0 }
            return SchedulePlan(
                schedules = schedules,
                default = parsePlayable(root.optJSONObject("default"), baseUrl),
                rotation = rotation,
                autoscale = root.optBoolean("autoscale", true),
            )
        }
    }
}
