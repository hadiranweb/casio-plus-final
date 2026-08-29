# طبقه‌بندی حافظهٔ سازمانی Casioplus

## اصل بنیادین

حافظهٔ سازمانی در Casioplus یک مجموعهٔ خام از پیام‌ها، embeddingها یا memory شخصی Agent نیست. این حافظه یک لایهٔ مشترک، scopeدار، قابل‌توضیح و human-governed است که از اجرای واقعی کار و فرایند، با provenance و lifecycle روشن، دانش قابل‌استفاده تولید می‌کند.

> هیچ Runtime یا Agentی نمی‌تواند مستقیماً یک `OrganizationalMemoryItem` معتبر بسازد. Runtime فقط trace، record یا claim candidate تولید می‌کند؛ Core و governance مسیر review و promotion را enforce می‌کنند.

## چهار لایهٔ اصلی

| لایه                     | نوع canonical                                                                                                               | محتوا                                                            | در retrieval سازمانی                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------- |
| Execution Context        | context موقت                                                                                                                | session state، step context و temporary variables                | فقط برای همان execution و با retention محدود |
| Operational Trace        | `OperationalEvent`                                                                                                          | input capture، tool call، status، retry، callback، error و audit | خیر؛ فقط برای audit/replay یا debugging مجاز |
| Episodic Knowledge       | `EpisodicRecord` و `SemanticRecord`                                                                                         | روایت یک مورد، observation، outcome و checkpoint معنادار         | به‌صورت candidate یا با policy محدود         |
| Organizational Knowledge | `VerifiedFact`، `OperationalProcedure`، `GovernedDecision`، `PolicyRule` و `ValidatedPattern` در `OrganizationalMemoryItem` | دانش approved، scopeدار و دارای validity                         | بله، فقط پس از governed retrieval            |

## نوع‌ها

### OperationalEvent

`OperationalEvent` رویداد خام و append-only است. نمونه‌ها شامل `input_captured`، `analysis_started`، `worker_callback_received`، `artifact_created`، `analysis_failed` و `review_submitted` هستند. این event می‌تواند payload فنی داشته باشد، اما هرگز به دلیل ثبت‌شدن به دانش سازمانی تبدیل نمی‌شود.

حداقل metadata آن شامل `organizationId`، `workspaceId`، `actorId` در صورت وجود، `processRunId`، `correlationId`، `eventType`، `occurredAt`، `schemaVersion`، redaction status و idempotency key است.

### SemanticRecord

`SemanticRecord` یک checkpoint immutable است که از یک observation، نتیجه، تصمیم یا خروجی معنادار ساخته می‌شود. نمونهٔ Golden Flow آن `diagnostic_observation` و `output_produced` است. هر record باید به parent context، ProcessRun، source و transformation متصل باشد.

SemanticRecord با هر token، node داخلی یا callback خام ساخته نمی‌شود. capture policy در FlowVersion مشخص می‌کند کدام event می‌تواند به record تبدیل شود.

### EpisodicRecord

`EpisodicRecord` روایت ساختاریافتهٔ یک WorkItem یا ProcessRun است: مسئله چه بود، چه ورودی‌ای پذیرفته شد، چه observationهایی ایجاد شد، چه outcomeی رخ داد و چه محدودیت‌هایی وجود داشت. این نوع برای reuse و تحلیل outcome مناسب است، اما تا قبل از validation، fact یا procedure قطعی نیست.

### KnowledgeClaim

`KnowledgeClaim` گزاره‌ای است که از SemanticRecord، EpisodicRecord یا EvidenceSource استخراج شده و برای بررسی آماده می‌شود. Claim باید subject، predicate، object/value، confidence، evidence references، scope، validity proposal و extraction actor داشته باشد.

Claim در وضعیت `candidate` یا `pending_review` به Governed Retrieval راه پیدا نمی‌کند. اگر claim رد شود، علت رد immutable ثبت می‌شود. اگر اصلاح شود، نسخه یا record جدید با lineage ساخته می‌شود.

### KnowledgeReview

`KnowledgeReview` تصمیم یک Reviewer مجاز یا policy-approved reviewer است. Review می‌تواند approve، reject، correct یا supersede باشد و باید actor، rationale، timestamp، target version و evidence را ثبت کند. review یک mutation پنهان نیست؛ خود آن نیز OperationalEvent و audit record دارد.

