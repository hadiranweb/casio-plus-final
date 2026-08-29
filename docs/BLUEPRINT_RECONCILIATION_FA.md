# هم‌راستاسازی Blueprint تجربه با معماری canonical Casioplus

**وضعیت:** تصمیم اجرایی برای implementation و ادامهٔ roadmap

**محصول:** Casioplus / کاسیو پلاس

**repository canonical:** `hadiranweb/casio-plus`

## ۱. تصمیم نهایی

Blueprint تجربه برای Casioplus پذیرفته می‌شود، اما فقط در سطح information architecture، command-center experience، route map، status semantics و drill-down flow. کد، storage، identity، authorization، persistence و boundaryهای یک سیستم دیگر کپی نمی‌شوند.

> **Casioplus یک محصول واحد با دو surface اجرایی است:** Console برای control، عملیات و مصرف؛ Forge برای authoring و governance؛ Core/API برای canonical ownership، authorization و lifecycle مشترک.

| جزء                            | نقش در محصول واحد                                                                                                               | مرز قطعی                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Console در `app.casioplus.com` | ورود و account، Organization، Workspace، دعوت، دسترسی، command center، Work/Run، Review، Artifact، Memory view، usage و تنظیمات | به database، runtime داخلی یا credential دسترسی مستقیم ندارد.             |
| Forge در `forge.casioplus.com` | ساخت و ویرایش Flow، قرارداد ورودی/خروجی، policy، version، test، publish و governance                                            | clone رابط ابزار خارجی نیست و secret یا runtime credential نمایش نمی‌دهد. |
| Core/API مشترک                 | تنها canonical writer و مرز identity، tenant resolution، authorization، audit، lifecycle، Memory Broker و usage attribution     | PostgreSQL تنها canonical store است و surfaceها writer موازی ندارند.      |
| Native Worker و Adapterها      | اجرای محدود و اتصال به runtimeهای مجاز پشت contract                                                                             | direct database access و direct mutation در آن‌ها ممنوع است.              |

## ۲. بخش‌های قابل‌انتقال از تجربهٔ command center

Console نباید یک فهرست CRUD باشد. پس از ورود، کاربر باید بتواند از یک نمای عملیاتی بفهمد چه Workهایی فعال هستند، کدام Runها موفق یا ناموفق بوده‌اند، چه Reviewهایی منتظر تصمیم‌اند، وضعیت connectorها چیست و آخرین contextهای معتبر Memory کدام‌اند. این داده‌ها فقط زمانی در UI نمایش داده می‌شوند که از Core/API canonical آمده باشند.

Forge همین الگو را برای authoring به‌کار می‌گیرد: کاربر باید وضعیت Draft، validation، test run، policy، version و publish gate را در یک سطح قابل‌درک ببیند. وضعیت سبز فقط برای وضعیت تأییدشده و قابل‌اثبات مجاز است؛ وضعیت ناشناخته باید `not_configured`، اختلال باید `degraded` یا `error` و Flow آماده‌نشده باید با state واقعی خودش نمایش داده شود.

| الگوی تجربه      | Console                                                  | Forge                                                                |
| ---------------- | -------------------------------------------------------- | -------------------------------------------------------------------- |
| Header و context | Organization، Workspace، session، command/search         | Organization، Workspace، Flow فعال و test/publish context            |
| وضعیت زنده       | Active Work، ProcessRun، Review Inbox و connector health | Draft، validation، test run و publish gate                           |
| knowledge view   | Memory view، provenance، scope و freshness               | Memory policy، retrieval preview و promotion queue                   |
| drill-down       | Work → Run → Artifact → Review → Memory                  | Flow → Version → Test Run → Review/Commit → Publish                  |
| status           | `connected`، `not_configured`، `degraded`، `error`       | `draft`، `validated`، `test_failed`، `ready`، `published`، `blocked` |

## ۳. رابطهٔ Console و Forge

Console و Forge دو hostname و دو deployment unit مستقل دارند، اما session، organization، workspace، Flow ownership، Run lifecycle، Memory policy و usage logic میان آن‌ها جدا نمی‌شود. ورود کاربر از Console به Forge یک navigation بین دو surface همان محصول است، نه انتقال مالکیت یا ایجاد حساب جدید.

