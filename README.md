# HR-Gpack — نظام الموارد البشرية (Backend API)

نظام إدارة موارد بشرية متكامل يعمل بـ Express.js + PostgreSQL، مع واجهة أمامية ثابتة (HTML/CSS/JS).

---

## 📦 المتطلبات

- **Node.js** v18 أو أحدث
- **PostgreSQL** v12 أو أحدث
- **npm** أو **yarn**

---

## 🚀 التثبيت المحلي (Local Development)

### 1. تثبيت الحزم

```bash
cd server
npm install
```

### 2. إعداد متغيرات البيئة

انسخ ملف `.env.example` إلى `.env` وعدّل القيم:

```bash
cp .env.example .env
```

محتويات ملف `.env`:

```env
PORT=3000
NODE_ENV=development

# قاعدة البيانات
DB_HOST=localhost
DB_PORT=5432
DB_NAME=hr_gpack
DB_USER=postgres
DB_PASSWORD=your_password_here

# JWT (مهم: غيّر JWT_SECRET لسلسلة عشوائية قوية في الإنتاج)
JWT_SECRET=change_this_to_a_random_64_char_string
JWT_EXPIRES_IN=7d

# CORS (عنوان الواجهة الأمامية)
CORS_ORIGIN=http://localhost:5500

# حساب المدير العام (يُنشأ تلقائيًا عند تشغيل init-db)
SEED_ADMIN_EMAIL=admin@example.com
SEED_ADMIN_PASSWORD=admin123
SEED_ADMIN_FULL_NAME=Super Admin
```

> **مهم:** الخادم بيقرأ متغيرات البيئة من `process.env` — سواء من ملف `.env` (محليًا) أو من إعدادات الـ Container (في Docker/Dokploy). لو المتغير موجود في البيئة مباشرة، `dotenv` مش هيستبدله.

### 3. إنشاء قاعدة البيانات وتهيئتها

```bash
# أنشئ قاعدة البيانات يدويًا في PostgreSQL
createdb hr_gpack

# شغّل سكربت التهيئة — ينشئ كل الجداول + حساب المدير العام
npm run init-db
```

> **ملاحظة:** `init-db` آمن للتشغيل المتكرر — لو الجداول موجودة مش هيعملها من جديد، ولو المدير موجود مش هيضيف نسخة تانية.

### 4. تشغيل الخادم

```bash
# وضع التطوير (مع إعادة تشغيل تلقائي عند التعديل)
npm run dev

# وضع الإنتاج
npm start
```

الخادم سيعمل على: `http://localhost:3000`

### 5. الدخول للموقع

بعد تشغيل الخادم، افتح الواجهة الأمامية وسجّل دخول بالبيانات اللي في `.env`:

```
البريد: admin@example.com
كلمة المرور: admin123
```

(أو اللي حددتها في `SEED_ADMIN_EMAIL` و `SEED_ADMIN_PASSWORD`)

### 6. تشغيل الواجهة الأمامية

الواجهة الأمامية ملفات HTML ثابتة. شغّلها بأي خادم ثابت:

```bash
# باستخدام npx
npx serve .

# أو باستخدام Live Server في VS Code
# أو باستخدام Python
python -m http.server 5500
```

تأكد من ضبط `window.API_BASE_URL` في `index.html` ليشير إلى عنوان الخادم:

```html
<script>window.API_BASE_URL = 'http://localhost:3000/api';</script>
```

---

## 🐳 التثبيت على VPS باستخدام Docker / Dokploy

### البنية الموصى بها (Database منفصلة)

```
┌─────────────────────────────────────────┐
│              VPS (Dokploy)              │
│                                         │
│  ┌──────────────┐   ┌───────────────┐   │
│  │  Service 1   │   │   Service 2   │   │
│  │  PostgreSQL  │◄──│  HR-Gpack API │   │
│  │  (Database)  │   │  (Express.js) │   │
│  │  Port: 5432  │   │  Port: 3000   │   │
│  └──────────────┘   └───────────────┘   │
│         ▲                    ▲          │
│         │                    │          │
│         │            ┌───────────────┐   │
│         └────────────│  Nginx / CDN  │   │
│                      │  (Frontend)   │   │
│                      │  HTML/CSS/JS  │   │
│                      └───────────────┘   │
└─────────────────────────────────────────┘
```

