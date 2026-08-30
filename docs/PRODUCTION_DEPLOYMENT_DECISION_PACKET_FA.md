# بستهٔ تصمیم استقرار Production کاسیو پلاس

**نویسنده:** Manus AI

**وضعیت:** آمادهٔ تصمیم زیرساخت؛ هیچ deployment واقعی انجام نشده است

**Release candidate:** `248773eac487e990a1c40de4d20f0b9ca8b59552`

**آخرین CI:** [GitHub Actions run 33330615721](https://github.com/hadiranweb/casio-plus-final/actions/runs/33330615721)

## حکم اجرایی

کد Casioplus در repository خصوصی `hadiranweb/casio-plus-final` یک **production deployment candidate کامل** است. Core/API و PostgreSQL canonical، Console و Forge روی Remix، Identity و tenant isolation، Integration Gateway، Memory Broker، artifact storage، usage ledger، n8n، Open WebUI، OpenClaw، approval، runtime governance، economics و گراف حافظه پیاده‌سازی و با CI سبز اعتبارسنجی شده‌اند. جزئیات واحدها در [`deployment/RELEASE_MANIFEST.yaml`](../deployment/RELEASE_MANIFEST.yaml) و گیت غیر‌استقراری در [`.github/workflows/release-candidate.yml`](../.github/workflows/release-candidate.yml) ثبت شده است.

> **خط توقف قطعی:** تا زمان تصمیم کاربر، نصب یا تغییر نرم‌افزار روی سرور، بازکردن firewall، ایجاد PostgreSQL یا bucket واقعی، تنظیم DNS/TLS، تزریق secret، فعال‌سازی runtime بیرونی، اجرای migration در محیط دائمی یا اجرای container روی محیط staging/production انجام نمی‌شود.

CI commit بالا تمام گیت‌های repository از جمله PostgreSQL integration، migration، image build، Golden Flow، accessibility، performance، n8n import و Remix SSR را گذرانده است. این نتیجه **اثبات استقرار production نیست**؛ هنوز باید infrastructure، secret lifecycle، backup/restore، observability و external runtimeها در محیط انتخاب‌شده اثبات شوند.

## تصمیم‌های موردنیاز کاربر

| تصمیم                    | گزینهٔ پیشنهادی MVP                                                                          | اطلاعاتی که باید مشخص شود                                           | علت                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| میزبان application plane | یک container host پایدار برای staging؛ سپس production مستقل یا همان topology با ظرفیت بالاتر | provider، region، hostname یا IP، محدودیت CPU/RAM/disk و روش دسترسی | Core، دو surface، Dispatcher، Worker و سه adapter باید همیشه‌فعال باشند.                            |
| PostgreSQL canonical     | PostgreSQL مدیریت‌شده با TLS، backup پیوسته و PITR                                           | provider، region، version، HA، RPO، RTO و secret reference          | PostgreSQL تنها canonical store است و runtimeها نباید credential آن را دریافت کنند.                 |
| Object Storage           | S3-compatible مدیریت‌شده با bucket خصوصی و versioning                                        | endpoint، region، bucket، retention، lifecycle و secret reference   | artifactها by-reference هستند و byte داخل PostgreSQL نگهداری نمی‌شود.                               |
| Secret manager           | secret store مدیریت‌شده یا vault اختصاصی؛ هر secret مستقل و قابل rotation                    | نام محصول، namespace، دسترسی CI و مسئول rotation                    | OWASP مدیریت متمرکز، least privilege، rotation، revocation و audit چرخهٔ secret را توصیه می‌کند.[1] |
| Container registry       | GHCR یا registry خصوصی provider با image digest immutable                                    | registry، retention و روش احراز CI                                  | promotion باید با digest انجام شود، نه tag شناور یا rebuild روی سرور.                               |
| DNS و TLS                | `console.casioplus.com`، `forge.casioplus.com` و endpoint HTTPS برای Core پشت ingress        | provider DNS، certificate manager، API hostname و سیاست redirect    | مرورگر باید Core را از originهای allowlisted با cookie/CSRF امن فراخوانی کند.                       |
| Invitation delivery      | provider ایمیل تراکنشی                                                                       | provider، domain verification، sender و secret reference            | lifecycle invitation کامل است؛ فقط delivery بیرونی provider-bound باقی مانده است.                   |
| n8n                      | runtime خصوصی با datastore داخلی مستقل                                                       | editor access policy، encryption key، host داخلی و backup           | n8n فقط orchestrator است و به PostgreSQL canonical دسترسی ندارد.                                    |
| Open WebUI               | runtime خصوصی با service account غیرمدیر                                                     | model provider، allowed modelها، API key و data retention           | این plane فقط interaction/model است و tool execution برای آن ممنوع می‌ماند.                         |
| OpenClaw                 | runtime خصوصی با channelهای محدود                                                            | channelها، credentialها، target map و owner approval                | action فقط allowlisted، target-resolved و approval-gated است.                                       |
| Observability            | log متمرکز، metrics، alerting و audit retention                                              | provider، retention، alert receiver و SLO اولیه                     | promotion بدون مشاهده‌پذیری و rollback evidence مجاز نیست.                                          |
| Governance GitHub        | ارتقای protection یا پذیرش کنترل جبرانی موقت                                                 | required reviewers/checks یا risk acceptance                        | برخی protectionهای Environment و branch برای repository خصوصی به plan حساب وابسته‌اند.[4]           |

## topology استقرار

| لایه              | واحدها                                                           | exposure                                     | canonical DB credential               |
| ----------------- | ---------------------------------------------------------------- | -------------------------------------------- | ------------------------------------- |
| Public ingress    | Console، Forge و endpoint مرورگر Core                            | فقط HTTPS پشت reverse proxy یا load balancer | فقط Core دارد                         |
| Application plane | Core/API، Native Worker، Integration Dispatcher                  | شبکهٔ خصوصی؛ health endpoint محدود           | Core دارد؛ Worker و Dispatcher ندارند |
| Runtime boundary  | adapterهای n8n، Open WebUI و OpenClaw                            | فقط شبکهٔ خصوصی و shared secret مستقل        | ندارد                                 |
| Runtime plane     | n8n، Open WebUI و OpenClaw                                       | private-only؛ بدون port عمومی مستقیم         | ندارد                                 |
| Data plane        | PostgreSQL canonical، object storage، datastoreهای داخلی runtime | private network و TLS                        | فقط Core برای canonical PostgreSQL    |

Compose production باید override مستقل، restart policy، logging، environment production-specific و حذف bind mount کد داشته باشد؛ Docker همین تفکیک development و production را توصیه می‌کند.[3] فایل‌های Compose runtime موجود contract topology هستند و جایگزین تصمیم provider یا hardening محیط واقعی نیستند.

## secret contract

| گروه              | secretها                                              | consumer مجاز                      | rotation                                     |
| ----------------- | ----------------------------------------------------- | ---------------------------------- | -------------------------------------------- |
| Identity          | `SESSION_SECRET`                                      | Core/API                           | با window کنترل‌شده و invalidation session   |
| Canonical data    | `DATABASE_URL`                                        | فقط Core/API و migration job محدود | credential role جدا برای runtime و migration |
| Artifact          | access key و secret key S3                            | فقط Core/API                       | rotation مستقل بدون تغییر object key         |
| Internal dispatch | `DISPATCHER_SHARED_SECRET` و `ADAPTER_SHARED_SECRET`  | Core، Dispatcher و adapter متناظر  | مستقل از session و runtime credential        |
| External ingress  | `INTEGRATION_HMAC_SECRETS_JSON`                       | فقط Core/API                       | key ID فعال/retiring با overlap محدود        |
| n8n               | encryption key، webhook token و runtime DB credential | فقط n8n و n8n adapter در حد نیاز   | پیش از rotation backup datastore الزامی      |
| Open WebUI        | service-account key و runtime secret                  | فقط adapter و runtime متناظر       | allowed modelها server-side می‌مانند         |
| OpenClaw          | Gateway token، channel credential و target map        | فقط runtime و adapter متناظر       | target و channel مستقل revoke می‌شوند        |

هیچ secret واقعی نباید در GitHub source، image layer، Compose file، process argument یا client bundle قرار گیرد. مقدارها فقط از secret manager به runtime تزریق می‌شوند و repository تنها نام contractها را در [`.env.example`](../.env.example) نگه می‌دارد.

## ترتیب اجرای staging پس از تأیید کاربر

| گام | اقدام                                                                | معیار عبور                                                                  |
| --: | -------------------------------------------------------------------- | --------------------------------------------------------------------------- |
|   1 | ایجاد شبکه، registry، secret namespace و identityهای least-privilege | هیچ workload هنوز public یا فعال نیست.                                      |
|   2 | ایجاد PostgreSQL، فعال‌سازی TLS، backup/WAL archive و alert          | restore آزمایشی روی database جدا موفق است.                                  |
|   3 | ایجاد bucket خصوصی، versioning، lifecycle و CORS محدود               | upload، verify، download و deletion propagation آزمایشی موفق است.           |
|   4 | ساخت imageها از SHA مصوب و ثبت digest/SBOM                           | digest همهٔ واحدها در release evidence ثبت می‌شود.                          |
|   5 | اجرای migration job یک‌باره روی database خالی یا staging             | checksum ledger، restart idempotency و schema smoke موفق است.               |
|   6 | استقرار Core، Console، Forge، Worker و Dispatcher با runtimeها خاموش | health، cookie، CSRF، CORS و tenant isolation موفق است.                     |
|   7 | فعال‌سازی n8n و import workflow غیرفعال؛ سپس credential binding      | workflow فقط پس از auth و validation فعال می‌شود.                           |
|   8 | فعال‌سازی Open WebUI با model allowlist                              | درخواست مدل بدون tool execution و usage attribution موفق است.               |
|   9 | onboarding OpenClaw و target map محدود                               | action بدون policy/approval fail-closed است.                                |
|  10 | اجرای پنج دور Golden Flow و negative tests                           | پنج اجرای متوالی، بدون cross-tenant leak یا duplicate side effect موفق است. |
|  11 | اجرای restore drill و ثبت RPO/RTO واقعی                              | بازیابی PostgreSQL و runtime volume روی محیط جدا موفق است.                  |
|  12 | اتصال DNS/TLS و canary محدود                                         | SLO، log، alert و rollback pointer معتبر است.                               |
|  13 | promotion کنترل‌شده به production                                    | user approval و release evidence نهایی ثبت شده است.                         |

PostgreSQL برای PITR به base backup و آرشیو پیوستهٔ WAL متکی است؛ رویهٔ recovery باید قبل از اتکا به آن در staging تمرین شود.[2]

## rollback و incident boundary

Rollback application با بازگرداندن ingress به **image digest قبلی** انجام می‌شود. migrationها append-only هستند؛ rollback schema با down migration خودکار انجام نمی‌شود. در رخداد ناسازگاری داده، ابتدا writeها و Dispatcher متوقف، runtimeها disable، outbox حفظ و سپس یکی از دو مسیر انتخاب می‌شود: forward fix سازگار یا restore کنترل‌شده به نقطهٔ تأییدشده. پس از restore، idempotency ledger، nonceها، approvalها، artifact metadata و usage events باید قبل از بازکردن write traffic بررسی شوند.

برای incident در action plane، OpenClaw و adapter آن نخست disable و target credential revoke می‌شوند؛ Core، Console و حافظه می‌توانند مستقل ادامه دهند. برای incident مدل، Open WebUI خاموش و model binding غیرفعال می‌شود. برای incident n8n، workflow deactivate و outbox destination متوقف می‌شود؛ هیچ‌کدام مجوز دسترسی مستقیم به canonical PostgreSQL ندارند.

## موانع Go-Live که کدنویسی محصول نیستند

| مانع                       | وضعیت فعلی                       | شرط بسته‌شدن                                      |
| -------------------------- | -------------------------------- | ------------------------------------------------- |
| انتخاب provider و region   | باز                              | تصمیم کاربر                                       |
| PostgreSQL و restore drill | اجرا نشده                        | PITR، restore و measured RPO/RTO                  |
| Object Storage واقعی       | اجرا نشده                        | lifecycle و deletion propagation                  |
| Secret manager و rotation  | اجرا نشده                        | injection، audit و rotation drill                 |
| DNS/TLS و ingress          | اجرا نشده                        | certificate، CORS و cookie verification           |
| runtime credentials        | تنظیم نشده                       | n8n/Open WebUI/OpenClaw activation gates          |
| invitation email delivery  | provider انتخاب نشده             | domain و delivery test                            |
| observability و alerting   | provider انتخاب نشده             | logs، metrics، alerts و on-call route             |
| GitHub protection          | محدودیت plan خصوصی               | protection قوی‌تر یا risk acceptance مستند        |
| advisoryهای Moderate       | waiver محدود و machine-validated | patch قبل از انقضا یا waiver تازه با کنترل جبرانی |

## پاسخ موردنیاز برای ادامه

برای آغاز مرحلهٔ staging کافی است کاربر این تصمیم‌ها را اعلام کند:

```text
1. میزبان staging:
2. میزبان production:
3. region:
4. PostgreSQL provider و RPO/RTO:
5. object storage provider:
6. secret manager:
7. container registry:
8. DNS/API hostname و TLS manager:
9. invitation email provider:
10. model provider و allowed modelها برای Open WebUI:
11. channelهای مجاز OpenClaw:
12. observability provider و alert receiver:
13. آیا cloud computer hadiran jeff برای staging استفاده شود؟ بله/خیر
14. آیا محدودیت فعلی GitHub protection موقتاً پذیرفته می‌شود؟ بله/خیر
```

تا دریافت این پاسخ، workflow `Prepare Casioplus Release Candidate` مجاز است چون فقط validation و evidence تولید می‌کند و `deploymentPerformed: false` دارد؛ هیچ workflow استقرار واقعی فعال نیست.

## References

[1]: https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html 'OWASP Secrets Management Cheat Sheet'
[2]: https://www.postgresql.org/docs/current/continuous-archiving.html 'PostgreSQL Continuous Archiving and Point-in-Time Recovery'
[3]: https://docs.docker.com/compose/how-tos/production/ 'Docker — Use Compose in production'
[4]: https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments 'GitHub Deployments and Environments'
