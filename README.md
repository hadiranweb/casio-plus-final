# Casioplus

Casioplus یک پلتفرم برای ساخت، انتشار و مصرف Flowهای قابل‌حکمرانی است. این repository مسیر MVP را با یک **Core یکپارچهٔ TypeScript/Node.js** و **PostgreSQL canonical** پیاده می‌کند. Rust از critical path خارج است و فقط پس از MVP، با اثبات مستقل ارزش، می‌تواند به‌عنوان Worker تخصصی یا موتور پردازشی بازگردد.

## سطوح محصول

`console.casioplus.com` سطح کنترل و عملیات است: Organization و Workspace، member و invitation، Integration Gateway، Work Board، Timeline، حافظهٔ governed، گراف سه‌بعدی، approval و economics. `forge.casioplus.com` سطح ساخت و اجرا است: Flow builder، version، publication، runtime binding و ProcessRun. هر دو surface فقط با Remix ساخته می‌شوند و از Core/API مشترک استفاده می‌کنند؛ Vite صرفاً compiler رسمی Remix است و UI مستقل Vite/React یا static SPA canonical نیست.

## مالکیت داده و runtime boundaries

PostgreSQL تنها منبع حقیقت برای Organization، Workspace، Actor، Work، Flow، FlowVersion، ProcessRun، OperationalEvent، SemanticRecord، KnowledgeClaim، KnowledgeReview، KnowledgePromotion، OrganizationalMemoryItem، Artifact و Audit است. Core/API تنها canonical writer است. Console، Forge، Native Worker، n8n، Open WebUI و OpenClaw direct database access ندارند و فقط از contractهای API/event استفاده می‌کنند.

n8n تنها orchestrator است؛ Open WebUI interaction/model plane است؛ OpenClaw action plane محدود و approval-gated است؛ و Native Diagnosis Worker اولین runtime Golden Flow است. هیچ runtime credential مستقیم PostgreSQL ندارد.

## ساختار repository

```text
apps/
  console-web/             Remix Console surface boundary
    app/                   root، routes، componentها و entryهای Remix
  forge-web/              Remix Forge surface boundary
    app/                   root، routes و entryهای Remix
services/
  core-api/                TypeScript/Node.js Core + API
  native-diagnosis-worker/ اولین worker deterministic عارضه‌یابی
  n8n-adapter/             signed orchestration boundary
  open-webui-adapter/      interaction/model boundary
  openclaw-adapter/        restricted action boundary
  integration-dispatcher/  outbox dispatcher بدون دسترسی مستقیم DB
packages/
  contracts/               Zod API و runtime contracts
  domain/                  Work, Flow, Run و scientific memory types
  knowledge-model/         memory-plane types
  ui/                      shared presentation primitives
migrations/                ordered PostgreSQL migrations با checksum registry
deployment/                provider-neutral release manifest و promotion evidence
docs/                      Charter، ADR، topology constitution، taxonomy، threat model و Golden Flow
scripts/                   topology validator، auth issuer و smoke tests
```

## Golden Flow MVP

```text
Form Submission
  → WorkItem + FlowVersion
  → ProcessRun
  → Native Diagnosis Worker
  → RuntimeEvent
  → JSON/HTML Artifact
  → SemanticRecord
  → KnowledgeClaim candidate
  → Human Review
  → KnowledgePromotion
  → OrganizationalMemoryItem
  → Governed Retrieval
```

اولین Flow، ورودی عارضه‌یابی کسب‌وکار را به پروفایل ساختاریافتهٔ موقعیت شغلی و ارزیابی کاندیدا با **matching پنج‌محوره** تبدیل می‌کند. Worker فعلی deterministic است و score را همراه با evidence، confidence و limitation تولید می‌کند؛ خروجی تصمیم استخدامی خودکار نیست و human review لازم است. JSON و HTML artifact در مسیر پایه هستند و PDF تا زمان وجود renderer پایدار و regression test اختیاری است.

