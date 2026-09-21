# Routine Tracker — Texnik topshiriq

| | |
|---|---|
| **Versiya** | 1.2 |
| **Sana** | 19.09.2026 |
| **Buyurtmachi** | Bakhrom |
| **Holat** | Ishlaydigan tizim + reja |
| **Repozitoriy** | `BakhouddinGayratov/Routine-Tracker` |

Kundalik rejimlarni vaqti bilan rejalashtirish, bajarilganini belgilash va natijani kuzatish uchun veb-ilova. Hujjatda tizimning hozirgi holati, unga qo‘yiladigan talablar va interfeysni yaxshilash rejasi yozilgan.

## Mundarija

1. [Umumiy ma‘lumot](#1-umumiy-malumot)
2. [Asosiy tushunchalar](#2-asosiy-tushunchalar)
3. [Funksional talablar](#3-funksional-talablar)
4. [Ma‘lumotlarni saqlash](#4-malumotlarni-saqlash)
5. [Nofunksional talablar](#5-nofunksional-talablar)
6. [Texnik yechim](#6-texnik-yechim)
7. [Ma‘lumotlar modeli](#7-malumotlar-modeli)
8. [API](#8-api)
9. [Interfeysni yaxshilash](#9-interfeysni-yaxshilash)
10. [Qabul qilish mezonlari](#10-qabul-qilish-mezonlari)
11. [Keyingi bosqichlar](#11-keyingi-bosqichlar)

---

## 1. Umumiy ma‘lumot

### 1.1. Loyiha maqsadi

Foydalanuvchi har bir ishini vaqti bilan kiritadi va uni bajarilgan yoki bajarilmagan deb belgilaydi. Tizim shu belgilardan kunlik, haftalik va oylik natijani, ketma-ket bajarilgan kunlar sonini, statistikani va yutuqlarni hisoblaydi. Har bir foydalanuvchi ro‘yxatdan o‘tadi, uning ma‘lumotlari esa kunma-kun saqlanib boradi.

### 1.2. Foydalanuvchilar

Odatlarini tartibga solmoqchi bo‘lgan har qanday odam. Odatda ilova telefon yoki kompyuterda kuniga bir necha marta ochiladi va bajarilgan ish bir bosishda belgilanadi. Shuning uchun interfeys telefon ekranida ham to‘liq ishlashi shart.

### 1.3. Hujjatdagi belgilar

| Belgi | Ma‘nosi |
|---|---|
| ✅ **Bajarilgan** | tizimda bor va ishlaydi |
| 🕓 **Rejada** | hali qilinmagan |
| ❌ **Xato** | topilgan kamchilik, tuzatish kerak |

Talablar identifikator bilan raqamlangan: `FT` — funksional, `MS` — ma‘lumotlarni saqlash, `NT` — nofunksional, `UI` — interfeys. Muhokamada talabni shu raqam bilan aytish mumkin.

---

## 2. Asosiy tushunchalar

Tizim ikkita asosiy tushunchaga qurilgan: **reja** (nima, qachon, qanchalik tez-tez) va **haqiqatda nima bo‘lgani**. Qolgan hamma narsa shu ikkisidan hisoblanadi.

| Tushuncha | Ta‘rifi |
|---|---|
| **Rejim (routine)** | Bajariladigan ish: nomi, boshlanish va tugash vaqti, qaysi kun yoki kunlarda bo‘lishi. Masalan, “Doktorga borish, 20-sentabr, 10:00–11:00” yoki “Ertalabki mashq, 06:00–07:30, har kuni”. |
| **Belgi (log)** | Rejimning ma‘lum bir kundagi natijasi: bajarildi, o‘tkazib yuborildi yoki qisman. Har bir rejim uchun kuniga faqat bitta belgi bo‘ladi. |
| **Maqsad** | Rejim nima uchun kerakligini bildiradi: rejimlar uni amalga oshirishga xizmat qiladi. Maqsadning o‘z jadvali yo‘q — uning natijasi unga bog‘langan rejimlardan hisoblanadi. |
| **Kundalik** | Kun haqida erkin yozuv, kayfiyat va energiya darajasi (1–5). |

---

## 3. Funksional talablar

Tizim modullar bo‘yicha nima qila olishi kerakligi. Holat 19.09.2026 dagi kodga qarab tekshirilgan.

### 3.1. Hisob va kirish

| ID | Talab | Holat |
|---|---|---|
| FT-01 | Email va parol bilan ro‘yxatdan o‘tish. Parol kamida 8 belgi bo‘lib, harf va raqamdan iborat bo‘lishi shart. Yangi hisobga boshlang‘ich rejimlar to‘plami beriladi. | ✅ Bajarilgan |
| FT-02 | Kirish, chiqish va sessiyani eslab qolish. Sahifa yangilanganda foydalanuvchi tizimdan chiqib ketmaydi. Chiqilganda token darhol bekor qilinadi. | ✅ Bajarilgan |
| FT-03 | Faol sessiyalar ro‘yxati va boshqa qurilmadan chiqish | ✅ Bajarilgan |
| FT-04 | Parolni o‘zgartirish va hisobni o‘chirish. Hisob o‘chirilganda uning barcha ma‘lumotlari bitta amal bilan o‘chadi. | ✅ Bajarilgan |
| FT-05 | Parolni email orqali tiklash. Hozir tizimda email yuborish imkoniyati yo‘q. | 🕓 Rejada |

### 3.2. Rejimlar

| ID | Talab | Holat |
|---|---|---|
| FT-10 | Rejim qo‘shish uchun faqat nomi va “soat nechidan — nechigacha” kiritiladi. Qolgan maydonlar “Qo‘shimcha sozlamalar” ostida yashirin turadi va standart qiymatga ega. Davomiylik ikki vaqtdan avtomatik hisoblanadi, yarim tundan oshsa ham to‘g‘ri chiqadi. Vaqt kiritilmasa, rejim “istalgan vaqt” hisoblanadi. | ✅ Bajarilgan |
| FT-11 | Rejimni maqsadga bog‘lash. Standart qiymat — “Maqsadsiz”: foydalanuvchi o‘zi maqsad tanlamaguncha shunday qoladi. | ✅ Bajarilgan |
| FT-12 | **Yangi rejim faqat u qo‘shilgan kunda bo‘ladi.** Kun sahifasida (masalan, 20-sentabr) qo‘shilgan rejim faqat o‘sha kunga yoziladi va boshqa kunlarda paydo bo‘lmaydi. Yuqoridagi “Rejim qo‘shish” tugmasi, tezkor tugma `N` va buyruqlar oynasi ham ko‘rib turilgan kunni oladi, boshqa sahifalarda — bugungi kunni. Takrorlanishni foydalanuvchi o‘zi tanlaydi: “Qo‘shimcha sozlamalar → Takrorlanish”. | ✅ Bajarilgan |
| FT-13 | Takrorlanish turlari: faqat bir marta (standart), har kuni, haftaning tanlangan kunlari, har N kunda, oyning tanlangan kunlari. Boshlanish va ixtiyoriy tugash sanasi bilan. | ✅ Bajarilgan |
| FT-14 | Oddiy belgi yoki o‘lchanadigan maqsad, masalan, “20 bet”, “8 stakan”. Qisman bajarilgani foizda hisobga olinadi. | ✅ Bajarilgan |
| FT-15 | Belgi, rang, turkum (10 ta), muhimlik, eslatma, izoh | ✅ Bajarilgan |
| FT-16 | Tahrirlash, nusxa olish, arxivlash, o‘chirish | ✅ Bajarilgan |
| FT-17 | Tayyor shablonlar (5 ta to‘plam) bir bosishda qo‘shiladi | ✅ Bajarilgan |
| FT-18 | Rejimlar tartibini sudrab o‘zgartirish: sichqoncha, barmoq (telefon) yoki strelka tugmalari bilan. Tartib serverda saqlanadi va “Rejimlar” sahifasi shu tartibda chiqadi. | ✅ Bajarilgan |

Turkumlar: Salomatlik, Sport, Ish, O‘qish, Shaxsiy, Xotirjamlik, Muloqot, Moliya, Uy, Boshqa.

### 3.3. Maqsadlar

| ID | Talab | Holat |
|---|---|---|
| FT-20 | Maqsad yaratish: nomi, tavsifi, belgisi, rangi, ixtiyoriy muddati | ✅ Bajarilgan |
| FT-21 | Maqsad kartasida oxirgi 30 kundagi bajarilish foizi va bog‘langan rejimlar ko‘rsatiladi. Hali rejimi yo‘q maqsad uchun 0% emas, “rejim yo‘q” yoziladi: rejalashtirilmagan ish bilan bajarilmagan ish bir xil narsa emas. | ✅ Bajarilgan |
| FT-22 | Maqsadni “erishildi” deb belgilash va qayta ochish; faol / erishilgan / hammasi filtri | ✅ Bajarilgan |
| FT-23 | Maqsad o‘chirilganda rejimlar saqlanib qoladi, faqat maqsad bilan bog‘lanishi uziladi | ✅ Bajarilgan |

### 3.4. Bugun, Kalendar, Statistika

| ID | Talab | Holat |
|---|---|---|
| FT-30 | “Bugun” sahifasi: ertalab / kunduzi / kechqurun / tun bo‘yicha guruhlangan ro‘yxat, joriy vaqt belgisi, bajarilish halqasi, hafta tasmasi, “Hammasini bajarildi deb belgilash” va “Kechagini nusxalash” tugmalari | ✅ Bajarilgan |
| FT-31 | Kalendar: oylik to‘r ko‘rinishi, har kun uchun bajarilish va kayfiyat | ✅ Bajarilgan |
| FT-32 | Statistika: bajarilish dinamikasi, hafta kunlari va turkumlar kesimi, yillik faollik xaritasi, eng kuchli va eng zaif rejimlar, oldingi davr bilan solishtirish | ✅ Bajarilgan |
| FT-33 | Ketma-ket kunlar hisobi (streak) dam olish kunlari uchun jazolamaydi. Hech narsa rejalashtirilmagan kun streakni na uzaytiradi, na uzadi. Bugungi kun tugamaguncha streak uzilmaydi. | ✅ Bajarilgan |

### 3.5. Kundalik, yutuqlar, sozlamalar

| ID | Talab | Holat |
|---|---|---|
| FT-40 | Kundalik: erkin matn, kayfiyat va energiya (1–5), avtomatik saqlanadi | ✅ Bajarilgan |
| FT-41 | Yutuqlar: XP, darajalar, 18 ta nishon; har bir nishon faqat bir marta nishonlanadi | ✅ Bajarilgan |
| FT-42 | Sozlamalar: profil, mavzu (qorong‘i / yorug‘), til, hafta boshi, kunlik maqsad foizi, brauzer eslatmalari | ✅ Bajarilgan |
| FT-43 | Buyruqlar oynasi (`Ctrl+K`) va tezkor tugmalar: `N` — yangi rejim; `T`, `R`, `G`, `C`, `S`, `J`, `A` — sahifalarga o‘tish | ✅ Bajarilgan |
| FT-44 | Tillar: o‘zbek, rus, ingliz — interfeysning har bir matni uchala tilda ham bor. Sana, oy va hafta kunlari tanlangan tilda chiqadi. Brauzerlarda o‘zbekcha sana nomlari yo‘qligi sababli ular dasturda qo‘lda yozilgan (“Yakshanba, 20-sentabr, 2026”). | ✅ Bajarilgan |

### 3.6. Telefon, ilova va eslatmalar

| ID | Talab | Holat |
|---|---|---|
| FT-50 | Eslatmalar sayt yopiq bo‘lsa ham keladi (Web Push). Server har daqiqada foydalanuvchining o‘z vaqt mintaqasi bo‘yicha tekshiradi; bajarilgan yoki o‘tkazib yuborilgan rejim uchun eslatma yuborilmaydi; bitta eslatma ikki marta kelmaydi. Sozlamalarda holat va “Sinab ko‘rish” tugmasi bor. | ✅ Bajarilgan |
| FT-51 | Saytni telefonga ilova sifatida o‘rnatish (PWA): manifest, PNG belgilar, service worker. Internet yo‘q bo‘lsa, ilova ochiladi va “Serverga ulanib bo‘lmadi” deb ko‘rsatadi — hisobdan chiqarib yubormaydi. | ✅ Bajarilgan |
| FT-52 | iOS ilovasi (Capacitor): `uz.routine.tracker`, Xcode loyihasi `ios/` papkasida. Yig‘ish qo‘llanmasi — `IOS_BUILD.md`. Server manzili kirish oynasida kiritiladi. | ✅ Tayyor (yig‘ish Mac’da) |
| FT-53 | iOS ilovasiga push eslatmalar (APNs). Hozir iOS ilovada eslatmalar faqat ilova ochiq turganda keladi. | 🕓 Rejada |

---

## 4. Ma‘lumotlarni saqlash

> **Buyurtmachi uchun eng muhim talab.** Foydalanuvchilar, rejimlar, belgilar, maqsadlar va kundalik yozuvlar dastur yangilanganidan keyin ham to‘liq saqlanib qolishi shart. Kodga kiritilgan hech bir o‘zgarish mavjud ma‘lumotlarni o‘chirmasligi kerak.

| ID | Talab | Holat |
|---|---|---|
| MS-01 | Ma‘lumotlar diskdagi faylda saqlanadi, server qayta ishga tushsa ham yo‘qolmaydi. Fayl: `data/routine-tracker.sqlite`. U GitHub’ga yuklanmaydi va faqat server turgan kompyuterda saqlanadi. | ✅ Bajarilgan |
| MS-02 | Baza tuzilmasi o‘zgarganda eski baza avtomatik yangilanadi (migratsiya). Har bir o‘zgarish raqamlangan va faqat bir marta ishlaydi. Qaysi migratsiyalar bajarilgani bazaning o‘zida yoziladi. Migratsiya xato bersa, u butunlay bekor qilinadi va baza oxirgi ishlagan holatida qoladi. | ✅ Bajarilgan |
| MS-03 | Server ishga tushganda qaysi migratsiya bajarilgani jurnalga yoziladi | ✅ Bajarilgan |
| MS-04 | Foydalanuvchi o‘z ma‘lumotlarini JSON va CSV ko‘rinishida yuklab ola oladi. JSON faylda barcha ma‘lumotlar, jumladan maqsadlar ham bor. CSV faylda faqat belgilar tarixi bor — jadval dasturlari uchun. | ✅ Bajarilgan |
| MS-05 | Bazaning avtomatik zaxira nusxasi: server har kuni `data/backups/routine-tracker-YYYY-MM-DD.sqlite` faylini yaratadi va oxirgi 7 kunlikni saqlaydi. Nusxa SQLite’ning o‘zi orqali (`VACUUM INTO`) olinadi, shuning uchun u doim butun va to‘g‘ri bo‘ladi. Qo‘lda: `npm run backup`. Tiklash: serverni to‘xtatib, nusxani `data/routine-tracker.sqlite` o‘rniga ko‘chirish. | ✅ Bajarilgan |
| MS-06 | Eksport qilingan JSON faylni qayta yuklash (import) | 🕓 Rejada |

### 4.1. Yangi migratsiya qo‘shish qoidalari

- Versiya raqami bittaga oshiriladi; chiqarilgan migratsiya hech qachon o‘zgartirilmaydi va qayta raqamlanmaydi.
- Iloji boricha faqat yangi narsa qo‘shiladi: yangi ustun, yangi jadval. Ustun yoki jadvalni o‘chirish alohida kelishiladi.
- Migratsiya qayta ishga tushsa ham zarar yetkazmasligi kerak.
- Haqiqiy bazaga qo‘llashdan oldin uning nusxasida sinab ko‘riladi.

---

## 5. Nofunksional talablar

| ID | Talab | Holat |
|---|---|---|
| NT-01 | Parollar bcrypt (cost 12) bilan saqlanadi va hech qachon ochiq ko‘rinishda qaytarilmaydi | ✅ Bajarilgan |
| NT-02 | Kirish oynasi orqali qaysi email ro‘yxatdan o‘tganini bilib bo‘lmaydi: noma’lum email ham, noto‘g‘ri parol ham bir xil javob beradi va bir xil vaqt oladi | ✅ Bajarilgan |
| NT-03 | Foydalanuvchi yozgan matn hech qachon HTML sifatida o‘qilmaydi; server qat’iy CSP sarlavhasini yuboradi | ✅ Bajarilgan |
| NT-04 | So‘rovlar chegarasi: bir manzildan daqiqasiga 300 ta | ✅ Bajarilgan |
| NT-05 | Har bir foydalanuvchi faqat o‘z ma‘lumotini ko‘radi va o‘zgartiradi. Jumladan, rejimni boshqa foydalanuvchining maqsadiga bog‘lab bo‘lmaydi. | ✅ Bajarilgan |
| NT-06 | Interfeys 375 px kenglikdagi telefondan tortib katta ekrangacha to‘g‘ri ishlaydi, sahifa yon tomonga siljimaydi. Tekshirilgan: 9 ta sahifaning hammasida sahifa kengligi ekran kengligiga teng. | ✅ Bajarilgan |
| NT-07 | Qorong‘i va yorug‘ mavzu bir xil sifatda ishlaydi | ✅ Bajarilgan |
| NT-08 | Windows + Node 24 da kompilyatorsiz o‘rnatiladi: faqat 4 ta kutubxona, ularning hech biri “native” emas. Capacitor faqat ishlab chiqish uchun (devDependencies) qo‘shilgan. | ✅ Bajarilgan |
| NT-09 | SQLite: WAL rejimi, `busy_timeout = 5000`, `foreign_keys = ON` — uchalasi ham test bilan tasdiqlangan | ✅ Bajarilgan |
| NT-10 | Push obunasining manzili faqat ma’lum push xizmatlariga (Google, Mozilla, Apple, Microsoft) va faqat HTTPS orqali bo‘lishi mumkin — server ichki manzillarga so‘rov yubora olmaydi (SSRF himoyasi) | ✅ Bajarilgan |
| NT-11 | Yorug‘ mavzudagi kichik yozuvlar WCAG AA kontrastiga javob beradi (≥ 4.5:1) | ✅ Bajarilgan |
| NT-12 | iOS ilova faqat HTTPS serverga ulanadi (`localhost` — sinov uchun istisno); ilova ichida ham CSP himoyasi bor | ✅ Bajarilgan |
| NT-13 | Production kutubxonalarida ma’lum zaifliklar yo‘q (`npm audit --omit=dev`) | ✅ Bajarilgan |

---

## 6. Texnik yechim

| Qism | Yechim |
|---|---|
| Server | Node.js 22.13+ (Node 24 da sinab ko‘rilgan), Express 4 |
| Baza | SQLite, Node’ga o‘rnatilgan `node:sqlite` |
| Mijoz | Oddiy JavaScript modullari; framework ham, yig‘uvchi (bundler) ham yo‘q |
| Grafiklar | Qo‘lda chizilgan SVG, kutubxonasiz |
| Autentifikatsiya | JWT va bazadagi sessiyalar, 30 kunlik |
| Testlar | 75 ta API testi; 30 ta brauzer testi (Playwright alohida o‘rnatiladi) |
| Push | Web Push (VAPID + RFC 8291 shifrlash), qo‘shimcha kutubxonasiz |
| iOS | Capacitor 8.5.2 |

### 6.1. Ishga tushirish

```bash
npm install
npm start          # http://localhost:3000
npm run seed       # demo hisob: demo@routine.app / demopass123
npm test           # API testlari
npm run backup     # hozirning o‘zida zaxira nusxa olish
```

---

## 7. Ma‘lumotlar modeli

Bazada 7 ta jadval bor. Hammasi foydalanuvchiga bog‘langan: hisob o‘chirilsa, unga tegishli hamma narsa ham o‘chadi.

| Jadval | Nima saqlanadi |
|---|---|
| `users` | Email, parol xeshi, ism, mavzu, til, vaqt mintaqasi, hafta boshi, kunlik maqsad foizi |
| `goals` | Maqsad: nomi, tavsifi, belgisi, rangi, muddati, holati (faol / erishildi / arxiv) |
| `routines` | Rejim: nomi, vaqti, davomiyligi, takrorlanish qoidasi, o‘lchov turi, maqsadga havola (bo‘lmasligi ham mumkin) |
| `logs` | Rejimning bir kundagi natijasi. Bitta rejim va bitta kun uchun faqat bitta yozuv |
| `journal` | Kundalik yozuvi, kayfiyat va energiya; bir kunga bitta |
| `achievements` | Ochilgan nishonlar va ochilgan vaqti |
| `sessions` | Har bir kirish; chiqishda va parol o‘zgarganda bekor qilinadi |

Rejimning kelgusi kunlari bazada saqlanmaydi — ular takrorlanish qoidasidan har safar qaytadan hisoblanadi. Shuning uchun rejim jadvali o‘zgartirilsa, kalendar va statistika darhol yangilanadi. Bir martalik rejim faqat boshlanish sanasida chiqadi.

---

## 8. API

Barcha manzillar `/api` ostida. `/health`, ro‘yxatdan o‘tish va kirishdan boshqa barcha manzillar uchun hisobga kirilgan bo‘lishi shart.

| Bo‘lim | Manzillar |
|---|---|
| Hisob | `POST /auth/register`, `/auth/login`, `/auth/logout`, `/auth/password`; `GET`·`PATCH`·`DELETE /auth/me`; `GET /auth/sessions`, `DELETE /auth/sessions/:id` |
| Rejimlar | `GET`·`POST /routines`; `GET`·`PATCH`·`DELETE /routines/:id`; `POST /routines/:id/duplicate`, `/routines/:id/postpone`, `/routines/reorder` |
| Maqsadlar | `GET`·`POST /goals`; `PATCH`·`DELETE /goals/:id` |
| Kunlar | `GET /days/:date`, `/days/:date/week`, `/days/month/:y/:m`; `POST /days/log`, `/days/:date/complete-all`, `/days/:date/copy-from`; `GET /days/upcoming/list` |
| Statistika | `GET /stats/summary`, `/stats/overview`, `/stats/heatmap`, `/stats/routines`, `/stats/achievements` |
| Kundalik | `GET /journal`; `GET`·`PUT /journal/:date` |
| Boshqa | `GET /templates`, `POST /templates/:id/apply`; `GET /search`, `/export`, `/export.csv` |

---

## 9. Interfeysni yaxshilash

Har bir sahifa 18.09.2026 da demo ma‘lumotlar bilan kompyuter va telefon (375 px) o‘lchamida ko‘rib chiqildi. G‘oyalar muhimlik tartibida berilgan: avval xatolar, keyin qulaylik, oxirida ko‘rinish.

> **Holat 19.09.2026:** quyidagi 13 bandning hammasi bajarildi (✅). Har birining qanday qilingani va nima uchun shunday qilingani git tarixidagi commit izohlarida yozilgan.

### Birinchi navbat — xatolar

#### UI-01. Telefonda sahifa ekranga sig‘maydi ✅

- **Nima ko‘rindi.** 375 px ekranda “Bugun” sahifasining kengligi 398 px bo‘lib chiqadi va sahifa yon tomonga siljiydi: salomlashuv, streak nishoni va qidiruv tugmasi kesiladi. Pastki menyu esa 399 px: unda 6 ta bo‘lim bor, oxirgisi — “Sozlamalar” — ekrandan tashqarida qoladi. Menyu Maqsadlar 6-bo‘lim qilib qo‘shilgandan keyin sig‘may qolgan.
- **Nima qilish kerak.** Pastki menyuda 5 ta bo‘lim qoldirish, Sozlamalarni profil belgisiga o‘tkazish. “Bugun” ro‘yxatidagi rejim qatorida matn torayib, qisqarishi kerak; qatorning yonidagi tugmalar esa qatordan chiqib ketmasligi kerak.

#### UI-02. Yig‘ilgan yon menyuda bo‘lim nomlari yo‘q ✅

- **Nima ko‘rindi.** O‘rtacha kenglikdagi ekranda yon menyuda faqat belgilar qoladi. Belgi ustiga sichqoncha olib borilganda ham nomi chiqmaydi, shuning uchun nishon, kalendar va kitob belgilari qaysi bo‘lim ekanini taxmin qilishga to‘g‘ri keladi. Daraja va XP kartasi ham ko‘rinmay qoladi.
- **Nima qilish kerak.** Har bir belgiga ustiga olib borilganda chiqadigan nom (tooltip) qo‘shish va menyuni kengaytirish tugmasini berish.

### Ikkinchi navbat — qulaylik

#### UI-03. Telefonda “Bugun” ro‘yxati birinchi ekranda ko‘rinmaydi ✅

- **Nima ko‘rindi.** Telefonda birinchi ekranni katta foiz halqasi va salomlashuv to‘liq egallaydi. Bajarilishi kerak bo‘lgan ishlarni ko‘rish uchun pastga aylantirish kerak — sahifaning asosiy vazifasi esa aynan shu ishlarni ko‘rsatish.
- **Nima qilish kerak.** Telefonda yuqori qismni ixcham qilish: kichik halqa, foiz va streak bir qatorda. Keyingi rejim darhol ko‘rinib tursin.

#### UI-04. “Keyingisi” paneli ✅

- **Nima ko‘rindi.** Kelgusi rejimlarni qaytaradigan server manzili (`/days/upcoming/list`) tayyor va sinovdan o‘tgan, lekin interfeysda ishlatilmaydi.
- **Nima qilish kerak.** “Bugun” sahifasining yuqorisida “Keyingisi: Kitob o‘qish · 20:00 · 45 daqiqadan keyin” kabi qator.

#### UI-05. Birinchi kirishda yo‘l ko‘rsatish ✅

- **Nima qilish kerak.** Rejimi yo‘q hisob uchun “Bugun” sahifasida uch qadam ko‘rsatish: maqsad qo‘shing → rejim qo‘shing yoki shablon tanlang → birinchi belgini qo‘ying. Hozir bo‘sh sahifada faqat bitta “qo‘shish” tugmasi bor.

#### UI-06. Kalendar ranglari izohsiz ✅

- **Nima ko‘rindi.** Kun katakchalaridagi chiziq uch rangda bo‘ladi: yashil — hammasi bajarilgan, binafsha — 50% yoki undan ko‘p, sariq — 50% dan kam. Lekin bu hech qayerda yozilmagan. Bundan tashqari, bu chegaralar foydalanuvchi sozlamalarda qo‘ygan kunlik maqsad foizini hisobga olmaydi. “9/10” soni juda kichik va xira, kayfiyat belgisi ham mayda.
- **Nima qilish kerak.** Kalendar ostiga ranglar izohini qo‘shish, yashil rangni foydalanuvchining kunlik maqsad foiziga bog‘lash, sonni kattaroq va to‘qroq qilish.

#### UI-07. Energiya shkalasi bir xil ko‘rinishda emas ✅

- **Nima ko‘rindi.** Kundalikda energiya 1 dan 5 gacha turli belgilar bilan berilgan: batareya, chaqmoq, olov, raketa. Ular bitta shkalaga emas, alohida narsalarga o‘xshaydi, shuning uchun 3 ning 4 dan kamligi darhol sezilmaydi.
- **Nima qilish kerak.** Bir xil belgi bilan to‘lib boradigan shkala qilish (masalan, 1 tadan 5 tagacha ustun). Kayfiyat tugmalaridagi yozuvlarni kattalashtirish.

#### UI-08. Maqsad kartasini boyitish ✅

- **Nima qilish kerak.** 30 kunlik foizdan tashqari kichik dinamika grafigini qo‘shish — uni chizadigan funksiya (`sparkline`) kodda bor, lekin ishlatilmayapti. Muddati bor maqsadda qolgan kunlarni ko‘proq ajratib ko‘rsatish. Maqsad kartasidan to‘g‘ridan-to‘g‘ri shu maqsadga yangi rejim qo‘shish imkonini berish.

#### UI-09. Rejimlarni sudrab tartiblash ✅

- **Nima qilish kerak.** “Rejimlar” sahifasida kartani sudrab joyini o‘zgartirish imkoni. Server tomoni tayyor (FT-18).

#### UI-10. Tez vaqt tanlash ✅

- **Nima qilish kerak.** Rejim qo‘shish oynasida vaqt maydonlari ostida tayyor tugmalar: “15 daq”, “30 daq”, “1 soat”. Boshlanish vaqti tanlangach, ulardan birini bosilsa, tugash vaqti o‘zi qo‘yiladi.

### Uchinchi navbat — ko‘rinish va ilova

#### UI-11. Telefonga ilova sifatida o‘rnatish ✅

- **Nima ko‘rindi.** Eslatmalar faqat sayt ochiq turganda keladi. Ilova manifesti bor, lekin service worker yo‘q.
- **Nima qilish kerak.** Service worker qo‘shish: sayt telefon ekraniga ilova sifatida o‘rnatiladigan bo‘lsin va eslatmalar sayt yopiq bo‘lsa ham kelsin.

#### UI-12. Yorug‘ mavzuni alohida ko‘rib chiqish ✅

- **Nima qilish kerak.** Dizayn qorong‘i mavzu uchun boshlangan. Yorug‘ mavzuda kichik yozuvlar kontrastini (kalendar sonlari, kartadagi yordamchi matn) WCAG AA darajasiga tekshirish.

#### UI-13. Kun yakunida qisqa xulosa ✅

- **Nima qilish kerak.** 100% ga yetilganda “Hammasi bajarildi” matni o‘rniga kun xulosasini ko‘rsatish: nechta rejim bajarildi, necha soat ketdi, qaysi maqsadga qancha hissa qo‘shildi. Kundalikka bir qator yozishni taklif qilish.

---

## 10. Qabul qilish mezonlari

Har bir yangi o‘zgarish quyidagi shartlar bajarilmaguncha tayyor hisoblanmaydi:

1. `npm test` — barcha testlar o‘tadi; yangi server manzili uchun yangi test qo‘shilgan.
2. Ilova mavjud bazaning nusxasi bilan ishga tushadi va barcha foydalanuvchilar, rejimlar, belgilar, maqsadlar hamda kundalik yozuvlar joyida qoladi (MS-02).
3. Sahifa 375 px telefon ekranida yon tomonga siljimaydi va hech narsa kesilmaydi (NT-06).
4. Har bir yangi matn o‘zbek, rus va ingliz tillarining uchalasiga ham qo‘shilgan.
5. O‘zgarish qorong‘i va yorug‘ mavzuda tekshirilgan.
6. Brauzer konsolida xato yo‘q.

---

## 11. Keyingi bosqichlar

Taklif etilayotgan tartib: avval ishlayotgan qismlardagi xatolarni tuzatish, keyin ma‘lumotlar xavfsizligi, so‘ng yangi imkoniyatlar.

| Bosqich | Tarkibi |
|---|---|
| 1. Ma‘lumotlar | MS-06 eksport qilingan JSON’dan qayta tiklash (import) |
| 2. iOS | Mac’da birinchi yig‘ish va iPhone’da sinash (`IOS_BUILD.md`), FT-53 iOS ilovaga push eslatmalar |
| 3. Hisob | FT-05 parolni email orqali tiklash (email yuborish xizmati kerak) |
| 4. Sifat | Avtomatik testlar (CI); brauzer testlarini yangi imkoniyatlarga moslash |

### 11.1. Ma‘lum cheklovlar

- Tizim bitta serverda ishlashga mo‘ljallangan: so‘rovlar chegarasi server xotirasida saqlanadi, baza esa bitta fayl. Bir nechta serverga kengaytirish uchun avval umumiy saqlash joyi kerak bo‘ladi.
- Email yuborish imkoniyati yo‘q, shuning uchun parolni tiklash va emailni tasdiqlash ham yo‘q.
- Avtomatik test tizimi (CI) yo‘q — testlar qo‘lda ishga tushiriladi.
- Oflayn rejimda ilova faqat ochiladi va ulanish yo‘qligini aytadi; ma’lumotni internetsiz ko‘rish yoki belgilash imkoni yo‘q.
- Sayt yopiq bo‘lganda keladigan eslatmalar iPhone’da faqat sayt Bosh ekranga qo‘shilgan bo‘lsa ishlaydi (iOS 16.4+) — bu Apple’ning cheklovi. Android va kompyuterdagi Chrome, Edge, Firefox’da oddiy brauzerdan ishlaydi. Server push’ni Google FCM qabul qilishi sinovdan o‘tgan, lekin bildirishnomaning ekranda ko‘rinishi haqiqiy qurilmada kuzatilmagan.
- Brauzer testlari (`npm run test:ui`) oldingi interfeys uchun yozilgan va bu yangilanishlardan keyin ishga tushirilmagan (Playwright o‘rnatilmagan).

---

*Routine Tracker · Texnik topshiriq v1.2 · 19.09.2026. Hujjat 19.09.2026 holatidagi kodga qarab tekshirilgan.*
