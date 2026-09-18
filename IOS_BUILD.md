# Routine Tracker — iOS ilovasini (`.ipa`) yig‘ish qo‘llanmasi

Bu qo‘llanma loyihadan iPhone ilovasini yig‘ish, uni simulyatorda va haqiqiy telefonda sinash hamda `.ipa` faylini olish yo‘lini bosqichma-bosqich tushuntiradi.

> **Muhim:** `.ipa` faylini faqat **macOS va Xcode** o‘rnatilgan kompyuterda yig‘ish mumkin — bu Apple’ning talabi. Windows’da iOS loyihasini tayyorlash mumkin (u allaqachon tayyor), lekin kompilyatsiya qilib ham, imzolab ham bo‘lmaydi.

---

## 1. Loyihada nima tayyor

| Fayl / papka | Vazifasi |
|---|---|
| `capacitor.config.json` | `appId: uz.routine.tracker`, `appName: Routine Tracker`, `webDir: public` |
| `ios/` | Capacitor yaratgan Xcode loyihasi (Swift Package Manager bilan, CocoaPods kerak emas) |
| `package.json` → `devDependencies` | `@capacitor/cli`, `@capacitor/core`, `@capacitor/ios` (8.5.2). Server bu paketlarga bog‘liq emas |
| `public/app/config.js` | Ilova qaysi serverga ulanishini belgilaydi (3-bo‘lim) |
| `public/index.html` | Ilova uchun CSP: skriptlar faqat ilovaning o‘zidan, so‘rovlar faqat HTTPS serverga |
| `ios/App/App/Info.plist` | ATS: HTTPS majburiy, faqat `localhost` va `.local` uchun istisno |
| `server/config.js` | CORS standart holatda `capacitor://localhost` manbasiga ruxsat beradi |

### Ilova qanday ishlaydi

Ilova — `public/` papkasidagi veb-interfeysning o‘zi. Capacitor uni iPhone ichidagi brauzer oynasi (WKWebView) orqali `capacitor://localhost` manzilidan ochadi. Server (Node.js + SQLite) ilovaga kirmaydi — u alohida, internetdagi serverda ishlaydi. Ilova unga HTTPS orqali ulanadi.

```
iPhone ilovasi (capacitor://localhost)  ──HTTPS + Bearer token──►  Sizning serveringiz (https://...)
       public/ papkasi                                              server/ + data/routine-tracker.sqlite
```

---

## 2. Talablar

**Mac kompyuterda:**

- macOS va **Xcode** (App Store’dan). Loyiha formati kamida Xcode 15 ni talab qiladi. App Store’ga yuklash uchun Apple o‘sha paytda talab qiladigan eng yangi Xcode kerak.
- Xcode buyruq qatori vositalari: `xcode-select --install`
- **Node.js 22.13 yoki yangiroq** (`node --version` bilan tekshiring)
- Git

**Apple hisobi:**

- Simulyatorda sinash uchun — hisob kerak emas.
- O‘z iPhone’ingizda sinash uchun — bepul Apple ID yetadi (ilova 7 kun ishlaydi).
- `.ipa` ni boshqalarga tarqatish, TestFlight yoki App Store uchun — **Apple Developer Program** a’zoligi (yiliga 99 $).

**Server:**

- Internetdan ochiladigan, **HTTPS** sertifikatli manzil, masalan `https://routine.example.com`. iOS oddiy `http://` ga ulanishga ruxsat bermaydi (ATS).

---

## 3. Serverni ilovaga tayyorlash

Ilova ishlashi uchun server internetda HTTPS orqali ishlashi kerak. Serverdagi `.env` fayli:

```bash
NODE_ENV=production
PORT=3000
JWT_SECRET=<uzun tasodifiy qator: openssl rand -hex 48>
# CORS_ORIGINS ni umuman yozmasangiz, standart qiymat capacitor://localhost bo‘ladi.
# Agar yozsangiz, capacitor://localhost ni albatta qo‘shing:
# CORS_ORIGINS=capacitor://localhost
```

HTTPS’ni odatda serverning oldida turadigan Nginx yoki Caddy beradi (masalan, Let’s Encrypt sertifikati bilan). Ular so‘rovlarni `localhost:3000` ga uzatadi.

Server to‘g‘ri sozlanganini tekshirish:

