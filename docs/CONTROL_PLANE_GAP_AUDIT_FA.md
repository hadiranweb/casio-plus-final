# ممیزی شکاف نهایی Control Plane کاسیو پلاس

**نویسنده:** Manus AI  
**تاریخ:** ۳۰ اوت ۲۰۲۶  
**Snapshot ممیزی‌شده:** `c72c0eaf037c96f16a73c78e49430ad8569e8637`

## حکم

هستهٔ canonical، lifecycleهای داده، runtimeها، گراف حافظه و گیت‌های کیفیت در snapshot ممیزی‌شده قابل اجرا و دارای شواهد CI هستند؛ بااین‌حال، **سوپرپلتفرم هنوز در سطح control plane کاربر نهایی کامل نیست**. چند قابلیت backend معتبر هنوز UI یا lifecycle مدیریتی end-to-end ندارند. بنابراین snapshot بالا یک foundation production-candidate است، نه پایان کدنویسی محصول.

## روش ممیزی

شش حوزهٔ مستقل شامل Identity و membership، Console، Forge، action/economics governance، operational readiness و UX بررسی شدند. حکم هر حوزه بر اساس route، contract، migration، integration test و کنترل UI صادر شد. قابلیت backend-only کامل محسوب نشد.

| حوزه                               | وضعیت                        | شکاف پذیرفته‌شده                                                                                                                      | محل تکمیل          |
| ---------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Organization و Workspace           | **Partial**                  | فهرست و ایجاد Workspace وجود دارد، اما switching، member lifecycle و کنترل نقش در UI کامل نیست.                                       | مرحلهٔ ۱۵          |
| Invitation                         | **Partial**                  | ایجاد و پذیرش token در Core وجود دارد، اما فهرست، revoke، delivery abstraction و UX کامل Console وجود ندارد.                          | مرحلهٔ ۱۵          |
| External mapping                   | **Partial**                  | schema و server-side resolution موجود است، اما management API و Console برای ExternalApp و ExternalTenant کامل نیست.                  | مرحلهٔ ۱۵          |
| Forge Run UX                       | **Partial**                  | ProcessRun و adapter lifecycle در Core کامل است، اما create/execute/status/result در Forge end-to-end نیست.                           | مرحلهٔ ۱۶          |
| Approval و action governance       | **Partial**                  | target، policy، approval و decision در Core وجود دارد، اما Approval Inbox و controls مدیریتی UI کامل نیست.                            | مرحلهٔ ۱۶          |
| Runtime metering و economics       | **Partial**                  | immutable ledger و P&L/TCO API موجود است، اما planning assumption و binding management در Console کامل نیست.                          | مرحلهٔ ۱۶          |
| Accessibility و performance        | **Complete برای scope فعلی** | ممیزی مستقل پیشنهاد E2E داد، اما repository اکنون گیت شش‌حالتهٔ axe، responsive state، graph lazy state و performance budget دارد.    | بدون P0 جدید       |
| Backup، restore و secret operation | **Provider-bound**           | contract و runbook باید اکنون آماده شود؛ automation و restore drill به انتخاب PostgreSQL، object storage و secret manager وابسته است. | مرحلهٔ ۱۷ و سپس ۱۸ |

## معیار پذیرش مرحلهٔ ۱۵

مرحلهٔ ۱۵ فقط زمانی بسته می‌شود که یک owner بتواند در Console سازمان‌ها و Workspaceهای قابل دسترسی را ببیند، context فعال را به‌صورت server-authoritative تغییر دهد، اعضا و نقش‌ها را مدیریت کند، invitation را ایجاد و revoke کند، کاربر مقصد invitation را بپذیرد، و ExternalApp/ExternalTenant mapping را بدون پذیرش شناسهٔ خارجی به‌عنوان authority مدیریت کند. تمام writeها باید از Core/API عبور کنند و integration testهای PostgreSQL باید isolation و role enforcement را اثبات کنند.

## معیار پذیرش مرحلهٔ ۱۶

مرحلهٔ ۱۶ فقط زمانی بسته می‌شود که کاربر مجاز در Forge بتواند نسخهٔ منتشرشدهٔ Flow را اجرا کند و status/result canonical را ببیند؛ owner در Console بتواند action target، action policy، approval decision، planning assumption و runtime meter binding را مدیریت کند؛ و economics شامل P&L کاسیو پلاس و TCO کل ecosystem از ledger immutable نمایش داده شود. OpenClaw باید همچنان default-deny و approval-gated باقی بماند.

## تصمیم workflow انتشار

workflow وابسته به provider حذف و با workflow دستی **Prepare Casioplus Release Candidate** جایگزین شد. این workflow فقط روی PostgreSQL موقت validation، migration، build، Golden Flow، accessibility، n8n import، Compose contract و image build را اجرا می‌کند و artifact شواهد می‌سازد؛ هیچ deploymentی انجام نمی‌دهد. workflow واقعی staging/production فقط پس از انتخاب زیرساخت و secret manager افزوده خواهد شد.

> **خط توقف:** پیش از نصب نرم‌افزار، تغییر firewall، ایجاد database، تنظیم DNS، تزریق secret یا اجرای container روی محیط واقعی، تصمیم کاربر دربارهٔ زیرساخت دریافت می‌شود.
