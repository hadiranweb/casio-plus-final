# ممیزی شکاف نهایی Control Plane کاسیو پلاس

**نویسنده:** Manus AI  
**تاریخ:** ۳۰ اوت ۲۰۲۶  
**Snapshot ممیزی‌شده:** `c72c0eaf037c96f16a73c78e49430ad8569e8637`

## حکم

ممیزی snapshot اولیه چند شکاف control plane را آشکار کرد. این شکاف‌ها اکنون در مراحل ۱۵ و ۱۶ بسته شده‌اند: Organization، Workspace، member، invitation، Integration Gateway، Forge Run، Approval Inbox، action governance، runtime metering و economics همگی lifecycle کاربر نهایی دارند. repository فعلی **کد production-candidate کامل** است؛ تنها automationهای وابسته به provider و اثبات روی محیط واقعی به تصمیم و اجرای deployment نیاز دارند.

## روش ممیزی

شش حوزهٔ مستقل شامل Identity و membership، Console، Forge، action/economics governance، operational readiness و UX بررسی شدند. حکم هر حوزه بر اساس route، contract، migration، integration test و کنترل UI صادر شد و در این نسخه با نتایج اجرای مراحل ۱۵ و ۱۶ به‌روزرسانی شده است. قابلیت backend-only کامل محسوب نشد؛ همهٔ ردیف‌های Complete مسیر UI و validation end-to-end دارند.

| حوزه                               | وضعیت                        | شکاف پذیرفته‌شده                                                                                                                      | محل تکمیل          |
| ---------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Organization و Workspace           | **Complete**                 | context switch، multi-Organization، ساخت Workspace، member role/revoke و last-owner invariant در Core و Console تکمیل شد.             | مرحلهٔ ۱۵ بسته شد  |
| Invitation                         | **Complete برای MVP**        | ایجاد، فهرست، one-time link، پذیرش، revoke، expiry و duplicate guard تکمیل شد؛ ارسال خودکار ایمیل provider-bound است.                 | مرحلهٔ ۱۵ بسته شد  |
| External mapping                   | **Complete**                 | ExternalApp ownership، key rotation metadata، secret reference، server-side mapping و callback allowlist در Core و Console تکمیل شد.  | مرحلهٔ ۱۵ بسته شد  |
| Forge Run UX                       | **Complete**                 | create Work، ایجاد و اجرای ProcessRun، درخواست approval، ادامهٔ صریح، polling محدود و status/result canonical در Forge تکمیل شد.      | مرحلهٔ ۱۶ بسته شد  |
| Approval و action governance       | **Complete**                 | target و policy lifecycle، Approval Inbox، دلیل اجباری، approve/reject و default-deny OpenClaw در Core و Console تکمیل شد.            | مرحلهٔ ۱۶ بسته شد  |
| Runtime metering و economics       | **Complete**                 | planning assumption، binding نسخه‌دار و نمایش جداگانهٔ P&L کاسیو پلاس و TCO کل ecosystem از ledger immutable تکمیل شد.                | مرحلهٔ ۱۶ بسته شد  |
| Accessibility و performance        | **Complete برای scope فعلی** | ممیزی مستقل پیشنهاد E2E داد، اما repository اکنون گیت شش‌حالتهٔ axe، responsive state، graph lazy state و performance budget دارد.    | بدون P0 جدید       |
| Backup، restore و secret operation | **Provider-bound**           | contract و runbook باید اکنون آماده شود؛ automation و restore drill به انتخاب PostgreSQL، object storage و secret manager وابسته است. | مرحلهٔ ۱۷ و سپس ۱۸ |

## معیار پذیرش مرحلهٔ ۱۵

مرحلهٔ ۱۵ بسته شد. owner می‌تواند در Console سازمان‌ها و Workspaceهای قابل دسترسی را ببیند، context فعال را به‌صورت server-authoritative تغییر دهد، اعضا و نقش‌ها را مدیریت کند، invitation را ایجاد و revoke کند، کاربر مقصد invitation را بپذیرد، و ExternalApp/ExternalTenant mapping را بدون پذیرش شناسهٔ خارجی به‌عنوان authority مدیریت کند. همهٔ writeها از Core/API عبور می‌کنند و integration testهای PostgreSQL isolation، role enforcement، session rotation، key lifecycle و mapping isolation را اثبات می‌کنند.

## معیار پذیرش مرحلهٔ ۱۶

مرحلهٔ ۱۶ بسته شد. کاربر مجاز در Forge می‌تواند version منتشرشده را با definition متناسب با runtime اجرا کند و status/result canonical را ببیند. owner در Console می‌تواند target، policy، approval، planning assumption و runtime meter binding را مدیریت کند. economics شامل P&L کاسیو پلاس و TCO کل ecosystem از ledger immutable جدا نمایش داده می‌شود. OpenClaw در browser واقعی تا approval انسانی default-deny ماند، سپس فقط با اقدام صریح Forge به outbox منتقل شد؛ هیچ side effect قبل از approval رخ نداد.

## شواهد مرحلهٔ ۱۶

Full gate روی PostgreSQL تازه موفق شد: همهٔ ۱۷ فایل تست، format، typecheck، topology، repository security، dependency policy، build، performance budget، Golden Flow API-only، accessibility شش‌حالته، n8n validation و Remix SSR smoke عبور کردند. browser validation با cookie و CSRF واقعی، target، policy، planning assumption، runtime meter binding، FlowVersionهای Open WebUI و OpenClaw، publication، ProcessRun، Approval Inbox، تصمیم انسانی و continuation صریح را اثبات کرد. جزئیات در [`PHASE16_VISUAL_FINDINGS_FA.md`](PHASE16_VISUAL_FINDINGS_FA.md) و [`PHASE16_DESIGN_AUDIT_FA.md`](PHASE16_DESIGN_AUDIT_FA.md) ثبت شده‌اند.

## تصمیم workflow انتشار

workflow وابسته به provider حذف و با workflow دستی **Prepare Casioplus Release Candidate** جایگزین شد. این workflow فقط روی PostgreSQL موقت validation، migration، build، Golden Flow، accessibility، n8n import، Compose contract و image build را اجرا می‌کند و artifact شواهد می‌سازد؛ هیچ deploymentی انجام نمی‌دهد. workflow واقعی staging/production فقط پس از انتخاب زیرساخت و secret manager افزوده خواهد شد.

> **خط توقف:** پیش از نصب نرم‌افزار، تغییر firewall، ایجاد database، تنظیم DNS، تزریق secret یا اجرای container روی محیط واقعی، تصمیم کاربر دربارهٔ زیرساخت دریافت می‌شود.

## شواهد مرحلهٔ ۱۵

Full gate روی PostgreSQL تازه اجرا شد: format، typecheck، تمام unit و integration testها، topology، repository security، dependency policy، build، performance budget، Golden Flow، accessibility شش‌حالته، n8n workflow validation و Remix SSR smoke همگی موفق بودند. Browser validation با cookie session و CSRF واقعی، ساخت Organization/Workspace، context switch، invitation create/revoke، ExternalApp، key metadata و ExternalTenant mapping را اجرا کرد. یافته‌های تصویری در [`PHASE15_VISUAL_FINDINGS_FA.md`](PHASE15_VISUAL_FINDINGS_FA.md) و قرارداد اجرایی در [`IDENTITY_INTEGRATION_CONTROL_PLANE_FA.md`](IDENTITY_INTEGRATION_CONTROL_PLANE_FA.md) ثبت شده‌اند.