```bash
curl -i -H "Origin: capacitor://localhost" https://routine.example.com/api/health
```

Javobda `Access-Control-Allow-Origin: capacitor://localhost` qatori bo‘lishi kerak.

### Ilova qaysi serverga ulanadi

`public/app/config.js` fayli ilovaning qaysi serverga ulanishini belgilaydi. Tanlov quyidagi tartibda:

1. **Foydalanuvchi kirish oynasida saqlagan manzil** — ilovada “Server manzili” maydoni bor (u faqat ilovada chiqadi, web’da ko‘rinmaydi). Ilovani qayta yig‘ishga hojat yo‘q.
2. **`DEFAULT_NATIVE_API_URL`** — yig‘ishdan oldin shu faylda bir marta yozib qo‘ysangiz, ilova darhol shu serverga ulanadi:
   ```js
   export const DEFAULT_NATIVE_API_URL = 'https://routine.example.com';
   ```
3. Ikkalasi ham bo‘lmasa, kirish oynasi manzilni so‘raydi.

Manzilda `https://` bo‘lishi shart. `http://` faqat `localhost`, `127.0.0.1` va `.local` uchun ishlaydi — bu Mac’dagi sinov serveri uchun.

---

## 4. Mac’da loyihani ochish

```bash
# 1. Loyihani yuklab olish (remote’da faqat shu shox bor)
git clone -b claude/manga-site-full-build-vjfk2v https://github.com/BakhouddinGayratov/Routine-Tracker.git
cd Routine-Tracker

# 2. Paketlarni o‘rnatish (Capacitor ham shu yerda o‘rnatiladi)
npm install

# 3. (ixtiyoriy) public/app/config.js da DEFAULT_NATIVE_API_URL ni yozing

# 4. Veb fayllarni va sozlamalarni iOS loyihasiga ko‘chirish
npx cap sync ios

# 5. Xcode’da ochish
npx cap open ios
```

`npx cap open ios` `ios/App/App.xcodeproj` faylini ochadi. Capacitor 8 Swift Package Manager ishlatgani uchun `pod install` va `.xcworkspace` kerak emas. Xcode birinchi ochilganda paketlarni o‘zi yuklab oladi — pastki paneldagi “Resolving Package Graph” tugashini kuting.

> **`public/` dagi har bir o‘zgarishdan keyin** Xcode’da qayta yig‘ishdan oldin `npx cap copy ios` (yoki `npx cap sync ios`) ni ishga tushiring. Aks holda ilovada eski versiya qoladi.

---

## 5. Xcode sozlamalari

Chap paneldan **App** loyihasini, keyin **TARGETS → App** ni tanlang.

### 5.1. General

| Sozlama | Qiymat |
|---|---|
| Display Name | `Routine Tracker` |
| Bundle Identifier | `uz.routine.tracker` (allaqachon yozilgan) |
| Version | `1.0` — foydalanuvchiga ko‘rinadigan versiya (`MARKETING_VERSION`) |
| Build | `1` — har bir yangi yuklashda bittaga oshiring (`CURRENT_PROJECT_VERSION`) |
| Minimum Deployments | iOS 15.0 |

### 5.2. Signing & Capabilities

1. **Automatically manage signing** — belgilang.
2. **Team** — Apple hisobingizni tanlang. Ro‘yxatda bo‘lmasa: Xcode → Settings → Accounts → “+” → Apple ID.
3. Xcode imzolash sertifikati va provisioning profilini o‘zi yaratadi. “Failed to register bundle identifier” xatosi chiqsa, `uz.routine.tracker` identifikatori boshqa jamoada band bo‘lgan bo‘ladi — uni o‘zingizga tegishli qiymatga o‘zgartiring (masalan, `uz.sizningdomen.routine`) va `capacitor.config.json` dagi `appId` ni ham shunga moslang.

### 5.3. Ilova belgisi (icon) va splash

`ios/App/App/Assets.xcassets/AppIcon.appiconset` da hozir Capacitor’ning standart belgisi turibdi. 1024×1024 PNG (shaffof fonsiz) belgini shu yerga Xcode orqali sudrab qo‘ying. Belgi va splash’larni avtomatik yaratish uchun:

```bash
npm install --save-dev @capacitor/assets
# assets/icon.png (1024×1024) va assets/splash.png (2732×2732) fayllarini tayyorlab:
npx capacitor-assets generate --ios
```

