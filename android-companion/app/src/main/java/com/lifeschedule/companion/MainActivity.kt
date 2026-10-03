package com.lifeschedule.companion

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.TextView

/** โฮสต์ PWA ใน WebView. URL ตั้งที่ gradle.properties (appUrl). WebView ไปได้เฉพาะ https + host เดียวกัน + path ใต้โฟลเดอร์ของ appUrl;
 *  ที่อื่นเปิดในเบราว์เซอร์ภายนอก. Bridge เขียนอย่างเดียว/validate (ดูความเสี่ยงที่เหลือใน README-android.txt)
 *
 *  WebChromeClient: ถ้าไม่ตั้ง WebView จะ (1) เปิด <input type=file> ไม่ได้ (2) ทำให้ confirm()/alert()/prompt() คืนค่าปฏิเสธเงียบ ๆ
 *  จึงรองรับทั้งสองอย่างที่นี่ โดยไม่แก้เว็บ. ใช้ Activity.startActivityForResult ของ platform (ไม่เพิ่ม dependency AndroidX). */
class MainActivity : Activity() {
    private var web: WebView? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private val routes = setOf("home", "schedule", "food", "music", "summary", "settings")
    private val reqFile = 4101
    private lateinit var base: Uri
    private lateinit var dirPrefix: String

    @SuppressLint("SetJavaScriptEnabled", "AddJavascriptInterface")
    override fun onCreate(b: Bundle?) {
        super.onCreate(b)
        base = Uri.parse(BuildConfig.APP_URL)
        if (base.scheme != "https" || base.host.isNullOrEmpty() || base.host!!.contains("YOUR-HOST")) {
            setContentView(TextView(this).apply { text = "ยังไม่ได้ตั้งค่า appUrl (ต้องเป็น https จริง) ใน gradle.properties"; setPadding(48, 96, 48, 48) }); return
        }
        dirPrefix = (base.path ?: "/").substringBeforeLast('/') + "/"
        val w = WebView(this); web = w; setContentView(w)
        w.settings.javaScriptEnabled = true
        w.settings.domStorageEnabled = true            // localStorage + IndexedDB ของ PWA
        w.settings.allowFileAccess = false
        w.settings.allowContentAccess = false
        // false: เพลงเล่นต่อเพลง/เสียงแจ้งเตือนของ PWA เริ่มจากตัวจับเวลา (ไม่มีการแตะ) — เนื้อหาจำกัดที่ https ของแอปเราเท่านั้น
        w.settings.mediaPlaybackRequiresUserGesture = false
        w.addJavascriptInterface(Bridge(applicationContext), "LifeScheduleAndroid")
        w.webChromeClient = Chrome()
        w.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest): Boolean {
                val u = r.url
                if (trusted(u)) return false
                if (u.scheme == "https") startActivity(Intent(Intent.ACTION_VIEW, u))
                return true
            }
        }
        val r = intent?.getStringExtra("route")?.takeIf { it in routes }
        w.loadUrl(if (r != null) "$base#$r" else base.toString())
    }

    private fun trusted(u: Uri): Boolean = u.scheme == "https" && u.host == base.host && (u.path ?: "").startsWith(dirPrefix)
    private fun trustedUrl(url: String?): Boolean = url != null && trusted(Uri.parse(url))

    private inner class Chrome : WebChromeClient() {
        // ---- JavaScript dialogs: ทำงานเฉพาะหน้าที่ trusted และขณะ Activity ยังอยู่; ไม่งั้น cancel ทันที (ไม่ปล่อยค้าง) ----
        private fun usable(url: String?, r: JsResult): Boolean {
            if (isFinishing || isDestroyed || !trustedUrl(url)) { r.cancel(); return false }
            return true
        }
        private fun msg(m: String?) = (m ?: "").take(500)
        override fun onJsAlert(v: WebView, url: String?, message: String?, r: JsResult): Boolean {
            if (!usable(url, r)) return true
            AlertDialog.Builder(this@MainActivity).setMessage(msg(message))
                .setPositiveButton(android.R.string.ok) { _, _ -> r.confirm() }
                .setOnCancelListener { r.cancel() }.show()
            return true
        }
        override fun onJsConfirm(v: WebView, url: String?, message: String?, r: JsResult): Boolean {
            if (!usable(url, r)) return true
            AlertDialog.Builder(this@MainActivity).setMessage(msg(message))
                .setPositiveButton(android.R.string.ok) { _, _ -> r.confirm() }
                .setNegativeButton(android.R.string.cancel) { _, _ -> r.cancel() }
                .setOnCancelListener { r.cancel() }.show()
            return true
        }
        override fun onJsPrompt(v: WebView, url: String?, message: String?, defaultValue: String?, r: JsPromptResult): Boolean {
            if (isFinishing || isDestroyed || !trustedUrl(url)) { r.cancel(); return true }
            val input = EditText(this@MainActivity).apply { setText((defaultValue ?: "").take(500)); setSingleLine(true) }
            AlertDialog.Builder(this@MainActivity).setMessage(msg(message)).setView(input)
                .setPositiveButton(android.R.string.ok) { _, _ -> r.confirm(input.text.toString()) }
                .setNegativeButton(android.R.string.cancel) { _, _ -> r.cancel() }
                .setOnCancelListener { r.cancel() }.show()
            return true
        }

        // ---- <input type=file>: ตัวเลือกไฟล์ของระบบ (SAF) ไม่ต้องขอ storage permission ----
        override fun onShowFileChooser(v: WebView, cb: ValueCallback<Array<Uri>>, p: WebChromeClient.FileChooserParams): Boolean {
            if (isFinishing || isDestroyed || !trustedUrl(v.url)) { cb.onReceiveValue(null); return true }
            fileCallback?.onReceiveValue(null)          // ถ้ามีคำขอเก่าค้าง: ยกเลิกก่อน (กัน callback ซ้อน/ค้าง)
            fileCallback = cb
            val mimes = p.acceptTypes.orEmpty().flatMap { it.split(',') }.map { it.trim() }.filter { it.contains('/') }
            val i = Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE)
                .setType(if (mimes.size == 1) mimes[0] else "*/*")
                .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, p.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE)
            if (mimes.size > 1) i.putExtra(Intent.EXTRA_MIME_TYPES, mimes.toTypedArray())
            return try { startActivityForResult(Intent.createChooser(i, p.title ?: "เลือกไฟล์"), reqFile); true }
            catch (e: ActivityNotFoundException) { fileCallback = null; cb.onReceiveValue(null); true }
        }
    }

    @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != reqFile) { super.onActivityResult(requestCode, resultCode, data); return }
        val cb = fileCallback; fileCallback = null
        cb?.onReceiveValue(if (resultCode == RESULT_OK) WebChromeClient.FileChooserParams.parseResult(resultCode, data) else null)   // ยกเลิก = null
    }

    override fun onNewIntent(i: Intent) {
        super.onNewIntent(i); intent = i
        val r = i.getStringExtra("route")?.takeIf { it in routes } ?: return
        web?.evaluateJavascript("location.hash='$r'", null)
    }
    override fun onPause() { web?.onPause(); super.onPause() }
    override fun onResume() { super.onResume(); web?.onResume() }
    override fun onDestroy() {
        fileCallback?.onReceiveValue(null); fileCallback = null
        web?.apply { stopLoading(); removeJavascriptInterface("LifeScheduleAndroid"); destroy() }; web = null
        super.onDestroy()
    }
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() { val w = web; if (w != null && w.canGoBack()) w.goBack() else super.onBackPressed() }
}
