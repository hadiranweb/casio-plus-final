# Golden Flow MVP: عارضه‌یابی کسب‌وکار و پروفایل موقعیت شغلی

## ۱. هدف

Golden Flow مسیر end-to-end قابل‌راه‌اندازی Casioplus است. یک کاربر یا مخاطب، فرم عارضه‌یابی کسب‌وکار را تکمیل می‌کند؛ سیستم input را validate و در یک ProcessRun ثبت می‌کند؛ Native Diagnosis Worker داده را با مدل پنج‌محوره تحلیل می‌کند؛ Core structured output و artifact را ثبت می‌نماید؛ یافتهٔ معنادار به SemanticRecord و KnowledgeClaim candidate تبدیل می‌شود؛ Reviewer آن را بررسی می‌کند؛ و در صورت تأیید، KnowledgePromotion یک OrganizationalMemoryItem scopeدار می‌سازد.

در این سند، «پروفایل موقعیت شغلی» خروجی ساختاریافته‌ای است که انتظارها، قابلیت‌ها و شرایط یک موقعیت را روشن می‌کند. «کاندیدا» فرد یا profile ورودی است که برای همان موقعیت با پنج محور مشخص ارزیابی می‌شود. عدد score باید همراه با rubric، evidence و confidence باشد و صرفاً یک عدد بی‌توضیح نباشد.

## ۲. contract محصول

### ورودی فرم

در MVP، input حداقل باید این بخش‌ها را داشته باشد:

| بخش               | نمونهٔ فیلدها                              | قاعدهٔ validation                       |
| ----------------- | ------------------------------------------ | --------------------------------------- |
| اطلاعات کسب‌وکار  | نام، صنعت، اندازه، مرحله                   | حداقل صنعت و اندازه لازم است            |
| مسئله/هدف         | شرح مسئله، هدف تشخیص، urgency              | متن محدود و non-empty                   |
| موقعیت شغلی       | عنوان، مسئولیت‌ها، must-have، nice-to-have | title و حداقل یک responsibility         |
| candidate profile | سابقه، مهارت‌ها، ترجیحات، محدودیت‌ها       | payload typed و size-limited            |
| شواهد             | metricها، مشاهده‌ها، سند یا توضیح          | منبع اختیاری اما در score باید مشخص شود |
| رضایت و audience  | اجازهٔ پردازش و سطح خروجی                  | بدون consent معتبر Run ساخته نمی‌شود    |

### خروجی structured

خروجی canonical worker باید JSON معتبر و versionدار باشد:

```json
{
  "schemaVersion": "business-diagnosis.v1",
  "jobProfile": {
    "title": "string",
    "responsibilities": ["string"],
    "requiredCapabilities": ["string"],
    "successCriteria": ["string"]
  },
  "candidateEvaluations": [
    {
      "candidateId": "string",
      "axes": {
        "capabilityFit": { "score": 0, "evidence": ["string"] },
        "experienceFit": { "score": 0, "evidence": ["string"] },
        "contextFit": { "score": 0, "evidence": ["string"] },
        "motivationFit": { "score": 0, "evidence": ["string"] },
        "riskAndReadiness": { "score": 0, "evidence": ["string"] }
      },
      "overallAssessment": "string",
      "confidence": 0,
      "missingEvidence": ["string"],
      "recommendation": "string"
    }
  ],
  "limitations": ["string"],
  "generatedAt": "ISO-8601"
}
```

Score range، weight و rubric باید در FlowVersion ذخیره شوند و worker نباید آن‌ها را پنهانی تغییر دهد. هر recommendation باید به axis evidence یا missing evidence متصل باشد.

## ۳. فهرست taskهای اجرایی

### A. انتشار Flow در Studio

| شناسه  | task                                                         | خروجی قابل‌بررسی                       |
| ------ | ------------------------------------------------------------ | -------------------------------------- |
| GF-A01 | Author یک FlowDefinition برای business diagnosis می‌سازد     | definition با owner و workspace scope  |
| GF-A02 | input schema و validation limits ثبت می‌شود                  | schema version و body/field limits     |
| GF-A03 | پنج محور matching و rubric ثبت می‌شود                        | axis definitions، weight و score range |
| GF-A04 | output schema و artifact formats انتخاب می‌شود               | JSON و HTML output contract            |
| GF-A05 | capture policy تعیین می‌کند چه eventهایی SemanticRecord شوند | policy versioned                       |
| GF-A06 | Native Worker binding و timeout policy ثبت می‌شود            | connector reference بدون secret خام    |
| GF-A07 | FlowVersion به‌صورت immutable ساخته و test می‌شود            | test run و validation result           |
| GF-A08 | Owner یا Admin آن را publish می‌کند                          | Publication با audience و status       |

