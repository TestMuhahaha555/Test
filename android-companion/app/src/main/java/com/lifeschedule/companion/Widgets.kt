package com.lifeschedule.companion

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews

/** Widget ทุกตัวสืบจาก SnapWidget. เพิ่มตัวใหม่ = class + xml/widget_X_info.xml + <receiver> + ใส่ใน SnapWidget.ALL */
abstract class SnapWidget(private val layout: Int, private val route: String) : AppWidgetProvider() {
    abstract fun content(s: Snap): Triple<String, String, String>

    override fun onUpdate(c: Context, m: AppWidgetManager, ids: IntArray) { render(c, m, ids); Scheduler.schedule(c) }
    override fun onEnabled(c: Context) { Scheduler.schedule(c) }
    override fun onDisabled(c: Context) { Scheduler.schedule(c) }   // ถ้าไม่เหลือ widget จะยกเลิกปลุก

    fun render(c: Context, m: AppWidgetManager, ids: IntArray) {
        val s = Snap.load(c)
        val t = when (s.state) {
            Snap.State.NONE -> Triple("ยังไม่มีข้อมูล", "เปิดแอป LifeSchedule เพื่อซิงก์ครั้งแรก", "")
            Snap.State.UNSUPPORTED -> Triple("ต้องอัปเดตแอป", "เวอร์ชันข้อมูลใหม่กว่า widget", "")
            Snap.State.STALE -> Triple("ข้อมูลเก่า", "เปิดแอปเพื่ออัปเดตตาราง", "")
            Snap.State.OK -> try { content(s) } catch (e: Exception) { Triple("ข้อมูลไม่ถูกต้อง", "เปิดแอปเพื่อซิงก์ใหม่", "") }
        }
        for (id in ids) {
            val v = RemoteViews(c.packageName, layout)
            v.setTextViewText(R.id.w_title, t.first); v.setTextViewText(R.id.w_sub, t.second); v.setTextViewText(R.id.w_body, t.third)
            v.setTextViewText(R.id.w_stamp, "อัปเดต " + Snap.hhmm(Snap.nowMin()))
            v.setOnClickPendingIntent(R.id.w_root, open(c, route))
            m.updateAppWidget(id, v)
        }
    }