### KnowledgePromotion

`KnowledgePromotion` نتیجهٔ رسمی انتقال claim approved به یک نوع سازمانی است. این record مشخص می‌کند چه claimی، با کدام review، توسط چه actor و برای چه scope و validity به `VerifiedFact`، `OperationalProcedure`، `GovernedDecision`، `PolicyRule` یا `ValidatedPattern` تبدیل شده است.

### OrganizationalMemoryItem

`OrganizationalMemoryItem` واحد نهایی reusable است. این item باید type، content، organization/workspace scope، audience، status، validFrom/validTo، confidence، provenance، source references، review و lineage داشته باشد. item می‌تواند supersede یا deprecate شود، اما overwrite خام مجاز نیست.

## provenance و evidence

هر SemanticRecord، KnowledgeClaim و OrganizationalMemoryItem باید بتواند پاسخ دهد: چه actor یا runtimeای آن را ایجاد کرد؟ از کدام WorkItem، ProcessRun، FlowVersion و Artifact آمده است؟ کدام input یا سند evidence آن است؟ چه تبدیلی روی آن انجام شده؟ در چه زمان و scopeی معتبر است؟

`EvidenceSource` می‌تواند input فرم، artifact JSON/HTML، ProcessRun، سند uploaded یا خروجی یک adapter باشد. وجود evidence به‌تنهایی کافی نیست؛ evidence باید با permission مناسب قابل‌مشاهده و با redaction policy سازگار باشد.

## lifecycle canonical

```text
OperationalEvent
      ↓ capture policy
SemanticRecord / EpisodicRecord
      ↓ extraction
KnowledgeClaim(candidate)
      ↓ validation
pending_review
      ├── rejected
      ├── corrected
      └── approved
              ↓ KnowledgePromotion
OrganizationalMemoryItem
              ↓ publication to authorized scope
GovernedRetrieval
              ↓ feedback / contradiction / policy change
superseded / corrected / deprecated / revalidated
```

## retrieval governance

Governed Retrieval باید همیشه به‌ترتیب زیر اجرا شود:

1. هویت actor و organization/workspace تعیین می‌شود.
2. membership و permission روی query اعمال می‌شود.
3. scope، audience، publication و sensitivity filter اعمال می‌شود.
4. status و validity و freshness بررسی می‌شود.
5. full-text یا semantic retrieval انجام می‌شود.
6. relation، confidence و outcome rerank می‌شوند.
7. برای هر نتیجه provenance و دلیل نمایش داده می‌شود.

در MVP، PostgreSQL full-text search و metadata filter کافی است. vector index، embedding و graph projection بعداً به‌صورت adapter اضافه می‌شوند و نمی‌توانند فیلتر permission را دور بزنند.

## نگهداری و حذف

OperationalEvent با retention کوتاه‌تر و access محدود نگهداری می‌شود. SemanticRecord و provenance تا زمانی که برای lineage، review یا audit لازم‌اند حفظ می‌شوند. OrganizationalMemoryItem تا زمان deprecation یا policy-based deletion معتبر است. حذف یا ناشناس‌سازی باید audit شود و نباید lineage را به یک نتیجهٔ بی‌منشأ تبدیل کند.

## معیار حافظهٔ معتبر

یک item تنها زمانی قابل‌استفاده در context Flow یا Agent است که **نوع آن مشخص، source قابل‌ردیابی، actor معلوم، scope و audience تعیین، validity قابل‌بررسی، review ثبت و promotion موفق** باشد. این معیار عمداً سخت‌گیرانه است تا حافظهٔ سازمانی به کانال نشت داده یا مخزن ادعاهای تأییدنشده تبدیل نشود.

## منابع

[1]: ./DOMAIN_GLOSSARY_FA.md 'واژه‌نامهٔ دامنهٔ Casioplus'
[2]: ./MVP_CHARTER_FA.md 'منشور MVP Casioplus'
[3]: https://arxiv.org/html/2607.03228v1 'Organizational Memory for Agentic Business Process Execution'
[4]: https://cacm.acm.org/research/reexamining-organizational-memory/ 'Reexamining Organizational Memory — Communications of the ACM'