## توسعهٔ محلی

```bash
pnpm install
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DB pnpm db:migrate
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DB SESSION_SECRET='at-least-32-characters' pnpm dev
```

برای smoke محلی با seed database، `pnpm smoke:golden` به‌صورت موقت password role تست را تنظیم و پس از اجرا پاک می‌کند، session امضاشده صادر می‌نماید و raw tenant headers را فعال نمی‌کند. این script برای production نیست و باید به database تست جدا متصل شود.

سرویس Core در `PORT=8080` به `GET /healthz` پاسخ می‌دهد. اگر `ALLOW_DEV_TENANT_HEADERS=true` فعال شود، فقط در محیط غیرproduction مجاز است. server واقعی membership authorization را enforce می‌کند و بدون `DATABASE_URL` یا `SESSION_SECRET` معتبر fail-fast می‌شود.

## commandهای validation

```bash
pnpm format:check
pnpm check
pnpm test
pnpm validate:topology
pnpm validate:security
pnpm security:audit
pnpm build
pnpm validate:performance
pnpm smoke:golden
pnpm validate:accessibility
pnpm smoke:remix
```

## تصمیم‌های مهم

این repository عمداً code یا migration خراب Rust را به مسیر MVP وارد نمی‌کند. مفاهیم domain مفید از کارهای قبلی به TypeScript contracts منتقل شده‌اند، اما canonical implementation با migration تمیز، tenant scope، idempotency، audit، review gate و تست PostgreSQL واقعی ساخته می‌شود.

در MVP از literal GitHub برای نام entityهای حافظه استفاده نمی‌شود. `Commit` یا `WorkCommit` فقط در صورت نیاز یک view/interaction label محدود برای outcome است؛ مدل canonical حافظه از `OperationalEvent`، `SemanticRecord`، `KnowledgeClaim`، `KnowledgeReview`، `KnowledgePromotion` و `OrganizationalMemoryItem` استفاده می‌کند.

## وضعیت فعلی repository

کد موجود شامل monorepo، migrationهای ordered با checksum، cookie session و CSRF، Organization/Workspace/member/invitation control plane، ownership سازمانی ExternalApp، key rotation metadata، server-side ExternalTenant mapping، Integration Gateway، transactional outbox و Dispatcher است. Memory Broker، namespace و grant governance، artifact-by-reference، immutable usage ledger، P&L/TCO، n8n، Open WebUI و OpenClaw نیز روی همان ProcessRun lifecycle و Core canonical قرار دارند.

Console اکنون Approval Inbox، target/policy lifecycle، planning assumption و runtime meter binding را مدیریت و P&L کاسیو پلاس را جدا از TCO کل ecosystem نمایش می‌دهد. Forge definition متناسب با runtime می‌سازد، version immutable را منتشر می‌کند، Work و ProcessRun ایجاد می‌کند و status/result canonical را نشان می‌دهد. OpenClaw پیش از تصمیم انسانی default-deny است و پس از approval نیز فقط با ادامهٔ صریح کاربر به outbox می‌رود.

این کد یک **production deployment candidate کامل** است و با full PostgreSQL test suite، Docker build، Golden Flow، accessibility شش‌حالته، performance budget و Remix SSR smoke اعتبارسنجی می‌شود. repository هنوز deployment انجام‌شده تلقی نمی‌شود؛ انتخاب PostgreSQL، object storage، secret manager، DNS/TLS و محیط runtime در deployment packet مرحلهٔ بعد تعیین می‌شود.

## اسناد canonical

پیش از هر تغییر معماری یا اجرایی، [`CANONICAL_OPERATING_INSTRUCTIONS_FA.md`](docs/CANONICAL_OPERATING_INSTRUCTIONS_FA.md) و [`TOPOLOGY_CONSTITUTION_FA.md`](docs/TOPOLOGY_CONSTITUTION_FA.md) باید خوانده و رعایت شوند. این دو سند مرز نام‌گذاری، dependency، tenant، حافظه، Gateway، usage attribution و release evidence را تعیین می‌کنند.

