# Baseline معماری Casioplus

## تصمیم اصلی

برای MVP، Casioplus با یک **Core یکپارچهٔ TypeScript/Node.js** و **PostgreSQL canonical** ساخته می‌شود. PostgreSQL منبع حقیقت Organization، Workspace، Actor، Membership، WorkItem، Flow، FlowVersion، ProcessRun، OperationalEvent، SemanticRecord، KnowledgeClaim، KnowledgeReview، KnowledgePromotion، OrganizationalMemoryItem، Artifact و Audit است. Rust از critical path خارج است و فقط پس از MVP و با اثبات سود قابل‌اندازه‌گیری می‌تواند به‌عنوان Worker تخصصی بازگردد.

این انتخاب بر اساس launchability، سرعت iteration، migration reproducible، test end-to-end، tenant isolation و rollback انجام شده است؛ نه بر اساس وفاداری به زبان. هیچ dual-write دائمی با MySQL legacy وارد Core جدید نمی‌شود.

## سطح‌های محصول

Console و Forge دو surface از یک محصول‌اند، نه دو repository یا دو منبع حقیقت.

| Surface  | مسئولیت                                                                                                                                                        |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Console  | account، organization/workspace، invitation، Flow catalog/publication، Work و Run history، Artifact، Review Inbox و Memory View                                |
| Forge    | FlowDefinition، input/output schema، policy، five-axis rubric، runtime binding، test، FlowVersion و publication governance                                     |
| Core/API | identity/session edge، membership authorization، canonical lifecycle، validation، idempotency، audit، artifact metadata، review/promotion و governed retrieval |

در MVP، Console و Forge دو Remix application در یک monorepo هستند و می‌توانند در یک deployment topology مشترک یا دو deployment unit مستقل اجرا شوند؛ route، permission، data projection و hostname boundary از ابتدا جدا هستند. Vite فقط compiler رسمی Remix Vite است و UI مستقل Vite/React، static SPA server، `createRoot` مستقل و router خارج از Remix مجاز نیست. Console و Forge هرگز direct PostgreSQL یا runtime credential ندارند.

هر surface باید `app/root.tsx`، `app/routes/`، `app/entry.client.tsx` و `app/entry.server.tsx` داشته باشد و با `remix vite:build` به `build/server` و `build/client` برسد. production server با `remix-serve` اجرا می‌شود. loader/action فقط facade سطح UI برای Core/API هستند و نباید authorization، tenant mapping، memory policy یا canonical writer موازی بسازند.

## runtime boundaries

```text
Console / Forge
       ↓ authenticated typed API
TypeScript Core/API ───────── PostgreSQL
       ├───────────────────── Redis/BullMQ بعد از نیاز واقعی
       ├───────────────────── Object Storage برای payload artifact
       ├───────────────────── Native Diagnosis Worker
       ├───────────────────── n8n Adapter
       ├───────────────────── Open WebUI Adapter
       └───────────────────── OpenClaw Adapter
```

Native Worker اولین runtime Golden Flow است. n8n فقط orchestrator، Open WebUI interaction/model plane و OpenClaw action plane محدود و approval-gated است. Runtimeها فقط event، result یا candidate تولید می‌کنند؛ Core مالک state canonical باقی می‌ماند. callbackها باید HMAC، timestamp، replay protection، correlation ID و idempotency داشته باشند.

## مدل دامنه و حافظه

زنجیرهٔ canonical چنین است:

```text
WorkItem
  → FlowDefinition / FlowVersion
  → ProcessRun
  → OperationalEvent
  → SemanticRecord
  → EvidenceSource / Provenance
  → KnowledgeClaim
  → KnowledgeReview
  → KnowledgePromotion
  → OrganizationalMemoryItem
  → Governed Retrieval
```

`OperationalEvent` trace خام است و برای audit/replay نگه‌داری می‌شود. `SemanticRecord` checkpoint معنادار و immutable است. `KnowledgeClaim` گزارهٔ candidate است و تا review معتبر نیست. `OrganizationalMemoryItem` تنها واحد reusable دانش سازمانی است که باید scope، validity، audience، provenance، evidence و governance معتبر داشته باشد.

`WorkCommit` در صورت نیاز فقط view/interaction label برای outcome یا snapshot است و entity canonical GitHub-like نیست. نام‌های Branch، Pull Request، Merge و Repository وارد مدل حافظه یا authorization نمی‌شوند.

## Golden Flow

```text
Form Submission
  → Input Validation
  → WorkItem + ProcessRun
  → Native Diagnosis Worker
  → diagnosis.started / diagnosis.completed
  → JSON + HTML Artifact metadata
  → SemanticRecord: diagnostic_observation
  → SemanticRecord: output_produced
  → KnowledgeClaim(candidate)
  → Human KnowledgeReview
  → KnowledgePromotion
  → OrganizationalMemoryItem
  → permission-first Governed Retrieval
```

Golden Flow اول business diagnosis است: SWOT، gap analysis یا direct request به job-position profile ساختاریافته و candidate evaluation با پنج محور matching تبدیل می‌شود. Score بدون evidence، confidence و limitation معتبر نیست و خروجی worker تصمیم استخدامی خودکار نیست.

## قواعد غیرقابل‌مذاکره

Core/API تنها canonical writer است. tenant context در production از session یا service identity و membership سرور مشتق می‌شود؛ raw tenant headers فقط با feature flag صریح برای local development مجازند. هر repository query باید organization/workspace scope داشته باشد.

مدل‌ها فقط typed context و tools allowlisted دریافت می‌کنند. action دارای side effect approval-gated است. candidate unreviewed در Governed Retrieval حذف می‌شود. Artifact metadata در PostgreSQL canonical است و payload واقعی از Object Storage با permission recheck و signed URL کوتاه‌عمر تحویل می‌شود.

هر ProcessRun، Review و Promotion terminal state immutable دارد. اصلاح با record جدید و lineage انجام می‌شود. migrationها ordered و checksumدارند و release باید clean database، restart idempotency، rollback plan و evidence staging داشته باشد.

## منابع

[1]: ./CORE_SELECTION_ADR_FA.md 'ADR انتخاب Core MVP'
[2]: ./MVP_CHARTER_FA.md 'منشور MVP Casioplus'
[3]: ./DOMAIN_GLOSSARY_FA.md 'واژه‌نامهٔ دامنهٔ Casioplus'
[4]: ./MEMORY_TAXONOMY_FA.md 'طبقه‌بندی حافظهٔ سازمانی Casioplus'
[5]: ./THREAT_MODEL_FA.md 'Threat Model امنیتی MVP'
[6]: ./CASIOPLUS_CANONICAL_ARCHITECTURE_FA.md 'Source of Truth معماری نهایی'
[7]: ./REMIX_ARCHITECTURE_REFERENCE_FA.md 'منابع رسمی Remix و قرارداد SSR'
[8]: ./REMIX_MIGRATION_INPUT_REVIEW_FA.md 'ممیزی guide، patch و log migration'