---

## 6. Sinash

### 6.1. Simulyatorda

1. Xcode yuqori panelidan qurilmani tanlang, masalan “iPhone 16”.
2. **Product → Run** (⌘R).

Simulyator Mac’ning `localhost` iga kira oladi. Shuning uchun serverni Mac’da ishga tushirib (`npm start`), ilovaning kirish oynasida **Server manzili** maydoniga `http://localhost:3000` yozsangiz bo‘ladi.

### 6.2. O‘z iPhone’ingizda

1. iPhone’ni kabel bilan ulang va “Trust This Computer” ni tasdiqlang.
2. iPhone’da: Settings → Privacy & Security → **Developer Mode** → yoqing (telefon qayta yonadi).
3. Xcode’da qurilma sifatida iPhone’ingizni tanlab, **Product → Run** ni bosing.
4. Birinchi ishga tushirishda: Settings → General → VPN & Device Management → dasturchi profilini **Trust** qiling.

Haqiqiy telefon Mac’ning `localhost` iga ulana olmaydi — unga HTTPS server manzilini kiriting.

---

## 7. `.ipa` faylini yig‘ish

### 7.1. Xcode orqali (eng oson yo‘l)

1. Qurilma sifatida **Any iOS Device (arm64)** ni tanlang.
2. **Product → Archive**. Yig‘ish tugagach, **Organizer** oynasi ochiladi.
3. Arxivni tanlab, **Distribute App** ni bosing:
   - **App Store Connect** — TestFlight va App Store uchun;
   - **Release Testing** (eski nomi Ad Hoc) — UDID’lari ro‘yxatga olingan qurilmalar uchun `.ipa`;
   - **Debugging** (eski nomi Development) — o‘z qurilmalaringiz uchun.
4. **Export** ni tanlasangiz, Xcode `.ipa` faylini siz ko‘rsatgan papkaga saqlaydi.

### 7.2. Buyruq qatori orqali

Loyiha ildizida `ExportOptions.plist` faylini yarating. `TEAMID` o‘rniga o‘z Team ID’ingizni yozing — uni developer.apple.com → Membership bo‘limidan olasiz:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>release-testing</string>   <!-- yoki: app-store-connect, debugging -->
  <key>teamID</key>
  <string>TEAMID</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>compileBitcode</key>
  <false/>
</dict>
</plist>
```

Keyin quyidagi buyruqlarni ishga tushiring:

```bash
# Veb fayllarni yangilash
npx cap sync ios

# Arxiv yaratish
xcodebuild \
  -project ios/App/App.xcodeproj \
  -scheme App \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath build/RoutineTracker.xcarchive \
  -allowProvisioningUpdates \
  archive

# Arxivdan .ipa chiqarish
xcodebuild \
  -exportArchive \
  -archivePath build/RoutineTracker.xcarchive \
  -exportOptionsPlist ExportOptions.plist \
  -exportPath build/ipa \
  -allowProvisioningUpdates

ls build/ipa   # → App.ipa
```

Xcode 15.3 dan eski versiyalarda `method` qiymatlarining eski nomlaridan foydalaning: `app-store`, `ad-hoc`, `development`.

### 7.3. TestFlight / App Store

- `.ipa` ni App Store Connect’ga **Xcode Organizer → Distribute App → App Store Connect → Upload** orqali yoki Apple’ning **Transporter** ilovasi bilan yuklang.
- App Store Connect’da (appstoreconnect.apple.com) oldindan ilova yozuvini yarating: Bundle ID `uz.routine.tracker`.
- App Review uchun **sinov hisobi** (email va parol) va ishlayotgan server kerak bo‘ladi. Ilova serversiz ishlamaydi, shuning uchun sharhlovchi kira oladigan server manzilini `DEFAULT_NATIVE_API_URL` ga yozib yig‘ing.

---

## 8. Xavfsizlik bo‘yicha qarorlar

| Qaror | Sababi |
|---|---|
| Ilova serverga cookie bilan emas, **Bearer token** bilan ulanadi | Ilova va server turli manbalarda joylashgan; cookie ilova uchun ishonchsiz, token esa har bir so‘rov bilan aniq yuboriladi |
| CORS standart holatda faqat `capacitor://localhost` ga ruxsat beradi | Bu manbani hech bir veb-sahifa taqdim eta olmaydi, shuning uchun internetga hech narsa ochilmaydi |
| HTTPS majburiy (`config.js`, CSP va ATS — uchalasi bir xil qoida) | Token har bir so‘rovda yuboriladi; `http://` faqat Mac’dagi sinov serveri uchun |
| `index.html` da meta CSP | Web’da serverning CSP sarlavhasi bor, ilovada esa yo‘q. Meta CSP ilovada begona skriptlarni bloklaydi |
| Web versiyasi saqlangan server manzilini e’tiborsiz qoldiradi | Brauzerdagi `localStorage` ga yozilgan qiymat so‘rovlarni (va tokenni) boshqa serverga yo‘naltira olmasligi uchun |
| `@capacitor/*` faqat `devDependencies` da | Server faqat 4 ta kutubxona bilan ishlaydi; `npm install --omit=dev` qilinganda Capacitor o‘rnatilmaydi |