برای جلوگیری از hard-code شدن hostname در route، هر دو root loader اکنون `coreApiUrl`، `appUrl` و `forgeUrl` را با `publicRuntimeConfigSchema` از `@casioplus/contracts` اعتبارسنجی می‌کنند. مقدارهای `CASIOPLUS_APP_URL` و `CASIOPLUS_FORGE_URL` public هستند؛ هیچ token، cookie خام، secret یا tenant assertion از این مسیر منتقل نمی‌شود. احراز هویت و authorization همچنان باید توسط Core/API انجام شود.

| مسیر                              | قرارداد فعلی                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------ |
| Console → Forge                   | لینک public با `forgeUrl` از root loader؛ بازشدن در surface Forge، بدون انتقال credential در URL |
| Forge → Console                   | لینک public با `appUrl` از root loader؛ بازگشت به Console همان محصول                             |
| Surface → Core/API                | درخواست typed به public Core URL فعلی؛ مرز canonical در Core باقی می‌ماند                        |
| Surface → n8n/Open WebUI/OpenClaw | غیرمستقیم و فقط از طریق Core/API، Gateway و Adapter contract؛ اتصال مستقیم UI مجاز نیست          |

## ۴. route map هدف و وضعیت پیاده‌سازی

route map زیر مقصد مرحله‌ای است، نه ادعای وجود همهٔ routeها در baseline فعلی. routeهای جدید باید پس از تثبیت auth، server-side Core client و policy، با loader/actionهای Remix اضافه شوند؛ ایجاد فایل‌های placeholder که وضعیت جعلی نشان دهند مجاز نیست.

| surface         | route group هدف                                                                                                                                             | وضعیت فعلی                                                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Console         | `/` command center؛ `work-items`، `work-items/:workItemId`، `runs`، `runs/:runId`، `review`، `memory`، `artifacts/:artifactId`، `integrations` و `settings` | command center پایه در `apps/console-web/app/routes/_index.tsx` پیاده شده؛ drill-downها در backlog مرحله‌ای هستند.            |
| Forge           | `/` authoring center؛ `flows`، `flows/new`، `flows/:flowId`، `flows/:flowId/versions/:versionId`، `test-runs/:runId`، `memory`، `integrations` و `settings` | authoring/governance baseline در `apps/forge-web/app/routes/_index.tsx` پیاده شده؛ routeهای تفصیلی در backlog مرحله‌ای هستند. |
| Console و Forge | root document، SSR، client hydration، stylesheet و public runtime config                                                                                    | پیاده‌شده در `root.tsx`، `entry.client.tsx`، `entry.server.tsx` و `remix.env.d.ts` هر دو surface                              |

نام‌گذاری فایل‌های route باید با flat-route convention واقعی Remix و topology repository آزموده شود. `routes/` محل route composition است؛ route نباید `createRoot`، router مستقل، SQL، session issuance یا tenant authorization موازی داشته باشد.

## ۵. repository و ownership

ساختار فعلی repository از تفکیک blueprint پشتیبانی می‌کند، اما هر package فقط زمانی اضافه می‌شود که مسئولیت concrete و test داشته باشد. بنابراین `packages/ui` برای primitiveهای presentation و `packages/contracts` برای schema/type contract فعال‌اند. یک `packages/config` جداگانه فعلاً لازم نیست؛ public runtime configuration در contract مشترک باقی می‌ماند تا از ایجاد package کم‌ارزش و مسیر ownership موازی جلوگیری شود.

```text
apps/console-web       → Remix Console / command center / consumption
apps/forge-web    → Remix Forge / authoring / governance

packages/contracts → Zod transport contracts و public runtime schema
packages/ui        → presentation primitives مشترک، بدون I/O
packages/domain    → type و invariantهای pure
packages/knowledge-model → vocabulary و memory governance

services/core-api  → canonical writer، authorization و PostgreSQL boundary
services/native-diagnosis-worker → runtime بدون database credential
services/*-adapter → integration boundary محدود و typed
```