    companion object {
        fun open(c: Context, route: String): PendingIntent =
            PendingIntent.getActivity(c, route.hashCode(), Intent(c, MainActivity::class.java).putExtra("route", route).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val ALL: List<SnapWidget> by lazy { listOf(CurrentWidget(), NextWidget(), TodayWidget(), FoodWidget(), MusicWidget(), ChecklistWidget(), SummaryWidget()) }
        fun hasWidgets(c: Context): Boolean { val m = AppWidgetManager.getInstance(c); return ALL.any { m.getAppWidgetIds(ComponentName(c, it.javaClass)).isNotEmpty() } }
        fun updateAll(c: Context) { val m = AppWidgetManager.getInstance(c)
            for (w in ALL) { val ids = m.getAppWidgetIds(ComponentName(c, w.javaClass)); if (ids.isNotEmpty()) w.render(c, m, ids) } }
    }
}

/** ปลุกอัปเดต widget ที่ "ขอบกิจกรรมถัดไป" ด้วย AlarmManager แบบไม่ exact (ไม่ต้องขอ permission, ประหยัดแบต, ผ่าน Doze ได้แบบหน่วงได้);
 *  ไม่มี widget → ยกเลิกปลุก; ปลุกทุกครั้ง ≤ 6 ชม. เป็นอย่างน้อย */
object Scheduler {
    fun schedule(c: Context) {
        val am = c.getSystemService(AlarmManager::class.java) ?: return
        val pi = PendingIntent.getBroadcast(c, 7, Intent(c, TickReceiver::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        if (!SnapWidget.hasWidgets(c)) { am.cancel(pi); return }
        am.setAndAllowWhileIdle(AlarmManager.RTC, Snap.load(c).nextBoundaryMs(), pi)
    }
}
/** รับ: ปลุกขอบกิจกรรม, บูตเครื่อง, เปลี่ยนเวลา/เขตเวลา/วันที่ → วาด widget ใหม่แล้วตั้งปลุกรอบถัดไป */
class TickReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) { SnapWidget.updateAll(c); Scheduler.schedule(c) }
}

class CurrentWidget : SnapWidget(R.layout.widget_text, "schedule") {
    override fun content(s: Snap): Triple<String, String, String> {
        val n = Snap.nowMin(); val a = s.today()
        for (i in 0 until a.length()) { val x = a.getJSONObject(i)
            if (x.getInt("s") <= n && n < x.getInt("e")) return Triple(x.getString("t"), "${Snap.hhmm(x.getInt("s"))}–${Snap.hhmm(x.getInt("e"))} · เหลือ ~${x.getInt("e") - n} นาที", "") }
        return Triple("ไม่มีกิจกรรมตอนนี้", "", "")
    }
}
class NextWidget : SnapWidget(R.layout.widget_text, "schedule") {
    override fun content(s: Snap): Triple<String, String, String> {
        val n = Snap.nowMin(); val a = s.today()
        for (i in 0 until a.length()) { val x = a.getJSONObject(i); if (x.getInt("s") > n) return Triple(x.getString("t"), "เริ่ม ${Snap.hhmm(x.getInt("s"))} · อีก ~${x.getInt("s") - n} นาที", "") }
        val t = s.tomorrow()
        if (t.length() > 0) { val x = t.getJSONObject(0); return Triple(x.getString("t"), "พรุ่งนี้ ${Snap.hhmm(x.getInt("s"))}", "") }
        return Triple("ไม่มีกิจกรรมถัดไป", "", "")
    }
}
class TodayWidget : SnapWidget(R.layout.widget_text, "schedule") {
    override fun content(s: Snap): Triple<String, String, String> {
        val n = Snap.nowMin(); val a = s.today(); val lines = ArrayList<String>()
        for (i in 0 until a.length()) { val x = a.getJSONObject(i); if (x.getInt("e") > n && lines.size < 8) lines.add(Snap.hhmm(x.getInt("s")) + "  " + x.getString("t")) }
        return Triple("ตารางวันนี้", "", if (lines.isEmpty()) "จบกิจกรรมของวันนี้แล้ว" else lines.joinToString("\n"))
    }
}
class FoodWidget : SnapWidget(R.layout.widget_text, "food") {
    override fun content(s: Snap): Triple<String, String, String> {
        val f = s.o!!.optJSONObject("food") ?: return Triple("ยังไม่มีเมนูที่เลือก", "แตะเพื่อสุ่มอาหาร", "")
        return Triple(f.getString("n"), "เมนูที่เลือกล่าสุด · แตะเพื่อสุ่มใหม่", "")
    }
}
class MusicWidget : SnapWidget(R.layout.widget_text, "music") {
    /** ควบคุม play/pause ไม่ได้: เสียงเล่นใน WebView ของ PWA */
    override fun content(s: Snap) = Triple("เพลง", "แตะเพื่อเปิดเครื่องเล่น", "")
}
class ChecklistWidget : SnapWidget(R.layout.widget_text, "schedule") {
    override fun content(s: Snap): Triple<String, String, String> {
        val c = s.o!!.getJSONObject("ck")
        if (c.getString("dateKey") != Snap.todayKey()) return Triple("Checklist วันนี้", "ยังไม่ได้ซิงก์ของวันนี้ · เปิดแอป", "")
        return Triple("Checklist วันนี้", "ทำแล้ว ${c.getInt("done")} / ${c.getInt("total")}", "")
    }
}
class SummaryWidget : SnapWidget(R.layout.widget_text, "summary") {
    override fun content(s: Snap): Triple<String, String, String> {
        val c = s.o!!.getJSONObject("ck")
        if (c.getString("dateKey") != Snap.todayKey()) return Triple("ความคืบหน้า", "ยังไม่ได้ซิงก์ของวันนี้ · เปิดแอป", "")
        return Triple("ความคืบหน้าวันนี้", "${c.getInt("done")} จาก ${c.getInt("total")} กิจกรรม", "ดูสรุปสัปดาห์ในแอป")
    }
}
class ClockWidget : AppWidgetProvider() {
    override fun onUpdate(c: Context, m: AppWidgetManager, ids: IntArray) {
        for (id in ids) { val v = RemoteViews(c.packageName, R.layout.widget_clock); v.setOnClickPendingIntent(R.id.w_root, SnapWidget.open(c, "home")); m.updateAppWidget(id, v) }
    }
}
class QuickWidget : AppWidgetProvider() {
    override fun onUpdate(c: Context, m: AppWidgetManager, ids: IntArray) {
        for (id in ids) { val v = RemoteViews(c.packageName, R.layout.widget_quick)
            v.setOnClickPendingIntent(R.id.q_schedule, SnapWidget.open(c, "schedule")); v.setOnClickPendingIntent(R.id.q_food, SnapWidget.open(c, "food")); v.setOnClickPendingIntent(R.id.q_music, SnapWidget.open(c, "music"))
            m.updateAppWidget(id, v) }
    }
}
