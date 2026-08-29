# منشور MVP Casioplus

## ۱. تعریف محصول

Casioplus یک پلتفرم اجرای فرایند و حافظهٔ سازمانی است که ورودی‌های تحلیل کسب‌وکار مانند SWOT، تحلیل شکاف و درخواست مستقیم را به **پروفایل‌های ساختاریافتهٔ موقعیت شغلی** تبدیل می‌کند و سپس کاندیداها را با یک موتور تطبیق پنج‌محوره با آن موقعیت‌ها می‌سنجد. این قابلیت در قالب یک محصول با دو surface ارائه می‌شود: **App** برای مصرف، کنترل و مشاهده؛ و **Studio** برای ساخت، آزمون و حکمرانی Flow.

در MVP، هدف ساخت یک محصول عمومیِ همه‌کاره یا marketplace نیست. هدف، اثبات یک مسیر کامل و قابل‌اندازه‌گیری است که در آن یک سازنده در Studio یک Flow تشخیص کسب‌وکار می‌سازد، یک کاربر در App یا publication فرم را تکمیل می‌کند، Native Worker تحلیل را اجرا می‌کند، خروجی ساختاریافته و artifact تولید می‌شود، یک رکورد معنایی و claim candidate با provenance ثبت می‌گردد، و انسان می‌تواند آن را بازبینی و در صورت صلاحیت به حافظهٔ سازمانی ارتقا دهد.

## ۲. کاربران و مرز مسئولیت‌ها

| نقش                      | سطح                      | توانایی در MVP                                                                           |
| ------------------------ | ------------------------ | ---------------------------------------------------------------------------------------- |
| Platform Operator        | platform                 | نگهداری environment، release، migration و incident؛ بدون دسترسی پیش‌فرض به محتوای tenant |
| Organization Owner       | organization             | ساخت workspace، دعوت عضو، تعیین role، کنترل publication و سیاست‌های حافظه                |
| Workspace Admin          | workspace                | مدیریت Flowها، versionها، review queue و artifactهای workspace                           |
| Flow Author              | workspace                | ساخت و آزمون Flow در Studio، تعریف schema، policy و runtime binding                      |
| Reviewer                 | workspace                | بررسی claim/record، اصلاح، رد، تأیید و درخواست promotion                                 |
| Participant              | workspace یا publication | ارسال ورودی، مشاهدهٔ خروجی مجاز و وضعیت اجرای متعلق به خود                               |
| Public/External Consumer | publication              | استفاده از فرم یا channel منتشرشده بدون مشاهدهٔ Flow داخلی یا memory سازمان              |
| Runtime Service          | service                  | اجرای task، تولید event/result و callback؛ بدون مالکیت canonical state                   |

Tenant context باید از session معتبر و membership سرور تعیین شود. header خام فقط برای smoke test محلی مجاز است و هرگز مرز امنیت production نیست.

## ۳. سطوح محصول

### App

App در `app.casioplus.com` account، organization، workspace، invitation، Flow catalog، publication، Work history، ProcessRun history، artifact، review inbox و Memory View را ارائه می‌دهد. App ورودی را به Flow منتشرشده می‌سپارد و result را با permission مناسب نمایش می‌دهد. App نباید draft graph، prompt داخلی، connector secret، raw runtime credential یا دادهٔ tenant دیگر را expose کند.

### Studio

Studio در `studio.casioplus.com` برای authoring و governance است. سازنده Input schema، processing policy، matching axes، output schema، artifact format، capture rule، runtime binding، version و publication را تعریف می‌کند. Studio باید test run و diff نسخه را پشتیبانی کند، اما در MVP canvas عمومی، n8n editor داخلی، OpenClaw console و secret management خام خارج از scope است.

### Core/API

Core/API تنها canonical writer و مرز اعتماد است. این سرویس identity، tenant scope، permission، lifecycle، validation، idempotency، audit، artifact metadata، memory governance و retrieval را enforce می‌کند. تمام surfaceها و runtimeها از endpointهای typed و versioned استفاده می‌کنند.

## ۴. مدل canonical MVP

مدل دامنه با این زنجیره تعریف می‌شود:

```text
Organization / Workspace / Actor / Membership
        ↓
WorkItem → FlowDefinition → FlowVersion
        ↓
ProcessRun → OperationalEvent
        ↓
SemanticRecord → EvidenceSource → KnowledgeClaim
        ↓
KnowledgeReview → KnowledgePromotion
        ↓
OrganizationalMemoryItem → GovernedRetrieval
        ↓
App Timeline / Studio Governance / New Flow Context
```

`OperationalEvent` trace خام و قابل audit است. `SemanticRecord` checkpoint معنادار و immutable است. `KnowledgeClaim` یک گزارهٔ قابل‌بررسی است، نه حقیقت قطعی. تنها `OrganizationalMemoryItem` دارای scope، validity، provenance و governance معتبر می‌تواند در governed retrieval به Flow یا Agent داده شود.

`WorkCommit` در صورت نیاز محصولی فقط نام نمایشی یک snapshot/outcome در Timeline است و entity مستقل GitHub-like محسوب نمی‌شود. مدل canonical همان SemanticRecord، EvidenceSource، KnowledgeClaim و KnowledgePromotion است.

## ۵. Golden Flow قطعی MVP

Golden Flow اجباری MVP این است: **Business Diagnosis Form → structured job-profile output → artifact → governed memory review**.

