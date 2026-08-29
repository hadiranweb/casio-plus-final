# ADR-001: انتخاب Core برای MVP Casioplus

**وضعیت:** پذیرفته‌شده

**تصمیم:** Core MVP با **TypeScript/Node.js، PostgreSQL، Drizzle ORM و Zod** ساخته می‌شود. Rust از critical path MVP خارج است و فقط پس از MVP، با اثبات مستقل ارزش، می‌تواند به‌عنوان Native Worker یا engine تخصصی بازگردد.

## زمینه و معیار تصمیم

Casioplus باید در سریع‌ترین مسیر قابل‌راه‌اندازی، یک vertical slice عملی از Work، Flow، ProcessRun، SemanticRecord، Review، Organizational Memory، Console و Forge ارائه کند. معیار تصمیم، launchability، سرعت iteration، migration قابل‌اعتماد، تست end-to-end، tenant isolation، rollback و قابلیت مشاهدهٔ محصول است؛ نه وفاداری اجباری به یک زبان.

ممیزی مسیر Rust نشان داد که وجود کد قابل‌کامپایل به‌تنهایی برای launchability کافی نیست. شکست migration روی database خالی، seed ناسازگار، پوشاندن شکست در CI، placeholder در بخشی از منطق، ناهمگونی tenant boundary و fallbackهای خاموش، ریسک اجرای MVP را بالا می‌برد. این تصمیم به معنای بی‌ارزش‌بودن Rust نیست؛ بلکه به معنای خارج‌کردن dependency اثبات‌نشده از مسیر عرضه است.

## تصمیم نهایی

در MVP، یک Core یکپارچهٔ TypeScript/Node.js تنها canonical writer دامنه است. این Core شامل API، session edge، tenant authorization، lifecycle و repositoryهای scoped، migration و integration boundary است. PostgreSQL منبع حقیقت برای دادهٔ ساختاریافتهٔ زیر خواهد بود:

| حوزه                                               | مالک canonical در MVP |
| -------------------------------------------------- | --------------------- |
| Organization، Workspace، Actor و Membership        | Core/API + PostgreSQL |
| WorkItem، Flow و FlowVersion                       | Core/API + PostgreSQL |
| ProcessRun و RuntimeEvent                          | Core/API + PostgreSQL |
| SemanticRecord، KnowledgeClaim، Review و Promotion | Core/API + PostgreSQL |
| OrganizationalMemoryItem، Provenance و Evidence    | Core/API + PostgreSQL |
| Artifact metadata و AuditEvent                     | Core/API + PostgreSQL |

Console و Forge دو surface از یک محصول‌اند و در MVP از همین Core/API استفاده می‌کنند. آن‌ها direct database access ندارند. n8n، Open WebUI، OpenClaw و Native Worker runtime هستند، نه مالک وضعیت canonical. هیچ runtime یا container مدل/agent مجاز به نگه‌داشتن credential مستقیم PostgreSQL نیست.

## پشتهٔ پذیرفته‌شده

```text
TypeScript / Node.js Core + API
PostgreSQL + Drizzle ORM
Zod contracts
Redis + BullMQ برای اجرای asynchronous پس از نیاز واقعی
Object Storage برای artifact payloadها
Native Diagnosis Worker به‌عنوان اولین runtime
n8n Adapter برای orchestration
Open WebUI Adapter برای interaction/model plane
OpenClaw Adapter برای actionهای محدود و approval-gated
Console Web + Forge Web در یک monorepo
```

استفاده از یک host-aware web application برای Console و Forge در شروع مجاز است؛ مشروط بر این‌که route، session، permission و data projection مرز دو surface را حفظ کنند. extraction فیزیکی به دو app مستقل فقط پس از تثبیت contractها و build boundary انجام می‌شود.

## تصمیم دربارهٔ نام‌گذاری حافظه

نام‌های scientific/domain-specific canonical هستند. `OperationalEvent` برای trace خام، `SemanticRecord` برای checkpoint معنادار، `KnowledgeClaim` برای گزارهٔ candidate، `KnowledgeReview` برای بازبینی، `KnowledgePromotion` برای ارتقا و `OrganizationalMemoryItem` برای دانش معتبر و scopeدار استفاده می‌شوند.

`WorkCommit` در API canonical نام اصلی نیست. اگر تجربهٔ کاربر برای نشان‌دادن snapshot خروجی یک Work یا Run به برچسبی کوتاه نیاز داشته باشد، **Commit** صرفاً یک view/interaction label یا domain alias محدود برای `SemanticRecord`/outcome خواهد بود؛ هرگز به Branch، Pull Request، Merge یا repository-like model تبدیل نمی‌شود. بدین‌ترتیب semantics حافظه از literal GitHub مستقل باقی می‌ماند.

## پیامدها

این تصمیم ساخت یک backend دوم برای Rust و dual-write با MySQL را ممنوع می‌کند. MySQL legacy فقط در صورت وجود نیاز انتقالی بیرون از Core جدید می‌ماند و منبع حقیقت Casioplus MVP نیست. ابتدا Core/Auth و Golden Flow تکمیل می‌شوند؛ سپس UI گسترده، integrationها و deployment ساخته خواهند شد.

برای استفاده از Rust در آینده، این شروط باید مستقل اثبات شوند: build و release reproducible، migration روی database خالی، تست authorization و tenant isolation، compatibility با contractهای TypeScript، health و rollback مستقل، observability و سود قابل‌اندازه‌گیری در latency، هزینه یا پردازش تخصصی.

## ریسک‌ها و کنترل‌ها

| ریسک                             | کنترل تصمیمی                                                                     |
| -------------------------------- | -------------------------------------------------------------------------------- |
| بزرگ‌شدن Core یکپارچه            | حفظ boundaryهای package و repository، بدون زودهنگام‌کردن microservice extraction |
| فشار asynchronous execution      | افزودن Redis/BullMQ فقط همراه با use case و integration test واقعی               |
| leakage در runtime               | private network، adapter، HMAC، allowlist، redaction و عدم credential مستقیم     |
| تبدیل candidate به memory نادرست | review، provenance، scope، validity و promotion اجباری                           |
| قفل‌شدن آینده روی TypeScript     | contractهای versioned و اجازهٔ worker تخصصی مستقل پس از MVP                      |

## منابع

[1]: ../README.md 'Casioplus MVP baseline'
[2]: ./ARCHITECTURE_BASELINE_FA.md 'Casioplus architecture baseline'
[3]: ../README.md 'Casioplus MVP baseline and source of truth'