| سند                                                                                                   | نقش                                                 |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| [`MVP_CHARTER_FA.md`](docs/MVP_CHARTER_FA.md)                                                         | product scope، roles و اصول MVP                     |
| [`GOLDEN_FLOW_FA.md`](docs/GOLDEN_FLOW_FA.md)                                                         | task list و Definition of Done مسیر اصلی            |
| [`DOMAIN_GLOSSARY_FA.md`](docs/DOMAIN_GLOSSARY_FA.md)                                                 | واژه‌های canonical دامنه                            |
| [`MEMORY_TAXONOMY_FA.md`](docs/MEMORY_TAXONOMY_FA.md)                                                 | طبقه‌بندی حافظه و governed retrieval                |
| [`THREAT_MODEL_FA.md`](docs/THREAT_MODEL_FA.md)                                                       | تهدیدها و کنترل‌های امنیتی                          |
| [`CORE_SELECTION_ADR_FA.md`](docs/CORE_SELECTION_ADR_FA.md)                                           | ADR انتخاب TypeScript Core                          |
| [`TOPOLOGY_CONSTITUTION_FA.md`](docs/TOPOLOGY_CONSTITUTION_FA.md)                                     | قانون الزام‌آور توپولوژی و dependency direction     |
| [`FOUNDATION_TRANSFER_FA.md`](docs/FOUNDATION_TRANSFER_FA.md)                                         | منشأ و معیار انتقال سنگ‌بنا به repository جدید      |
| [`RELEASE_READINESS_FA.md`](docs/RELEASE_READINESS_FA.md)                                             | وضعیت validation و موانع staging/production         |
| [`CANONICAL_OPERATING_INSTRUCTIONS_FA.md`](docs/CANONICAL_OPERATING_INSTRUCTIONS_FA.md)               | دستورالعمل اجرایی یکپارچه و release gates           |
| [`ARCHITECTURE_INPUT_REVIEW_FA.md`](docs/ARCHITECTURE_INPUT_REVIEW_FA.md)                             | نتیجهٔ ممیزی دو سند حافظه و Gateway                 |
| [`PERSONA_MEMORY_ECONOMICS_FA.md`](docs/PERSONA_MEMORY_ECONOMICS_FA.md)                               | مدل سناریویی فرد، تیم، سازمان، حافظه و FinOps       |
| [`CASIOPLUS_CANONICAL_ARCHITECTURE_FA.md`](docs/CASIOPLUS_CANONICAL_ARCHITECTURE_FA.md)               | Source of Truth معماری نهایی و Remix contract       |
| [`REMIX_ARCHITECTURE_REFERENCE_FA.md`](docs/REMIX_ARCHITECTURE_REFERENCE_FA.md)                       | منابع رسمی Remix و قرارداد SSR/deployment           |
| [`adr/0002-remix-canonical-surfaces-fa.md`](docs/adr/0002-remix-canonical-surfaces-fa.md)             | ADR تصمیم قطعی Remix برای دو surface                |
| [`REMIX_MIGRATION_INPUT_REVIEW_FA.md`](docs/REMIX_MIGRATION_INPUT_REVIEW_FA.md)                       | ممیزی guide، patch و log migration Remix            |
| [`REPOSITORY_STRUCTURE_AND_REMIX_BASELINE_FA.md`](docs/REPOSITORY_STRUCTURE_AND_REMIX_BASELINE_FA.md) | ساختار عملیاتی monorepo و کد پایهٔ Remix            |
| [`BLUEPRINT_RECONCILIATION_FA.md`](docs/BLUEPRINT_RECONCILIATION_FA.md)                               | هم‌راستاسازی command center، route map و دو surface |