### B. ایجاد Work و ProcessRun از App/publication

| شناسه  | task                                                                            | خروجی قابل‌بررسی                 |
| ------ | ------------------------------------------------------------------------------- | -------------------------------- |
| GF-B01 | Participant publication را باز می‌کند                                           | publication فعال و scoped        |
| GF-B02 | Core session، membership/anonymous publication policy و consent را بررسی می‌کند | authorization decision و audit   |
| GF-B03 | input با Zod و FlowVersion schema validate می‌شود                               | typed accepted/rejected response |
| GF-B04 | idempotency key و correlation ID ثبت می‌شود                                     | duplicate-safe request record    |
| GF-B05 | WorkItem و ProcessRun در یک transaction ایجاد می‌شوند                           | run با version و actor متصل      |
| GF-B06 | `input_captured` به‌عنوان OperationalEvent ثبت می‌شود                           | append-only event                |
| GF-B07 | run به worker dispatch می‌شود                                                   | signed job envelope              |

### C. اجرای Native Diagnosis Worker

| شناسه  | task                                                            | خروجی قابل‌بررسی                         |
| ------ | --------------------------------------------------------------- | ---------------------------------------- |
| GF-C01 | worker job envelope و schemaVersion را validate می‌کند          | invalid payload بدون execution رد می‌شود |
| GF-C02 | `analysis_started` ارسال می‌شود                                 | event به همان run/correlation متصل       |
| GF-C03 | job profile از input استخراج می‌شود                             | structured profile                       |
| GF-C04 | candidateها روی پنج محور با rubric ارزیابی می‌شوند              | axis scores و evidence                   |
| GF-C05 | confidence، limitation و missing evidence تولید می‌شود          | no false certainty                       |
| GF-C06 | `diagnostic_observation` به‌عنوان SemanticRecord پیشنهاد می‌شود | record با provenance                     |
| GF-C07 | `analysis_completed` یا failure صادقانه ارسال می‌شود            | terminal event و status mapping          |
| GF-C08 | retry فقط برای خطای transient و با idempotency انجام می‌شود     | no duplicate artifact یا promotion       |

### D. Artifact و ثبت نتیجه در Core

| شناسه  | task                                                        | خروجی قابل‌بررسی                        |
| ------ | ----------------------------------------------------------- | --------------------------------------- |
| GF-D01 | Core structured output را با contract validate می‌کند       | invalid output ذخیرهٔ موفق تلقی نمی‌شود |
| GF-D02 | artifact JSON ساخته و metadata ثبت می‌شود                   | content hash، media type، size، owner   |
| GF-D03 | artifact HTML ساخته و scoped download آماده می‌شود          | signed URL یا proxy مجاز                |
| GF-D04 | `output_produced` SemanticRecord ثبت می‌شود                 | source به artifact و run متصل           |
| GF-D05 | Work/Run terminal state به succeeded یا failed منتقل می‌شود | transition معتبر و immutable            |
| GF-D06 | App timeline و notification قابل‌مشاهده می‌شود              | status و correlation در UI              |

PDF بخشی از قرارداد آینده است و تا زمانی که renderer پایدار، فونت/RTL، artifact permission و regression test نداشته باشد، blocker مسیر پایه نیست. در release اول JSON و HTML کافی‌اند؛ خروجی PDF پس از اثبات فنی فعال می‌شود.

### E. Knowledge review و promotion

| شناسه  | task                                                              | خروجی قابل‌بررسی                |
| ------ | ----------------------------------------------------------------- | ------------------------------- |
| GF-E01 | از observation یا output یک KnowledgeClaim candidate ساخته می‌شود | subject/value/evidence/scope    |
| GF-E02 | claim در pending_review قرار می‌گیرد                              | در retrieval پنهان است          |
| GF-E03 | Reviewer مجاز claim و evidence را مشاهده می‌کند                   | permission و provenance visible |
| GF-E04 | Reviewer approve/reject/correct می‌کند                            | rationale و actor ثبت           |
| GF-E05 | approve باعث KnowledgePromotion می‌شود                            | target type و validity مشخص     |
| GF-E06 | OrganizationalMemoryItem scopeدار ساخته می‌شود                    | published item با lineage       |
| GF-E07 | reject یا correction بدون overwrite raw record انجام می‌شود       | immutable history               |
| GF-E08 | governed retrieval item را فقط برای scope مجاز برمی‌گرداند        | permission-first search         |

