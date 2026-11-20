# Routine Tracker — Texnik topshiriq

| | |
|---|---|
| **Versiya** | 2.0 |
| **Sana** | 20.11.2026 |
| **Buyurtmachi** | Bakhrom |
| **Holat** | Ishlab turgan tizim (production) + keyingi reja |
| **Manzil** | https://routine-tracker-fvrh.onrender.com |
| **Repozitoriy** | `BakhouddinGayratov/Routine-Tracker`, shox `claude/manga-site-full-build-vjfk2v` |

Kundalik rejimlarni vaqti bilan rejalashtirish, bajarilganini (✓) yoki bajarilmaganini (✗) belgilash va natijani kuzatish uchun veb-ilova. Telefonga ilova sifatida o‘rnatiladi, eslatmalar sayt yopiq bo‘lsa ham keladi. Hujjatda tizimning hozirgi holati, unga qo‘yiladigan talablar va keyingi bosqichlar yozilgan.

## Mundarija

1. [Umumiy ma‘lumot](#1-umumiy-malumot)
2. [Asosiy tushunchalar](#2-asosiy-tushunchalar)
3. [Funksional talablar](#3-funksional-talablar)
4. [Interfeys va dizayn](#4-interfeys-va-dizayn)
5. [Ma‘lumotlarni saqlash](#5-malumotlarni-saqlash)
6. [Nofunksional talablar](#6-nofunksional-talablar)
7. [Texnik yechim va joylashtirish](#7-texnik-yechim-va-joylashtirish)
8. [Ma‘lumotlar modeli](#8-malumotlar-modeli)
9. [API](#9-api)
10. [Qabul qilish mezonlari](#10-qabul-qilish-mezonlari)
11. [Keyingi bosqichlar va cheklovlar](#11-keyingi-bosqichlar-va-cheklovlar)

---

## 1. Umumiy ma‘lumot

### 1.1. Loyiha maqsadi

Foydalanuvchi har bir ishini vaqti bilan kiritadi va kun davomida uni bajarilgan yoki bajarilmagan deb belgilaydi. Tizim shu belgilardan kunlik, haftalik va oylik natijani, ketma-ket kunlar sonini (streak), statistikani va yutuqlarni hisoblaydi. Har bir foydalanuvchi ro‘yxatdan o‘tadi; ma‘lumotlari serverda kunma-kun saqlanadi va istalgan qurilmadan ko‘rinadi.

### 1.2. Foydalanuvchilar

Odatlarini tartibga solmoqchi bo‘lgan har qanday odam — maktab o‘quvchisi, talaba, ishlaydigan odam. Ilova asosan telefonda, kuniga bir necha marta ochiladi; belgi bir bosishda qo‘yiladi. Shuning uchun interfeys avvalo telefon ekrani uchun qurilgan.

### 1.3. Hujjatdagi belgilar

| Belgi | Ma‘nosi |
|---|---|
| ✅ | tizimda bor va ishlaydi |
| 🕓 | rejada, hali qilinmagan |

Talablar raqamlangan: `FT` — funksional, `UI` — interfeys, `MS` — ma‘lumotlarni saqlash, `NT` — nofunksional.

---

## 2. Asosiy tushunchalar

Tizim ikki narsaga qurilgan: **reja** (nima, qachon, qanchalik tez-tez) va **haqiqatda nima bo‘lgani**. Qolgan hamma narsa shulardan hisoblanadi.

| Tushuncha | Ta‘rifi |
|---|---|
| **Rejim** | Bajariladigan ish: nomi, boshlanish va tugash vaqti, qaysi kun(lar)da bo‘lishi. Masalan, “SAT, 04:30–06:00, har kuni”. |
| **Belgi** | Rejimning bir kundagi natijasi: **✓ bajarildi**, **✗ bajarilmadi** yoki qisman. Bitta rejimga bir kunda bitta belgi. |
| **Chiqarilgan kun** | Takrorlanadigan rejimdan bitta kun olib tashlanishi (“faqat shu kunni o‘chirish”, “ertaga o‘tkazish”). Bu kun na bajarilgan, na bajarilmagan hisoblanadi. |
| **Maqsad** | Rejim nima uchun kerakligi. Maqsadning natijasi unga bog‘langan rejimlardan hisoblanadi. |
| **Kundalik** | Kun haqida erkin yozuv, kayfiyat va energiya (1–5). |
| **Qayd** | Kunga bog‘lanmagan qisqa yozuv — “unutmaslik kerak bo‘lgan narsa”. |

**✗ va o‘tkazish farqi.** ✗ — reja bajarilmadi, bu statistikani pasaytiradi. Rejani ertaga o‘tkazish yoki bitta kunni o‘chirish esa reja o‘zgarishi, u jazolanmaydi.

---

## 3. Funksional talablar

### 3.1. Hisob va kirish

| ID | Talab | Holat |
|---|---|---|
| FT-01 | Email va parol bilan ro‘yxatdan o‘tish. Parol kamida 8 belgi, harf va raqam. Yangi hisobga boshlang‘ich rejimlar beriladi. | ✅ |
| FT-02 | Kirish, chiqish, sessiyani eslab qolish; chiqilganda token darhol bekor bo‘ladi. | ✅ |
| FT-03 | Faol sessiyalar ro‘yxati va boshqa qurilmadan chiqish. | ✅ |
| FT-04 | Parolni o‘zgartirish; hisobni o‘chirish (barcha ma‘lumot bitta amal bilan o‘chadi). | ✅ |
| FT-05 | Parolni email orqali tiklash. | 🕓 |

### 3.2. Rejimlar

| ID | Talab | Holat |
|---|---|---|
| FT-10 | Rejim qo‘shish uchun faqat nomi va “soat nechidan — nechigacha”. Qolgani “Qo‘shimcha sozlamalar” ostida. Davomiylik ikki vaqtdan hisoblanadi (yarim tundan oshsa ham). Vaqtsiz rejim — “istalgan vaqt”. Tezkor tugmalar: 15 daq, 30 daq, 1 soat, 2 soat. | ✅ |
| FT-11 | Rejimni maqsadga bog‘lash; standart — “Maqsadsiz”. | ✅ |
| FT-12 | **Yangi rejim faqat qo‘shilgan kunda bo‘ladi** (standart “bir marta”). Takrorlanishni foydalanuvchi o‘zi tanlaydi. | ✅ |
| FT-13 | Takrorlanish: bir marta, har kuni, haftaning tanlangan kunlari, har N kunda, oyning tanlangan kunlari; boshlanish va ixtiyoriy tugash sanasi. | ✅ |
| FT-14 | Oddiy belgi yoki o‘lchanadigan maqsad (“20 bet”); qisman bajarilgani foizda. | ✅ |
| FT-15 | Belgi (emoji), rang, turkum (10 ta), muhimlik, eslatma, izoh. | ✅ |
| FT-16 | **Yangi rejim standartlari** (Sozlamalar): har bir foydalanuvchi takrorlanish, davomiylik, eslatma, turkum, muhimlik, belgi va rangning standart qiymatini o‘zi tanlaydi. Faqat yangi rejimlarga ta‘sir qiladi; formada qo‘llangan standartlar yozib ko‘rsatiladi. | ✅ |
| FT-17 | Nusxa olish, arxivlash, tayyor shablonlar (5 ta to‘plam), sudrab tartiblash. | ✅ |

### 3.3. Kun bo‘yicha amallar (“Bugun” sahifasidan)

| ID | Talab | Holat |
|---|---|---|
| FT-20 | **✓ Bajarildi** — bir bosish; qayta bosish bekor qiladi. | ✅ |
| FT-21 | **✗ Bajarilmadi** — rejim qizil ko‘rinadi, statistikada alohida “bajarilmagan” sifatida hisoblanadi va foizni pasaytiradi. Qayta bosish bekor qiladi. | ✅ |
| FT-22 | **Ertaga o‘tkazish.** Bir martalik rejim ertangi kunga ko‘chadi. Takrorlanadigan rejimda bugungi kun chiqariladi (✗ emas); ertaga rejim bo‘lmasa, ertaga uchun bir martalik nusxa qo‘yiladi. Takrorlanadiganida avval so‘raladi. | ✅ |
| FT-23 | **O‘chirish — ikki variant.** Takrorlanadigan rejimda: “Faqat shu kun uchun” (kun chiqariladi, qolgan kunlar joyida) yoki “Butunlay o‘chirish” (tarixi bilan). Bir martalikda oddiy tasdiqlash. | ✅ |
| FT-24 | **Tahrirlash faqat shu kunga ta‘sir qiladi.** “Bugun”dan qilingan tahrir boshqa kunlarni o‘zgartirmaydi: takrorlanadigan rejim uchun shu kunga alohida nusxa yaratiladi, kunning ✓/✗ belgisi unga o‘tadi. Takrorlanishni o‘zgartirish — “Rejimlar” sahifasidan. | ✅ |
| FT-25 | “Hammasini bajarildi deb belgilash” va “Kechagini nusxalash”. | ✅ |

### 3.4. Maqsadlar

| ID | Talab | Holat |
|---|---|---|
| FT-30 | Maqsad: nomi, tavsifi, belgisi, rangi, ixtiyoriy muddati; faol / erishilgan / arxiv. | ✅ |
| FT-31 | Kartada 30 kunlik foiz, dinamika grafigi va bog‘langan rejimlar. Rejimi yo‘q maqsadga “rejim yo‘q” yoziladi (0% emas). | ✅ |
| FT-32 | Maqsad o‘chirilsa, rejimlar qoladi — faqat bog‘lanish uziladi. | ✅ |

### 3.5. Kalendar, statistika, yutuqlar

| ID | Talab | Holat |
|---|---|---|
| FT-40 | Kalendar: oylik to‘r, har kun uchun bajarilish va kayfiyat, ranglar izohi. | ✅ |
| FT-41 | Statistika: davr natijasi so‘z bilan (“So‘nggi 30 kunda bajarilgan reja: 90% — oldingi davrdan 10% yaxshi”), dinamika, hafta kunlari va turkumlar kesimi, yillik faollik xaritasi, eng kuchli/zaif rejimlar, ✓ va ✗ soni. | ✅ |
| FT-42 | Streak dam olish kunini jazolamaydi; bugun tugamaguncha uzilmaydi. ✗ va bajarilmagan kun uni uzadi. | ✅ |
| FT-43 | Yutuqlar: XP, darajalar, 18 ta nishon; har biri bir marta nishonlanadi. | ✅ |

### 3.6. Kundalik va qaydlar

| ID | Talab | Holat |
|---|---|---|
| FT-50 | Kundalik: erkin matn, kayfiyat va energiya (1–5), avtomatik saqlanadi. | ✅ |
| FT-51 | **Qaydlar:** alohida sahifa va kundalik yozuv maydoni yonida panel. Enter bilan qo‘shish, tepaga qadash, bajarildi deb belgilash, joyida tahrirlash, o‘chirish. “Kundalikka qo‘shish” tugmasi qayd matnini yozuvga qo‘shadi. Hisobga 500 tagacha. | ✅ |

### 3.7. Eslatmalar va telefon

| ID | Talab | Holat |
|---|---|---|
| FT-60 | Web Push eslatmalar sayt yopiq bo‘lsa ham keladi. Server har daqiqada foydalanuvchining vaqt mintaqasi bo‘yicha tekshiradi; bajarilgan/✗ rejimga eslatma ketmaydi; bitta eslatma ikki marta kelmaydi; 10 daqiqadan ortiq kechiksa yuborilmaydi. | ✅ |
| FT-61 | Sozlamalarda qurilma obuna bo‘lmagan bo‘lsa — “Shu qurilmada yoqish” tugmasi; iPhone’ning oddiy Safari tabida — Bosh ekranga qo‘shish yo‘riqnomasi; “Sinab ko‘rish” tugmasi push xizmatining javobini ko‘rsatadi. | ✅ |
| FT-62 | Diagnostika: `GET /api/notifications/test-push` — obunalar soni, ulardan nechtasi Apple, har birining javobi va maslahat. | ✅ |
| FT-63 | Telefonga ilova sifatida o‘rnatish (PWA): manifest, ikonkalar, service worker, oflayn ochilish. | ✅ |
| FT-64 | iOS ilovasi (Capacitor, `uz.routine.tracker`), qo‘llanma `IOS_BUILD.md`. Yig‘ish Mac’da. | ✅ tayyor |
| FT-65 | iOS ilovaga APNs push. | 🕓 |

### 3.8. Umumiy

| ID | Talab | Holat |
|---|---|---|
| FT-70 | Buyruqlar oynasi (`Ctrl+K`) va tezkor tugmalar (`N` — yangi rejim, sahifalar harflari). | ✅ |
| FT-71 | Uch til: o‘zbek, rus, ingliz — har bir matn uchala tilda. O‘zbekcha sana nomlari dasturda yozilgan. | ✅ |
| FT-72 | JSON va CSV eksport (JSON’da rejimlar, belgilar, maqsadlar, kundalik, qaydlar). | ✅ |

---

## 4. Interfeys va dizayn

Dizayn “shablon sayt” belgilaridan (gradientlar, porlash, har yorliqda emoji, konfetti) voz kechgan holda qurilgan. Har bir mavzu — alohida xarakter.

| ID | Talab | Holat |
|---|---|---|
| UI-01 | **Uch mavzu**, Sozlamalarda o‘z ko‘rinishidagi kartalar orqali tanlanadi: **Daftar** (iliq qog‘oz, serif sarlavhalar, qizil qalam), **Tablo** (qora, limon rang, keng shrift — hisob taxtasi), **Siyoh** (to‘q ko‘k, mis rang, kechasi uchun). Standart — Daftar. | ✅ |
| UI-02 | Shriftlar serverning o‘zidan (Onest, Literata, Unbounded, JetBrains Mono; lotin, o‘zbek lotini va kirill). | ✅ |
| UI-03 | **Kun siferblati:** 24 soatlik doira, har rejim yoy: ✓ o‘z rangida, ✗ qizil, kelayotgani xira; mil — hozirgi vaqt. Markazda kun foizi. Logotip va ilova ikonkasi ham shu shakl (qog‘oz fonda qizil siferblat). | ✅ |
| UI-04 | **Jonli “Hozir” qatori:** davom etayotgan rejim, qolgan daqiqalar va jarayon chizig‘i; bo‘lmasa — keyingi rejim va qachon boshlanishi. Har daqiqada yangilanadi. | ✅ |
| UI-05 | **Soat jadvali** (ro‘yxat ko‘rinishiga almashtirsa bo‘ladi, tanlov eslab qolinadi): | ✅ |
| | – hamma rejimlar **bitta ustunda**, hech qachon yonma-yon emas; | |
| | – ustma-ust tushganda **avval tugaydigani** ko‘rsatiladi: qisqa rejim uzunning ichiga tushsa, uzuni ikkiga bo‘linadi (“SAT 1/2 → Bomdod → SAT 2/2 · davomi”); | |
| | – chap ustunda har blokning **aniq boshlanish va tugash daqiqasi** (04:15, 04:40…), butun soatlar faqat bo‘sh oraliqlarda; | |
| | – qisqa blok o‘qiladigan balandlikda, juda uzuni qisqartiriladi, 2+ soatlik bo‘shliq bitta “bo‘sh” qatoriga yig‘iladi; | |
| | – hech bir rejim yashirin qolmaydi; qizil “hozir” chizig‘i. | |
| UI-06 | Hafta chizig‘ida har kunning haqiqiy nisbati: yashil ✓, qizil ✗, kulrang qolgan. | ✅ |
| UI-07 | Animatsiyalar faqat o‘zgargan joyda: ✓ chiziladi, sarlavha qalamda o‘chirilgandek, ✗ silkinadi, sonlar sanab chiqadi. Kun tugaganda “Kun yopildi” muhri. “Harakatni kamaytirish” sozlamasi hurmat qilinadi. | ✅ |
| UI-08 | Bo‘sh holatlarda qo‘lda chizilgan SVG rasmlar. | ✅ |
| UI-09 | Telefon (375 px): pastki 5 tabli menyu, qolganlari profil menyusida; rejim tugmalari alohida qatorda; sana “9‑oktabr” bo‘linmaydi. | ✅ |

---

## 5. Ma‘lumotlarni saqlash

> **Eng muhim talab.** Foydalanuvchilar, rejimlar, belgilar, maqsadlar, kundalik va qaydlar dastur yangilanganidan keyin ham to‘liq saqlanib qolishi shart.

| ID | Talab | Holat |
|---|---|---|
| MS-01 | Ma‘lumotlar Supabase PostgreSQL bazasida (Frankfurt). Server qayta ishga tushsa yoki yangilansa ham yo‘qolmaydi. | ✅ |
| MS-02 | Baza tuzilmasi o‘zgarganda avtomatik migratsiya: raqamlangan, faqat bir marta, bitta tranzaksiyada (bitta ulanishda), xato bo‘lsa butunlay bekor. Bajarilganlar `schema_migrations` jadvalida. Hozir: 1 baseline, 2 `users.routine_defaults`, 3 `routines.excluded_dates`. | ✅ |
| MS-03 | Kunlik zaxira: barcha jadvallar gzip JSON ko‘rinishida, Supabase Storage’ning yopiq `backups` bucket’iga yuklanadi, oxirgi 7 tasi saqlanadi. Qo‘lda: `npm run backup`; tiklash: `npm run restore`. | ✅ |
| MS-04 | Foydalanuvchi o‘z ma‘lumotini JSON/CSV yuklab oladi. | ✅ |
| MS-05 | Eski SQLite bazadan ko‘chirish skripti (`scripts/import-sqlite.mjs`), ID’lar saqlanadi. | ✅ |
| MS-06 | Eksport qilingan JSON’ni qayta yuklash (import) foydalanuvchi interfeysidan. | 🕓 |

**Yangi migratsiya qoidalari:** versiya bittaga oshiriladi, chiqarilgani o‘zgartirilmaydi; iloji boricha faqat qo‘shiladi; qayta ishga tushsa zarar yo‘q; testlar PGlite’da, jonli bazada joylashtirishdan keyin tekshiriladi.

---

## 6. Nofunksional talablar

| ID | Talab | Holat |
|---|---|---|
| NT-01 | Parollar bcrypt (cost 12), hech qachon ochiq qaytarilmaydi. | ✅ |
| NT-02 | Kirish oynasidan qaysi email ro‘yxatda ekanini bilib bo‘lmaydi. | ✅ |
| NT-03 | Foydalanuvchi matni hech qachon HTML sifatida o‘qilmaydi; qat‘iy CSP. | ✅ |
| NT-04 | So‘rovlar chegarasi: daqiqasiga 300 ta. | ✅ |
| NT-05 | Har kim faqat o‘z ma‘lumotini ko‘radi va o‘zgartiradi (rejim, maqsad, qayd, push obunasi). | ✅ |
| NT-06 | 375 px telefondan katta ekrangacha; hech bir sahifa yon tomonga siljimaydi. | ✅ |
| NT-07 | Uch mavzuning har birida sifat bir xil; kichik yozuvlar WCAG AA kontrastda. | ✅ |
| NT-08 | Push manzili faqat ma‘lum push xizmatlari va HTTPS (SSRF himoyasi). Push xatolari jurnalga sababi bilan yoziladi. | ✅ |
| NT-09 | Yangilanish keyingi ochilishdayoq ko‘rinadi: kod `no-cache`, shriftlar 30 kun, rasmlar 1 kun; ikonka manzillarida versiya (`?v=3`); service worker kodni avval tarmoqdan oladi. | ✅ |
| NT-10 | Testlar hech qachon jonli bazaga ulanmaydi (`DATABASE_URL` testda bo‘sh, PGlite ishlatiladi). | ✅ |
| NT-11 | Maxfiy kalitlar (`DATABASE_URL`, `VAPID_PRIVATE_KEY`, `SUPABASE_SERVICE_KEY`, `JWT_SECRET`) repozitoriyga tushmaydi — faqat Render sozlamalari va git’ga kirmaydigan `data/render-env.txt`, `.env`. | ✅ |

---

## 7. Texnik yechim va joylashtirish

| Qism | Yechim |
|---|---|
| Server | Node.js 22.13 (Render), Express 4 |
| Baza | PostgreSQL — Supabase (`pg`); mahalliy ishlash va testlarda PGlite (WASM Postgres) |
| Mijoz | Oddiy JavaScript modullari; framework va bundler yo‘q |
| Grafiklar | Qo‘lda chizilgan SVG (siferblat, grafiklar, rasmlar) |
| Autentifikatsiya | JWT + bazadagi sessiyalar, 30 kun |
| Push | Web Push (VAPID + RFC 8291), kutubxonasiz |
| Kutubxonalar | `express`, `pg`, `bcryptjs`, `jsonwebtoken`, `cookie-parser` |
| Testlar | 106 ta (`npm test`) |
| iOS | Capacitor 8.5.2 |

**Joylashtirish:** Render (bepul, Frankfurt) `render.yaml` Blueprint orqali; shoxga har push avtomatik joylashtiradi. Server uxlab qolmasligi uchun UptimeRobot `/api/health` ni ping qiladi. Batafsil — `DEPLOY.md`.

```bash
npm install
npm start          # http://localhost:3000 (DATABASE_URL bo‘lmasa — PGlite)
npm run seed       # demo: demo@routine.app / demopass123
npm test
npm run backup
node scripts/make-icons.mjs   # ikonkalarni qayta chizish
```

---

## 8. Ma‘lumotlar modeli

Hamma jadval foydalanuvchiga bog‘langan: hisob o‘chirilsa, unga tegishli hamma narsa o‘chadi.

| Jadval | Nima saqlanadi |
|---|---|
| `users` | Email, parol xeshi, ism, mavzu (`light` / `dark` / `ink`), til, vaqt mintaqasi, hafta boshi, kunlik maqsad foizi, eslatmalar, `routine_defaults` (JSON) |
| `goals` | Maqsad: nomi, tavsifi, belgisi, rangi, muddati, holati |
| `routines` | Rejim: nomi, vaqti, davomiyligi, takrorlanish qoidasi, sanalar, `excluded_dates`, o‘lchov, maqsad havolasi, eslatma |
| `logs` | Rejimning bir kundagi natijasi: `done` (✓), `skipped` (✗), `partial`; rejim+kun uchun bitta |
| `journal` | Kundalik yozuvi, kayfiyat, energiya; kuniga bitta |
| `notes` | Qayd: matn, qadalgan, bajarilgan |
| `achievements` | Ochilgan nishonlar |
| `sessions` | Har bir kirish |
| `push_subscriptions` | Qurilmalarning push obunalari |
| `reminders_sent` | Yuborilgan eslatmalar (ikki marta yubormaslik uchun) |
| `schema_migrations` | Bajarilgan migratsiyalar |

Rejimning kelgusi kunlari saqlanmaydi — takrorlanish qoidasidan har safar hisoblanadi (`isDueOn`). Chiqarilgan kunlar ham shu yerda hisobga olinadi, shuning uchun “Bugun”, kalendar, statistika va eslatmalar bir-biriga mos.

---

## 9. API

Hammasi `/api` ostida; `/health`, ro‘yxatdan o‘tish va kirishdan tashqari hammasi kirishni talab qiladi.

| Bo‘lim | Manzillar |
|---|---|
| Hisob | `POST /auth/register`, `/auth/login`, `/auth/logout`, `/auth/password`; `GET`·`PATCH`·`DELETE /auth/me`; `GET /auth/sessions`, `DELETE /auth/sessions/:id` |
| Rejimlar | `GET`·`POST /routines`; `GET`·`PATCH`·`DELETE /routines/:id`; `POST /routines/:id/duplicate`, `/:id/postpone`, `/:id/remove-day`, `/:id/edit-day`, `/routines/reorder` |
| Maqsadlar | `GET`·`POST /goals`; `PATCH`·`DELETE /goals/:id` |
| Kunlar | `GET /days/:date`, `/days/:date/week`, `/days/month/:y/:m`, `/days/upcoming/list`; `POST /days/log`, `/days/:date/complete-all`, `/days/:date/copy-from` |
| Statistika | `GET /stats/summary`, `/stats/overview`, `/stats/heatmap`, `/stats/routines`, `/stats/achievements` |
| Kundalik | `GET /journal`; `GET`·`PUT /journal/:date` |
| Qaydlar | `GET`·`POST /notes`; `PATCH`·`DELETE /notes/:id` |
| Push | `GET /push/key`; `POST`·`DELETE /push/subscribe`; `POST /push/test`; `GET /notifications/test-push` |
| Boshqa | `GET /templates`, `POST /templates/:id/apply`; `GET /search`, `/export`, `/export.csv` |

---

## 10. Qabul qilish mezonlari

Har bir o‘zgarish quyidagilarsiz tayyor hisoblanmaydi:

1. `npm test` — hammasi o‘tadi; yangi manzil yoki mantiq uchun test qo‘shilgan.
2. Mavjud ma‘lumotlar joyida qoladi; migratsiya jonli bazada tekshiriladi (MS-02).
3. 375 px ekranda yon siljish va kesilgan matn yo‘q (NT-06).
4. Har yangi matn o‘zbek, rus va ingliz tillarida.
5. Uch mavzuning hammasida tekshirilgan.
6. Brauzer konsolida xato yo‘q.
7. Commit va push — o‘zgarish Render’da avtomatik joylashadi.

---

## 11. Keyingi bosqichlar va cheklovlar

| Bosqich | Tarkibi |
|---|---|
| 1. Ma‘lumotlar | MS-06 JSON’dan tiklash (interfeysdan) |
| 2. iOS | Mac’da yig‘ish va sinash, FT-65 APNs push |
| 3. Hisob | FT-05 parolni email orqali tiklash (email xizmati kerak) |
| 4. Sifat | Avtomatik testlar (CI); brauzer testlarini yangi dizaynga moslash |

**Ma‘lum cheklovlar:**

- Render bepul tarifi: 15 daqiqa so‘rov bo‘lmasa server uxlaydi (UptimeRobot buni oldini oladi); Supabase bepul tarifida o‘z avtomatik zaxirasi yo‘q — kunlik zaxira (MS-03) yagona himoya.
- iPhone’da sayt yopiq paytdagi eslatmalar faqat ilova Safari → Bosh ekranga qo‘shilgan bo‘lsa ishlaydi (iOS 16.4+). Bosh ekrandagi ikonka qo‘shilgan paytda saqlanadi — yangilash uchun ilovani o‘chirib qayta qo‘shish kerak.
- Soat jadvalida masshtab to‘liq proporsional emas: qisqa bloklar kattalashtiriladi, juda uzunlari qisqartiriladi; aniq vaqt chap ustunda va blok ichida yoziladi.
- So‘rovlar chegarasi server xotirasida — bir nechta serverga kengaytirish uchun umumiy saqlash kerak bo‘ladi.
- Email yuborish yo‘q, shuning uchun parol tiklash va emailni tasdiqlash yo‘q.
- Oflayn rejimda ilova ochiladi, lekin ma‘lumotni internetsiz o‘zgartirib bo‘lmaydi.
- Brauzer testlari (`npm run test:ui`) eski interfeys uchun yozilgan va hozir ishga tushirilmaydi.

---

*Routine Tracker · Texnik topshiriq v2.0 · 20.11.2026. Hujjat shu kundagi kodga qarab tekshirilgan.*
