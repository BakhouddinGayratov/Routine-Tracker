# Serverni Render va Supabase'ga joylashtirish

Bu qo‘llanma Routine Tracker’ni kompyuteringizdan olib, doim ishlaydigan bepul
xizmatlarga ko‘chirish yo‘lini bosqichma-bosqich tushuntiradi.

Natija: `https://<nom>.onrender.com` ko‘rinishidagi doimiy manzil. Kompyuter
o‘chiq bo‘lsa ham ishlaydi, telefonga ilova qilib o‘rnatiladi, eslatmalar
keladi, ma‘lumotlar Supabase’da saqlanadi.

| Nima | Qayerda | Narxi |
|---|---|---|
| Ilova (Node server) | Render Free | 0 $ |
| Ma‘lumotlar bazasi (Postgres) | Supabase Free | 0 $ |
| Zaxira nusxalar | Supabase Storage | 0 $ |
| Serverni uxlatmaydigan ping | GitHub Actions yoki cron-job.org | 0 $ |

> **Oldindan bilib qo‘ying.** Render’ning bepul serveri 15 daqiqa so‘rov
> bo‘lmasa uxlaydi va uyg‘onishi ~30–60 soniya oladi. Shuning uchun 4-bo‘limda
> uni har 10 daqiqada uyg‘otib turadigan ping sozlanadi. Supabase’ning bepul
> loyihasi esa bir hafta umuman ishlatilmasa to‘xtatiladi — kunlik
> foydalanishda bu muammo emas.

---

## 1. Supabase: ma‘lumotlar bazasi

