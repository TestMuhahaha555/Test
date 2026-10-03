package com.lifeschedule.companion

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar

/** Snapshot v3 (PWA = Source of Truth; เขียนโดย index.html):
 *  {v:3, generatedAt:epochMs, week:{"0".."6":[{s,e,t}]}  // 0=อาทิตย์ ตรงกับ JS getDay()
 *   ck:{dateKey,done,total}, food:{n,at}|null}
 *  ตารางทั้งสัปดาห์อยู่ใน snapshot → Widget คำนวณ current/next จากเวลาเครื่องได้แม้ PWA ปิดอยู่ */
class Snap(val o: JSONObject?, val state: State) {
    enum class State { NONE, UNSUPPORTED, STALE, OK }

    private fun day(offset: Int): JSONArray {
        val dow = (Calendar.getInstance()[Calendar.DAY_OF_WEEK] - 1 + offset) % 7
        return o!!.getJSONObject("week").optJSONArray(dow.toString()) ?: JSONArray()
    }
    fun today(): JSONArray = day(0)
    fun tomorrow(): JSONArray = day(1)

    /** เวลา (epoch ms) ของ "ขอบกิจกรรม" ถัดไป เพื่อตั้งปลุกอัปเดต widget; จำกัดไม่เกิน 6 ชม. */
    fun nextBoundaryMs(): Long {
        val now = System.currentTimeMillis()
        val cap = now + 6 * 3600_000L
        if (state != State.OK) return cap
        val nm = nowMin(); var best = 1440
        val a = today()
        for (i in 0 until a.length()) { val x = a.getJSONObject(i)
            for (m in intArrayOf(x.getInt("s"), x.getInt("e"))) if (m > nm && m < best) best = m }
        val c = Calendar.getInstance().apply { set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0); add(Calendar.MINUTE, best) }
        return minOf(maxOf(c.timeInMillis + 1000, now + 60_000), cap)
    }

    companion object {
        const val VERSION = 3
        const val MAX_AGE_MS = 14L * 24 * 3600_000
        fun load(c: Context): Snap {
            val raw = c.getSharedPreferences("snap", Context.MODE_PRIVATE).getString("json", null) ?: return Snap(null, State.NONE)
            return try {
                val o = JSONObject(raw)
                val v = o.getInt("v")
                if (v > VERSION) return Snap(o, State.UNSUPPORTED)
                if (v < VERSION) return Snap(o, State.STALE)
                val age = System.currentTimeMillis() - o.getLong("generatedAt")
                o.getJSONObject("week")
                Snap(o, if (age > MAX_AGE_MS || age < -300_000) State.STALE else State.OK)
            } catch (e: Exception) { Snap(null, State.NONE) }
        }
        fun todayKey(): String { val n = Calendar.getInstance(); return "%04d-%02d-%02d".format(n[Calendar.YEAR], n[Calendar.MONTH] + 1, n[Calendar.DAY_OF_MONTH]) }
        fun nowMin(): Int { val n = Calendar.getInstance(); return n[Calendar.HOUR_OF_DAY] * 60 + n[Calendar.MINUTE] }
        fun hhmm(m: Int) = "%02d:%02d".format(m / 60, m % 60)
    }
}
