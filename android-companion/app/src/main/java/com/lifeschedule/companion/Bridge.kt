package com.lifeschedule.companion

import android.content.Context
import android.webkit.JavascriptInterface
import org.json.JSONObject

/** ช่องทางเดียว PWA → native. มีเมธอดเขียนอย่างเดียว (ไม่มี getter ที่คืนข้อมูลส่วนตัว). validate โครงสร้าง/ขนาดก่อนเก็บ */
class Bridge(private val ctx: Context) {
    @JavascriptInterface
    fun saveSnapshot(json: String) {
        if (json.length > 200_000) return
        try {
            val o = JSONObject(json)
            if (o.getInt("v") != Snap.VERSION || o.getLong("generatedAt") <= 0) return
            o.getJSONObject("week"); o.getJSONObject("ck").getString("dateKey")
        } catch (e: Exception) { return }
        ctx.getSharedPreferences("snap", Context.MODE_PRIVATE).edit().putString("json", json).apply()
        SnapWidget.updateAll(ctx); Scheduler.schedule(ctx)
    }
}