داده از مسیر `ExternalApp → ExternalTenant → CasioOrganization → Workspace → MemoryNamespace → StoragePolicy` در Core resolve می‌شود. شناسه‌هایی که از payload خارجی یا browser می‌آیند assertion هستند و authority نیستند. Console و Forge فقط projection مجاز تجربه را نمایش می‌دهند و مالک Memory، policy، audit یا usage ledger نیستند.

## ۶. قواعدی که از blueprint پذیرفته نمی‌شوند

تجربهٔ command center مجوزی برای copy کردن backend تک‌اپراتوری، storage محلی، persistence داخل UI یا اتصال مستقیم به ابزارهای runtime نیست. n8n فقط orchestrator، Open WebUI فقط interaction/model plane و OpenClaw فقط action plane محدود، allowlisted و approval-gated هستند. Forge سطح governance این اتصال‌هاست؛ خود ابزارهای مذکور Forge نیستند.

همچنین status نمایشی، mock connector، data جعلی، callback URL موجود در body، privilege ارسالی client، namespace ارسالی client یا route-level filter هرگز authority معماری ایجاد نمی‌کند. تمام این موارد باید در Core/API، Integration Gateway یا Memory Broker server-side resolve و audit شوند.

## ۷. وضعیت baseline و فاصلهٔ باقی‌مانده

baseline فعلی ساختار Remix، command-center shell، authoring shell، navigation بین دو surface، shared contract و shared presentation primitive را فراهم می‌کند. این baseline هنوز production identity و onboarding نهایی نیست و token توسعه‌ای localStorage باید با cookie/session امن، rotation، revocation، CSRF policy و authorization tenant-aware جایگزین شود.

| حوزه                                                                 | وضعیت                                                                         |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Console/Forge به‌عنوان یک محصول واحد                                 | implemented و در معماری، route shell و navigation ثبت شده است.                |
| Remix-only SSR                                                       | implemented و با build، `remix-serve` و SSR smoke اعتبارسنجی شده است.         |
| Core/API TypeScript/Node.js و PostgreSQL canonical                   | implemented در vertical slice فعلی؛ گسترش feature-first ادامه دارد.           |
| route map تفصیلی                                                     | design/backlog؛ فقط shellهای اصلی فعلاً فعال‌اند.                             |
| identity و session production                                        | backlog؛ baseline توسعه‌ای کافی برای production نیست.                         |
| tenant isolation/RLS و MemoryNamespace/Grant/Broker کامل             | backlog؛ قرارداد معماری موجود است و migration/test مرحله‌ای لازم است.         |
| Integration Gateway کامل با nonce/outbox/retry و callback dispatcher | backlog؛ adapter contract فعلی جایگزین implementation production نمی‌شود.     |
| Liara staging/production                                             | فعال نشده؛ prerequisiteهای زیرساخت، identity و evidence هنوز باید تکمیل شوند. |

## ۸. Definition of Done برای ادامهٔ این مسیر

هر route جدید باید با loader/action یا server-side service محدود به Core/API متصل شود، context tenant را جعل نکند، secret را به browser برنگرداند، state واقعی را نمایش دهد و برای loading، empty، error و not-configured حالت قابل‌مشاهده داشته باشد. هر feature باید contract، authorization، audit، test و topology impact خود را مشخص کند.

پذیرش نهایی این هم‌راستاسازی زمانی کامل است که command center Console و authoring center Forge با دادهٔ canonical و status قابل‌اثبات کار کنند؛ navigation بین دو surface بدون credential leakage انجام شود؛ routeهای تفصیلی از طریق Remix اضافه شوند؛ و Memory، Gateway، usage و identity قبل از هر claim دربارهٔ production readiness evidence قابل‌تکرار داشته باشند.

## منابع داخلی

[1]: ./CASIOPLUS_CANONICAL_ARCHITECTURE_FA.md 'معماری canonical Casioplus'
[2]: ./TOPOLOGY_CONSTITUTION_FA.md 'قانون topology و dependency'
[3]: ./CANONICAL_OPERATING_INSTRUCTIONS_FA.md 'دستورالعمل اجرایی canonical'
[4]: ./REPOSITORY_STRUCTURE_AND_REMIX_BASELINE_FA.md 'ساختار عملیاتی repository و baseline Remix'
