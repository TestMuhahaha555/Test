Android Companion — โครงสร้างโปรเจกต์ (ยังไม่ได้ Compile / ยังไม่ได้ทดสอบบนเครื่องจริง)

เปิดใน Android Studio (JDK 17): File > Open > android-companion > Sync. ไม่มี gradle-wrapper.jar ในแพ็กเกจ (Android Studio จัดการให้)
ตั้งค่า appUrl ใน gradle.properties เป็น https จริง — build จะหยุดพร้อมข้อความถ้าไม่ใช่ https/ยังเป็น YOUR-HOST (Sync ไม่ล้ม); ตอนรันแอปก็ตรวจซ้ำและแสดงข้อความแทน WebView
minSdk 26 (ใช้ adaptive icon), compile/targetSdk 34

Source of Truth = PWA. Snapshot v3: {v:3, generatedAt, week:{"0".."6":[{s,e,t}]}, ck:{dateKey,done,total}, food:{n,at}|null}
- ตารางทั้งสัปดาห์อยู่ใน snapshot → Current/Next/Today คำนวณจากเวลาเครื่อง ไม่ต้องเปิด PWA (ตารางในแอปเป็นข้อมูลคงที่ในโค้ด จึงใช้ได้ทั้งสัปดาห์)
- ส่ง snapshot เมื่อนาทีเปลี่ยน (ขณะ PWA เปิดอยู่) และตอนแอปถูกซ่อน; Checklist/Food ที่เปลี่ยนจะไปถึง widget ตอนนั้น ไม่ใช่ทันที
- ข้อมูลสถานะ: ไม่มีข้อมูล / ข้อมูลเก่า (snapshot เก่ากว่า 14 วัน, เวลาเครื่องย้อนหลัง, หรือเวอร์ชันเก่ากว่า) / ต้องอัปเดตแอป (v ใหม่กว่า) / ปกติ
  Checklist/Summary ตรวจ dateKey ต้องเท่ากับวันนี้ ไม่เช่นนั้นขึ้น "ยังไม่ได้ซิงก์ของวันนี้"
- ทุก widget แสดง "อัปเดต HH:mm" (เวลาที่วาดล่าสุด)

การอัปเดตเมื่อ PWA ไม่เปิด: AlarmManager.setAndAllowWhileIdle (ไม่ exact, ไม่ต้องขอ permission) ตั้ง 1 ปลุกที่ "ขอบกิจกรรมถัดไป" (≤ 6 ชม.) แล้วตั้งรอบต่อไปหลังวาดเสร็จ
 ยกเลิกปลุกเมื่อไม่มี widget; ตั้งใหม่หลังบูต/เปลี่ยนเวลา/เขตเวลา/วันที่ (TickReceiver). ไม่มี polling ใน PWA และไม่มี WorkManager/dependency เพิ่ม
 ข้อจำกัด: ปลุกแบบ inexact ระบบอาจเลื่อน (Doze/battery saver) จึงอาจช้ากว่าขอบกิจกรรมเล็กน้อย; "เหลือ ~x นาที" เป็นค่า ณ เวลาที่วาดล่าสุด ไม่นับถอยหลังต่อเนื่อง

Widget: Current, Next(ข้ามไปพรุ่งนี้ได้), Today, Food, Music, Checklist, Summary, Clock, Quick — เพิ่มตัวใหม่: class ใน Widgets.kt + xml/widget_X_info.xml + <receiver> + ใส่ใน SnapWidget.ALL
- Music: เปิดเครื่องเล่นเท่านั้น; Checklist: แสดงจำนวนที่ "ทำแล้ว" ติ๊กจาก widget ไม่ได้; Food: แสดงเมนูที่เลือกล่าสุด