1. [supabase.com](https://supabase.com) da ro‘yxatdan o‘ting (GitHub bilan kirish eng tezi).
2. **New project** → nom: `routine-tracker`, mintaqa: `Central EU (Frankfurt)`,
   baza uchun kuchli parol o‘ylab toping va uni saqlab qo‘ying.
3. Loyiha tayyor bo‘lgach: **Project settings → Database → Connection string →
   Transaction pooler**. Manzilni nusxalang, u shunga o‘xshaydi:

   ```
   postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
   ```

   `[YOUR-PASSWORD]` o‘rniga o‘zingiz qo‘ygan parolni yozing. Bu qator —
   `DATABASE_URL`. **Uni hech kimga yubormang**, Render sozlamasiga to‘g‘ridan-
   to‘g‘ri qo‘yasiz.

   > Nega aynan “Transaction pooler” (6543-port)? Render’ning bepul serveri
   > uxlab-uyg‘onib turadi va har safar yangi ulanish ochadi; pooler shuncha
   > ulanishni bemalol ko‘taradi.

4. Zaxira nusxalar uchun: **Storage → New bucket** → nomi `backups`, **Private**
   bo‘lib qolsin.
5. **Project settings → API** dan ikkitasini oling:
   - **Project URL** → `SUPABASE_URL`
   - **service_role** kaliti → `SUPABASE_SERVICE_KEY` (bu kalit bazaga to‘liq
     huquq beradi — faqat serverga qo‘yiladi, hech qachon brauzerga emas)

Jadvallarni qo‘lda yaratish shart emas: server birinchi ishga tushganda
`server/db/schema.sql` ni o‘zi qo‘llaydi.

---

## 2. Push kalitlari

Eslatmalar (sayt yopiq bo‘lganda keladigan bildirishnomalar) VAPID kalit
juftligiga bog‘langan. Kompyuteringizda u allaqachon bor. Ko‘rish uchun:

```bash
npm run vapid
```

Chiqqan uchta qatorni saqlab qo‘ying — ular 3-bo‘limda kerak bo‘ladi.

> Bu kalitlar **o‘zgarmasligi** kerak. O‘zgarsa, eslatmalarga obuna bo‘lgan
> har bir brauzer yaroqsiz bo‘lib qoladi va ruxsatni qaytadan berish kerak.
> Shuning uchun ular Render’da muhit o‘zgaruvchisi sifatida saqlanadi: Render
> diski har joylashtirishda tozalanadi.

---

## 3. Render: ilovani joylashtirish

1. [render.com](https://render.com) ga GitHub hisobingiz bilan kiring.
2. **New → Web Service** → GitHub omboringizni ulang (`Routine-Tracker`) →
   shox (branch): `claude/manga-site-full-build-vjfk2v`.
3. Sozlamalar (repoda `render.yaml` bor, Render ko‘pini o‘zi to‘ldiradi):
   - **Runtime**: Node
   - **Build command**: `npm ci --omit=dev`
   - **Start command**: `npm start`
   - **Instance type**: Free
4. **Environment** bo‘limiga quyidagilarni qo‘shing:

   | Kalit | Qiymat |
   |---|---|
   | `DATABASE_URL` | 1-bo‘limdagi Supabase manzili |
   | `VAPID_PUBLIC_KEY` | 2-bo‘limdan |
   | `VAPID_PRIVATE_KEY` | 2-bo‘limdan |
   | `VAPID_SUBJECT` | `mailto:sizning@emailingiz` |
   | `SUPABASE_URL` | 1-bo‘limdan |
   | `SUPABASE_SERVICE_KEY` | 1-bo‘limdagi service_role kaliti |
   | `BACKUP_BUCKET` | `backups` |
   | `NODE_ENV` | `production` |
   | `NODE_VERSION` | `22.13.0` |

   `JWT_SECRET` ni Render o‘zi yaratadi (`render.yaml` da shunday yozilgan).
   Uni keyin o‘zgartirmang — o‘zgarsa hamma qurilmadan chiqib ketasiz.

5. **Create Web Service**. Birinchi joylashtirish 2–4 daqiqa oladi.
6. Jurnalda (Logs) shu qatorlarni ko‘rasiz:

   ```
   Routine Tracker running at http://localhost:10000
   production · database: postgres
   backup: routine-tracker-2026-09-20.json.gz (uploaded)
   ```

7. Tekshirish: `https://<nomingiz>.onrender.com/api/health` → `{"ok":true,...}`

---

## 4. Serverni uxlatmaslik

Ikkita yo‘ldan birini tanlang.

**GitHub Actions (repodagi tayyor ish)**
Repo → **Settings → Secrets and variables → Actions → Variables → New variable**:
nomi `APP_URL`, qiymati `https://<nomingiz>.onrender.com`. Tamom — repodagi
`.github/workflows/keep-awake.yml` har 10 daqiqada ping yuboradi.

**cron-job.org**
Ro‘yxatdan o‘ting → **Create cronjob** → URL: `https://<nomingiz>.onrender.com/api/health`,
davri: har 10 daqiqa.

> Nega 10 daqiqa? Render 15 daqiqada uxlatadi, eslatma rejalashtiruvchisi esa
> kechikkan eslatmani 10 daqiqagacha yuboraveradi. Shu ikkisi mos tushadi.
> 24/7 ishlash oyiga ~730 soat, bu Render’ning bepul 750 soatiga sig‘adi.

---

## 5. Ma‘lumotlarni ko‘chirish

Kompyuteringizdagi hozirgi ma‘lumotlar (hisoblar, rejimlar, maqsadlar,
kundalik) SQLite faylida. Ularni Supabase’ga ko‘chirish:

```bash
# 1. Supabase manzilini shu seans uchun beramiz (PowerShell)
$env:DATABASE_URL = "postgresql://postgres.xxx:PAROL@aws-0-eu-central-1.pooler.supabase.com:6543/postgres"

# 2. Avval quruq yurgizish — nima ko‘chishini ko‘rsatadi, hech narsa yozmaydi
npm run import:sqlite

# 3. Rozi bo‘lsangiz, haqiqatan ko‘chirish
node scripts/import-sqlite.mjs --write
```

ID’lar saqlanadi, ya‘ni rejim qaysi maqsadga bog‘langani va qaysi kun
belgilangani — hammasi joyida qoladi. Skript bazada allaqachon foydalanuvchi
bo‘lsa, `--replace` siz yozishdan bosh tortadi.

Ko‘chirilgach, saytga kirib tekshiring: rejimlar, maqsadlar va statistika
avvalgidek bo‘lishi kerak.

---

## 6. Telefonga o‘rnatish

1. iPhone’da **Safari** da `https://<nomingiz>.onrender.com` ni oching.
2. Kiring (email va parolingiz bilan).
3. Pastdagi **Ulashish** belgisi → **Bosh ekranga qo‘shish** (Add to Home Screen).
4. Bosh ekrandagi belgidan oching → **Sozlamalar → Eslatmalar** ni yoqing va
   ruxsat bering. **Sinab ko‘rish** tugmasi bildirishnoma yuboradi.

Shundan keyin ilova to‘liq ekranda ochiladi, internet yo‘q bo‘lsa ham ochiladi
va eslatmalar sayt yopiq bo‘lganda ham keladi (iOS 16.4+).

---

## 7. Zaxira nusxalar

Server har kuni barcha jadvallarning nusxasini oladi, uni `backups` bucket’iga
yuklaydi va oxirgi 7 tasini saqlaydi. **Supabase’ning bepul tarifida o‘z
avtomatik zaxirasi yo‘q** — shuning uchun bu nusxalar yagona himoyangiz.

Qo‘lda nusxa olish:

```bash
npm run backup
```

Tiklash (avval quruq yurgizish, keyin haqiqatan):

```bash
npm run restore data/backups/routine-tracker-2026-09-20.json.gz
node scripts/restore-backup.mjs data/backups/routine-tracker-2026-09-20.json.gz --write
```

> Tiklash **almashtiradi**: jadvallardagi hozirgi ma‘lumotlar o‘chib, nusxadagi
> holat qaytadi. Oyiga bir marta bittasini kompyuteringizga yuklab qo‘yish
> yaxshi odat — Supabase’ning o‘zida nimadir bo‘lsa, nusxa boshqa joyda turadi.

---

## 8. Muammolarni hal qilish

| Belgi | Sabab va yechim |
|---|---|
| Render jurnalida `password authentication failed` | `DATABASE_URL` dagi parol noto‘g‘ri yoki `[YOUR-PASSWORD]` o‘rnini almashtirmagansiz |
| `no pg_hba.conf entry` yoki SSL xatosi | Manzil oxiriga `?sslmode=require` qo‘shing |
| Sayt birinchi ochilishda 40 soniya kutadi | Server uxlagan. 4-bo‘limdagi pingni sozlang |
| Eslatmalar kelmay qoldi | Tizimga kirgan holda `https://<nomingiz>.onrender.com/api/notifications/test-push` ni oching: nechta qurilma obuna bo‘lgani (iPhone — `apple`), Apple/Google javobi (`403 BadJwtToken` va h.k.) va nima qilish kerakligi (`advice`) ko‘rinadi. Render jurnalida `push failed:` qatorlarini ham qidiring. `VAPID_*` kalitlari o‘zgargan bo‘lsa, telefonda Sozlamalar → Eslatmalarni o‘chirib, qayta yoqing |
| iPhone’da eslatma yo‘q | Ilova Safari → Bosh ekranga qo‘shish orqali o‘rnatilgan va **belgidan** ochilgan bo‘lishi shart (iOS 16.4+). So‘ng Sozlamalar → **“Shu qurilmada yoqish”** tugmasi |
| Jurnalda `backup FAILED` | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `BACKUP_BUCKET` to‘g‘rimi va bucket yaratilganmi |
| Jadvallar yaratilmadi | Render jurnaliga qarang: `database: postgres` qatori bormi. Bo‘lmasa `DATABASE_URL` o‘rnatilmagan |

---

## 9. Kompyuterda ishlash (o‘zgarishsiz)

Joylashtirishdan keyin ham kompyuterda avvalgidek ishlayverasiz. `DATABASE_URL`
berilmasa, ilova PGlite’da (ichki Postgres) ishlaydi:

```bash
npm start    # http://localhost:3000
npm test     # 80 ta test
```

Testlar ham PGlite’da ishlaydi — hech qanday server yoki Docker o‘rnatish shart
emas, lekin SQL aynan Supabase’dagi kabi Postgres SQL’i.
