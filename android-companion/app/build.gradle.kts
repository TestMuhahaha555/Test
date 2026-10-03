plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android {
    namespace = "com.lifeschedule.companion"
    compileSdk = 34
    defaultConfig {
        applicationId = "com.lifeschedule.companion"
        minSdk = 26; targetSdk = 34; versionCode = 1; versionName = "0.1"
        val url = (project.findProperty("appUrl") as String?) ?: ""
        buildConfigField("String", "APP_URL", "\"$url\"")
    }
    buildFeatures { buildConfig = true }
    buildTypes { release { isMinifyEnabled = false } }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}

// ตรวจ appUrl ตอน build (ไม่ทำให้ Gradle Sync ล้ม): ต้องเป็น https และไม่ใช่ค่า placeholder
tasks.register("validateAppUrl") {
    doLast {
        val u = (project.findProperty("appUrl") as String?) ?: ""
        require(u.startsWith("https://") && !u.contains("YOUR-HOST") && u.length > 12) { "appUrl ใน gradle.properties ต้องเป็น https URL จริงของ PWA (ตอนนี้: '$u')" }
    }
}
tasks.matching { it.name == "preBuild" }.configureEach { dependsOn("validateAppUrl") }