**افصل الداتابيز عن الـ API** — ده الأفضل لأن:
- النسخ الاحتياطي للـ DB لوحدها بدون إيقاف الـ API
- إعادة deploy للـ API بدون ما الـ DB تنطفئ
- عزل أمني كامل
- تقدر تحدد موارد (RAM/CPU) لكل service لوحده

### كيف يقرأ الخادم متغيرات البيئة؟

الخادم بيستخدم `dotenv` لقراءة ملف `.env` محليًا. لكن في Docker/Dokploy، متغيرات البيئة بتُمر مباشرة للـ Container عبر `environment` في `docker-compose.yml` أو من لوحة Dokploy — ومش محتاج ملف `.env` إطلاقًا.

`dotenv.config()` مش بيستبدل المتغيرات الموجودة فعلًا في البيئة، فلو Dokploy ضبط المتغير، الخادم هيقراه مباشرة.

---

### الطريقة الأولى: Docker Compose (للاختبار المحلي)

```bash
cd server
cp .env.example .env
# عدّل .env بكلمة مرور قوية و JWT_SECRET قوي

docker-compose up -d
```

هذا سيشغل:
- **PostgreSQL** على المنفذ 5432
- **Express API** على المنفذ 3000

> **مهم:** الـ Dockerfile بيشتغل تلقائيًا: `init-db` (ينشئ الجداول + المدير) ثم `app.js` (الخادم). مفيش حاجة تدوية.

> **ملاحظة:** `docker-compose.yml` للـ local development فقط. في الإنتاج، استخدم Dokploy مع database منفصلة (الطريقة الثانية).

---

### الطريقة الثانية: Dokploy (للإنتاج — موصى بها)

#### الخطوة 1: أنشئ Database Service

1. في لوحة Dokploy → **Add Service** → اختر **PostgreSQL**
2. Dokploy هيوفر PostgreSQL جاهز كـ managed service
3. احفظ البيانات اللي هتظهر لك:
   - **Hostname** (مثل `postgres-cont` أو IP)
   - **Port** = `5432`
   - **Database name** = `hr_gpack`
   - **User** = `postgres`
   - **Password** = كلمة المرور اللي ضبطتها

#### الخطوة 2: أنشئ App Service للمشروع

1. ارفع الكود إلى GitHub
2. في لوحة Dokploy → **Add Application**
3. اربط الـ repo واختر مجلد `server/` — سيقرأ `Dockerfile` تلقائيًا
4. من تبويب **Environment**، أضف المتغيرات:

   | المتغير | القيمة |
   |---------|-------|
   | `DB_HOST` | عنوان الـ database service (من الخطوة 1) |
   | `DB_PORT` | `5432` |
   | `DB_NAME` | `hr_gpack` |
   | `DB_USER` | `postgres` |
   | `DB_PASSWORD` | كلمة مرور PostgreSQL (من الخطوة 1) |
   | `JWT_SECRET` | سلسلة عشوائية 64 حرف (مهم جدًا) |
   | `JWT_EXPIRES_IN` | `7d` |
   | `CORS_ORIGIN` | عنوان الواجهة الأمامية (مثل `https://your-domain.com`) |
   | `SEED_ADMIN_EMAIL` | بريد المدير العام |
   | `SEED_ADMIN_PASSWORD` | كلمة مرور المدير العام |
   | `SEED_ADMIN_FULL_NAME` | اسم المدير العام |
   | `NODE_ENV` | `production` |

5. اضغط **Deploy** — الـ Container هيشغل `init-db` تلقائيًا (ينشئ الجداول + المدير) ثم `app.js` (الخادم)

#### الخطوة 3: أنشئ Frontend Service

للواجهة الأمامية (ملفات HTML/CSS/JS)، عندك خيارين:

**الخيار أ — Nginx container على نفس السيرفر:**
```dockerfile
# Dockerfile للواجهة الأمامية
FROM nginx:alpine
COPY . /usr/share/nginx/html
EXPOSE 80
```

**الخيار ب — ارفعها على Netlify أو Vercel (مجاني):**

#### الخطوة 4: اربط الواجهة بالـ API

```html
<!-- في index.html، غيّر قيمة API_BASE_URL -->
<script>window.API_BASE_URL = 'https://api.your-domain.com/api';</script>
```