### F. App و مشاهدهٔ نتیجه

| شناسه  | task                                                          | خروجی قابل‌بررسی               |
| ------ | ------------------------------------------------------------- | ------------------------------ |
| GF-F01 | App work list را با tenant scope نشان می‌دهد                  | no cross-workspace rows        |
| GF-F02 | Run detail status، events خلاصه و artifact را نشان می‌دهد     | raw secret/runtime detail حذف  |
| GF-F03 | artifact download با permission مجدد انجام می‌شود             | scoped access                  |
| GF-F04 | review inbox برای Reviewer نمایش داده می‌شود                  | candidate state واضح           |
| GF-F05 | memory view type، scope، validity و provenance را نشان می‌دهد | explanation available          |
| GF-F06 | search علت و منبع نتیجه را نمایش می‌دهد                       | governed retrieval explanation |

## ۴. state machine و invariants

```text
WorkItem: open → in_progress → completed | cancelled
ProcessRun: queued → running → succeeded | failed | cancelled | expired
Claim: candidate → pending_review → approved | rejected | corrected | superseded
MemoryItem: draft → published → superseded | deprecated
```

Invariants مهم عبارت‌اند از: هر ProcessRun دقیقاً به یک FlowVersion immutable متصل است؛ هر terminal Run دوباره transition نمی‌گیرد؛ هر SemanticRecord به process/source/provenance متصل است؛ هر KnowledgeClaim دارای evidence و scope است؛ claim unreviewed در retrieval نیست؛ هر OrganizationalMemoryItem حداقل یک approved review و یک KnowledgePromotion دارد؛ هر Artifact دسترسی scoped و metadata canonical دارد؛ هیچ Runtime مستقیم database را نمی‌نویسد.

## ۵. Definition of Done نهایی Golden Flow

Golden Flow زمانی سبز است که در یک database خالی و environment محلی reproducible، یک Owner بتواند Flow را publish کند و Participant بتواند فرم را submit نماید؛ Core WorkItem و ProcessRun را با tenant صحیح ایجاد کند؛ Native Worker structured JSON معتبر با پنج محور و evidence تولید کند؛ Core یک output artifact JSON و یک HTML artifact بسازد؛ OperationalEvent و حداقل دو SemanticRecord معنادار (`diagnostic_observation` و `output_produced`) را ثبت کند؛ یک KnowledgeClaim candidate را در review queue قرار دهد؛ Reviewer بتواند آن را reject یا approve کند؛ approval یک OrganizationalMemoryItem بسازد؛ retrieval از همان workspace آن را با provenance برگرداند؛ retrieval از workspace دیگر آن را برنگرداند؛ retry idempotent باشد؛ failure صادقانه در UI دیده شود؛ و artifact خارج از scope قابل‌دانلود نباشد.

## ۶. test matrix

| دسته        | تست‌های حداقلی                                                                |
| ----------- | ----------------------------------------------------------------------------- |
| Contract    | input valid/invalid، output schema، schema version mismatch                   |
| Auth        | anonymous publication policy، member role، reviewer و owner permission        |
| Tenant      | cross-org، cross-workspace، altered UUID، retrieval isolation                 |
| Lifecycle   | valid/invalid transitions، terminal immutability، failure path                |
| Idempotency | duplicate submit، duplicate callback، retry after timeout                     |
| Worker      | deterministic fixture، five-axis result، missing evidence، malformed envelope |
| Memory      | candidate hidden، review audit، promotion requirements، deprecation           |
| Artifact    | metadata، hash، size limit، scoped download، redaction                        |
| Resilience  | worker unavailable، timeout، retry bound، no false success                    |
| Release     | clean migration، restart migration، check/build/format/topology               |

## ۷. خارج از مسیر پایه

Chat، Telegram، n8n، Open WebUI و OpenClaw می‌توانند بعداً همین FlowVersion و ProcessRun API را مصرف کنند. هیچ‌کدام نباید مسیر form-first را به dependency launch تبدیل کنند. در صورت افزودن channel، همان input schema، publication policy، idempotency، audit، governed retrieval و artifact delivery باید reuse شود.

## منابع

[1]: ./MVP_CHARTER_FA.md 'منشور MVP Casioplus'
[2]: ./MEMORY_TAXONOMY_FA.md 'طبقه‌بندی حافظهٔ سازمانی'
[3]: ./THREAT_MODEL_FA.md 'Threat Model امنیتی MVP'