---

## 9. Cheklovlar

Quyidagilarni oldindan bilib qo‘yish kerak:

- **Ilova oflayn ishlamaydi.** Barcha ma’lumotlar serverda. Internet bo‘lmasa, ilova “Serverga ulanib bo‘lmadi” deb ko‘rsatadi. Oflayn rejim ma’lumotlarni telefonda saqlab, keyin sinxronlashni talab qiladi — bu alohida katta ish.
- **Eslatmalar ilova ochiq turganda ishlaydi.** Ilova yopiq bo‘lganda bildirishnoma yuborish uchun APNs push xizmati kerak (`@capacitor/push-notifications`, Apple push kaliti, serverdan yuborish).
- **Sinov qamrovi:** iOS loyihasi Windows’da yaratildi va tekshirildi, lekin Mac bo‘lmagani uchun **kompilyatsiya qilinmagan va iPhone’da ishga tushirilmagan**. Ilova rejimi brauzerda taqlid qilib sinaldi: sahifa bir manbadan, API boshqa manbadan (CORS + Bearer token + meta CSP) ishladi — kirish, “Bugun” sahifasi va CSV eksport. Birinchi Mac yig‘ishida, ayniqsa, JSON/CSV eksportning WKWebView’da fayl sifatida saqlanishini tekshiring.
- Ilova yangilanganda (`public/` o‘zgarsa) uni qayta yig‘ib, qayta tarqatish kerak. Server yangilanishi esa ilovani qayta yig‘ishni talab qilmaydi.

---

## 10. Muammolarni hal qilish

| Belgi | Sabab va yechim |
|---|---|
| Kirishda “Serverga ulanib bo‘lmadi” | Manzil `https://` bilan boshlanadimi? Sertifikat haqiqiymi (o‘zi imzolagan sertifikat ishlamaydi)? Serverda `CORS_ORIGINS` yozilgan bo‘lsa, unda `capacitor://localhost` bormi? 3-bo‘limdagi `curl` tekshiruvini bajaring |
| Ilova oq ekran bilan ochiladi | `npx cap copy ios` ni bajarmagansiz — `ios/App/App/public` bo‘sh. Safari → Develop → [qurilma] orqali konsol xatolarini ko‘ring |
| Kodni o‘zgartirdim, ilovada eskisi turibdi | `npx cap copy ios`, keyin Xcode’da Product → Clean Build Folder (⇧⌘K) va qayta Run |
| “No signing certificate” / “Provisioning profile” xatosi | 5.2-bo‘lim: Team tanlanganmi, “Automatically manage signing” belgilanganmi |
| “Resolving Package Graph” da to‘xtab qolyapti | Internetni tekshiring; File → Packages → Reset Package Caches |
| `xcodebuild: error: ... requires a development team` | `ExportOptions.plist` dagi `teamID` ni tekshiring va `-allowProvisioningUpdates` ni qo‘shing |

### Ilova ichidagi xatolarni ko‘rish

1. iPhone’da: Settings → Apps → Safari → Advanced → **Web Inspector** ni yoqing.
2. Mac’dagi Safari’da: Settings → Advanced → “Show features for web developers”.
3. Safari → **Develop** → [iPhone yoki simulyator] → Routine Tracker. Konsol va tarmoq so‘rovlari shu yerda ko‘rinadi.