أو استخدم Reverse Proxy (Nginx) لخدمة الواجهة والـ API على نفس النطاق:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # الواجهة الأمامية
    location / {
        root /var/www/hr-gpack;
        try_files $uri $uri/ /index.html;
    }

    # API
    location /api {
        proxy_pass http://api:3000/api;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

بهذا الإعداد، اترك `API_BASE_URL = '/api'` (نسبية) ولا تحتاج لتغييرها.

---

### 💾 متطلبات السيرفر (Resources)

النظام خفيف جدًا — Stateless بدون عمليات في الخلفية:

| المكون | RAM | CPU |
|--------|-----|-----|
| Express.js API | 50-80 MB | شبه صفر |
| PostgreSQL | 30-100 MB | شبه صفر |
| Nginx (Frontend) | 5-10 MB | صفر |
| **الإجمالي** | **~100-200 MB** | **شبه صفر** |

| نوع VPS | RAM | كافي؟ |
|---------|-----|-------|
| صغير | 1GB / 1 vCPU | ✅ تمام |
| متوسط | 2GB / 1 vCPU | ✅ مريح جدًا |

> VPS بـ 1GB RAM (مثل DigitalOcean Droplet أو Hetzner CX11) يشغّله بدون مشاكل.

---

## 📋 سكربتات npm

| الأمر | الوصف |
|-------|-------|
| `npm start` | تشغيل الخادم في وضع الإنتاج |
| `npm run dev` | تشغيل الخادم في وضع التطوير (مع nodemon) |
| `npm run init-db` | إنشاء جداول قاعدة البيانات + المستخدم المدير |

---

## 🗄️ هيكل قاعدة البيانات

| الجدول | الوصف |
|--------|-------|
| `companies` | المنشآت/الشركات |
| `employees` | بيانات الموظفين |
| `system_users` | مستخدمو النظام (مدير عام، مدير HR، مدير فرع، مشاهدة، موظف) |
| `employee_documents` | وثائق الموظفين (الإقامة، التأشيرة، إلخ) |
| `employee_assets` | العهد والأصول المسلمة للموظفين |
| `employee_requests` | طلبات الإجازات والسلف |
| `issued_letters` | الخطابات الرسمية المصدرة |
| `monthly_attendance` | سجل الحضور الشهري |
| `payroll_records` | سجلات الرواتب |
| `vehicles` | مركبات الشركة |
| `vehicle_documents` | وثائق المركبات |
| `audit_logs` | سجل التدقيق |
| `system_settings` | إعدادات النظام |

---

## 🔐 الأدوار والصلاحيات (RBAC)

| الدور | الوصف |
|-------|-------|
| `super_admin` | صلاحية مطلقة على كل الوحدات |
| `hr_manager` | إدارة كاملة عدا حذف المنشآت والمستخدمين |
| `branch_manager` | مقيّد بفرعه فقط، مع إخفاء الرواتب |
| `viewer` | عرض فقط، مع إخفاء الرواتب |
| `employee` | بوابة الموظف (ESS) — طلبات وخطابات فقط |

---

## 📡 مسارات API

### المصادقة
| الطريقة | المسار | الوصف |
|---------|-------|-------|
| `POST` | `/api/auth/login` | تسجيل دخول موحد (موظف + مدير) |
| `GET` | `/api/auth/profile` | بيانات المستخدم الحالي |
| `POST` | `/api/auth/logout` | تسجيل خروج |
| `GET` | `/api/auth/lookup-phone` | البحث عن بريد بالهاتف |

### الوحدات (CRUD)
| الطريقة | المسار | الوصف |
|---------|-------|-------|
| `GET/POST/PUT/DELETE` | `/api/employees` | إدارة الموظفين |
| `GET/POST/PUT/DELETE` | `/api/companies` | إدارة المنشآت |
| `GET/POST/PUT/DELETE` | `/api/assets` | إدارة العهد |
| `GET/POST/PUT/DELETE` | `/api/compliance` | إدارة الوثائق |
| `GET/POST/PUT` | `/api/requests` | طلبات الإجازات والسلف |
| `GET/POST/PUT/DELETE` | `/api/payroll` | إدارة الرواتب |
| `GET/POST` | `/api/letters` | الخطابات الرسمية |
| `GET/POST/PUT/DELETE` | `/api/vehicles` | إدارة المركبات |
| `GET/POST/PUT/DELETE` | `/api/users` | إدارة المستخدمين |
| `GET/POST/PUT/DELETE` | `/api/attendance` | إدارة الحضور |
| `GET` | `/api/dashboard/kpis` | مؤشرات لوحة التحكم |
| `GET` | `/api/dashboard/compliance-radar` | رادار الامتثال |
| `GET` | `/api/dashboard/audit-logs` | سجل التدقيق |
| `GET/PUT` | `/api/settings` | إعدادات النظام |

---

## 🔄 الواجهة الأمامية (apiClient.js)

الملف `assets/js/apiClient.js` هو بديل مباشر لـ `supabaseClient.js`. يحاكي واجهة Supabase JS Client:

```js
// يعمل بنفس الطريقة
const { data, error } = await window.db.from('employees').select('*').eq('status', 'active');
const { data } = await window.db.from('payslips').insert({ ... });
await window.db.auth.signInWithPassword({ email, password });
```

### أسماء الجداول (Mapping)

الواجهة الأمامية تستخدم أسماء Supabase الأصلية، ويتم تحويلها تلقائيًا:

| اسم في الواجهة | اسم في الـ API |
|----------------|----------------|
| `payslips` | `payroll` |
| `system_users` | `users` |
| `monthly_attendance` | `attendance` |
| `employee_documents` | `compliance` |
| `employee_assets` | `assets` |
| `employee_requests` | `requests` |
| `issued_letters` | `letters` |
| `system_settings` | `settings` |
| `vehicle_documents` | `vehicles/documents` |

---

## 📁 هيكل المشروع

```
HR-Gpack-main/
├── index.html              # الصفحة الرئيسية (SPA)
├── pages/                  # صفحات الوحدات
│   ├── login.html
│   ├── dashboard.html
│   ├── employee-profile.html
│   ├── companies.html
│   ├── assets.html
│   ├── compliance.html
│   ├── leaves-loans.html
│   ├── payroll.html
│   ├── letters.html
│   ├── vehicles.html
│   ├── time-attendance.html
│   └── users.html
├── assets/
│   ├── js/
│   │   ├── apiClient.js    # بديل Supabase Client
│   │   ├── app.js          # منطق التطبيق الرئيسي
│   │   └── supabaseClient.js  # (قديم - غير مستخدم)
│   └── css/
│       └── style.css
└── server/                 # الـ Backend
    ├── package.json
    ├── .env.example
    ├── schema.sql
    ├── Dockerfile
    ├── docker-compose.yml
    ├── README.md           # هذا الملف
    └── src/
        ├── app.js          # Express app
        ├── config/
        │   └── db.js       # PostgreSQL pool
        ├── middleware/
        │   ├── auth.js     # JWT auth
        │   └── rbac.js     # Role-based access control
        ├── routes/
        │   ├── auth.js
        │   ├── employees.js
        │   ├── companies.js
        │   ├── assets.js
        │   ├── compliance.js
        │   ├── requests.js
        │   ├── payroll.js
        │   ├── letters.js
        │   ├── vehicles.js
        │   ├── users.js
        │   ├── attendance.js
        │   ├── dashboard.js
        │   └── settings.js
        ├── utils/
        │   └── helpers.js  # SQL builders, salary masking
        └── scripts/
            └── initDb.js   # DB initialization + seeding
```

---

## ⚠️ ملاحظات أمنية

- **كلمات المرور**: يتم تخزينها بـ `bcrypt` للمديرين، ولكن بوابة الموظف (ESS) تستخدم `plain_password` — يُنصح بنقلها لـ `bcrypt` مستقبلاً.
- **JWT Secret**: تأكد من استخدام سلسلة عشوائية قوية (64 حرف) في الإنتاج.
- **CORS**: حدد `CORS_ORIGIN` بعنوان الواجهة الأمامية الفعلي في الإنتاج.
- **Rate Limiting**: الخادم محدود بـ 500 طلب/15 دقيقة لكل IP، و 20 محاولة تسجيل دخول/15 دقيقة.

---

## 🧪 التحقق من التشغيل

```bash
# فحص الصحة
curl http://localhost:3000/health

# تسجيل دخول تجريبي
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"identifier":"admin@example.com","password":"admin123"}'
```