ความปลอดภัย WebView/Bridge:
- WebView โหลดได้เฉพาะ https + host เดียวกัน + path ใต้โฟลเดอร์ appUrl; ที่อื่นเปิดเบราว์เซอร์ภายนอก; ปิด file/content access
- Bridge มีเมธอดเดียว saveSnapshot (เขียนอย่างเดียว ไม่มี getter) validate v/โครงสร้าง/ขนาด ≤200KB ข้อความแสดงเป็น TextView ธรรมดา
- ความเสี่ยงที่เหลือ: addJavascriptInterface เปิดให้ทุกหน้า/iframe ใน WebView เรียกได้ ถ้ามีหน้าที่ไม่น่าเชื่อถือบน host+path เดียวกัน (หรือ XSS) จะส่ง snapshot ปลอมให้ widget ได้ (ผลแค่ข้อความใน widget) การปิดช่องนี้เต็มที่ต้องใช้ androidx.webkit WebMessageListener พร้อม origin rule ซึ่งเพิ่ม dependency — ยังไม่ได้ทำ


WebView: file picker / JS dialogs / lifecycle (แก้ในรอบนี้ — ยังไม่ได้ Compile และยังไม่ได้ทดสอบบนเครื่องจริง)
สาเหตุที่พบจากโค้ด: MainActivity ไม่ได้ตั้ง WebChromeClient → WebView เปิด <input type=file> ไม่ได้ (เพลง/ปก/เสียงแจ้งเตือน/นำเข้า Backup) และ confirm() คืนค่าปฏิเสธเงียบ ๆ
 (เว็บใช้ confirm() 6 จุด: ลบเมนู, ลบ/คืนค่า/ซ้อนเวลาของตาราง ฯลฯ; ไม่มี alert()/prompt())
- onShowFileChooser: ตัวเลือกไฟล์ของระบบ (ACTION_GET_CONTENT, SAF) ไม่ขอ storage permission; รองรับเลือกหลายไฟล์ตามที่ HTML กำหนด; กรอง accept เฉพาะ MIME จริง (นามสกุลอย่าง .mp3 ถูกข้าม → ใช้ */*)
  ยกเลิก = callback(null); คำขอเก่าค้างจะถูกยกเลิกก่อนรับคำขอใหม่; onDestroy ยกเลิก callback ที่ค้าง; ใช้ platform startActivityForResult (ไม่เพิ่ม AndroidX)
- onJsAlert/Confirm/Prompt: แสดง AlertDialog เฉพาะหน้า trusted (https+host+path ของ appUrl) และ Activity ยังอยู่ ไม่งั้น cancel ทันที; ทุกทางออกเรียก result ครั้งเดียว
- manifest: windowSoftInputMode=adjustResize (คีย์บอร์ดไม่บังปุ่ม "เพิ่มเมนู" ใน bottom sheet — เป็นสมมติฐานของอาการ "เพิ่มเมนูไม่ได้" ที่ยังไม่ยืนยัน เพราะโค้ดเพิ่มเมนูไม่ใช้ dialog) และ configChanges (หมุนจอไม่สร้าง WebView ใหม่/ไม่ทำ callback หลุด)
- mediaPlaybackRequiresUserGesture=false: เพลงเล่นต่อเนื่องและเสียงแจ้งเตือนเริ่มจาก timer ไม่ใช่การแตะ; เนื้อหาจำกัด https ของแอปเรา. allowFileAccess/allowContentAccess ยังเป็น false (ถ้าเลือกไฟล์แล้วไม่ได้ข้อมูล ให้ลองเปิด allowContentAccess เป็นอย่างแรก — ยังไม่ยืนยัน)
- onPause/onResume ส่งต่อให้ WebView; onDestroy ถอด Bridge + destroy
ไม่เปลี่ยน: Bridge, allowlist host/path, external link เปิดเบราว์เซอร์, Widget 9 ตัว, Scheduler/TickReceiver, Gradle/AGP/JDK

NOT VERIFIED — REQUIRES REAL DEVICE: file picker, JS dialogs, Music/Cover/Sound upload ใน WebView, keyboard, back/lifecycle, Widget ทุกตัว
ข้อจำกัดที่ทราบ: Notification API/ServiceWorker notification ของเว็บมักใช้ใน WebView ไม่ได้ (แจ้งเตือนในแอปที่เป็นแบนเนอร์/เสียงยังทำงานตามเว็บ แต่แจ้งเตือนระบบ Android ต้องเพิ่มฝั่ง native — ยังไม่ได้ทำ); โปรเซสถูกระบบฆ่าระหว่างเปิด picker → หน้าโหลดใหม่ ไฟล์ที่เลือกไม่ถูกส่งต่อ