1. Flow Author در Studio یک Flow منتشرشده با input schema عارضه‌یابی، پنج محور matching، processing policy، output schema و artifact format ایجاد می‌کند.
2. Participant در App یا publication URL یک فرم را باز می‌کند و input را ارسال می‌کند.
3. Core هویت، publication، schema، محدودیت اندازه و idempotency را بررسی و یک WorkItem و ProcessRun ایجاد می‌کند.
4. Native Diagnosis Worker از طریق contract نسخه‌دار کار را دریافت می‌کند، تحلیل را بدون direct database access انجام می‌دهد و structured output شامل job profile، evidence summary، five-axis matching result و confidence تولید می‌کند.
5. Core رویدادهای خام را ثبت می‌کند و فقط checkpointهای معنادار را به SemanticRecord تبدیل می‌نماید.
6. Artifact Builder خروجی JSON و HTML را در MVP می‌سازد و metadata را در PostgreSQL ثبت می‌کند. PDF برای اولین release تنها در صورت داشتن renderer پایدار و testable فعال می‌شود؛ در غیر این صورت به milestone بعد موکول است.
7. یک KnowledgeClaim candidate از یافتهٔ قابل‌بررسی تولید می‌شود و به Reviewer می‌رسد. این claim تا پیش از review در Governed Retrieval نمایش داده نمی‌شود.
8. Reviewer claim را approve، reject یا correct می‌کند. در حالت approve، Core یک KnowledgePromotion و سپس OrganizationalMemoryItem scopeدار ایجاد می‌کند.
9. App خروجی، artifact download، ProcessRun history، semantic timeline و وضعیت review/promotion را نشان می‌دهد. جست‌وجوی memory فقط پس از tenant، workspace، permission، validity و scope filter انجام می‌شود.

Chat، Telegram، n8n و OpenClaw در Golden Flow پایه dependency ندارند. Form-first مسیر قابل‌راه‌اندازی است؛ chat و channel integration پس از اثبات این مسیر اضافه می‌شوند.

## ۶. داخل و خارج scope

| داخل MVP                                        | خارج از MVP اولیه                           |
| ----------------------------------------------- | ------------------------------------------- |
| Organization، Workspace، Member و role پایه     | Marketplace عمومی و billing پیچیده          |
| FlowDefinition، FlowVersion، test و publish     | generic canvas و fork/branch/merge          |
| Form-first input و publication محدود            | chat-first، Telegram و multi-channel کامل   |
| ProcessRun lifecycle و RuntimeEvent             | event mesh عمومی و workflow builder بی‌حد   |
| Native Diagnosis Worker                         | Rust Core به‌عنوان dependency اصلی          |
| JSON/HTML artifact و object-storage boundary    | PDF پیچیده مگر با renderer پایدار           |
| SemanticRecord، Claim، Review و Promotion       | auto-promotion یا memory بدون governance    |
| full-text و metadata governed retrieval         | vector DB و graph DB مستقل در نقطهٔ شروع    |
| App history/review/memory views                 | dashboard تحلیلی enterprise کامل            |
| Studio wizard، schema، policy، binding          | نمایش credential و runtime internals        |
| audit، redaction، idempotency و rate limit پایه | اجرای آزاد actionهای OpenClaw               |
| CI check و container build                      | production auto-deploy پیش از staging proof |

## ۷. اصول غیرقابل‌مذاکره

PostgreSQL تنها canonical store است و Core/API تنها canonical writer. هیچ direct dual-write با MySQL legacy وجود ندارد. Runtimeها نمی‌توانند وضعیت Run، Memory یا Review را خودشان authoritative کنند. تمام queryها tenant و membership scope دارند و similarity یا full-text retrieval بعد از permission filter انجام می‌شود.

مدل‌ها فقط context و toolهای typed و allowlisted می‌بینند. action دارای side effect approval-gated است. callbackهای runtime با HMAC، timestamp، replay protection، correlation ID و idempotency کنترل می‌شوند. دادهٔ حساس در log و artifact باید redact شود. terminal stateهای Run، Review و Promotion immutable هستند و تغییرات اصلاحی به‌صورت record جدید و lineage ثبت می‌گردند.

## ۸. Definition of Done منشور

این Charter زمانی تثبیت‌شده تلقی می‌شود که موارد زیر در repository ثبت و در implementation قابل trace باشند:

| معیار                         | شواهد لازم                                        |
| ----------------------------- | ------------------------------------------------- |
| مسیر محصول روشن است           | همین Charter و Golden Flow signed-off             |
| terminology ثابت است          | Domain Glossary و Memory Taxonomy                 |
| scope قابل کنترل است          | جدول in/out scope و backlog boundary              |
| مالکیت داده روشن است          | ADR و معماری Core/API                             |
| امنیت مسیر پایه تعریف شده است | Threat Model و acceptance tests                   |
| خروجی قابل‌سنجش است           | Golden Flow DoD و smoke/integration tests         |
| Release قابل‌بررسی است        | migration، check، build و topology validation سبز |

## منابع

[1]: ./CORE_SELECTION_ADR_FA.md 'ADR انتخاب Core MVP'
[2]: ./DOMAIN_GLOSSARY_FA.md 'واژه‌نامهٔ دامنهٔ Casioplus'
[3]: ./MEMORY_TAXONOMY_FA.md 'طبقه‌بندی حافظهٔ سازمانی'
[4]: ./GOLDEN_FLOW_FA.md 'تعریف اجرایی Golden Flow'
