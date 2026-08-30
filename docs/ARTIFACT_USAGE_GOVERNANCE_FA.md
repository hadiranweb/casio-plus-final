# حاکمیت Artifact و Usage در Casioplus

## Artifact storage

PostgreSQL فقط metadata canonical را نگه می‌دارد. byteهای artifact در object storage سازگار با S3 قرار می‌گیرند و Core/API تنها مرز ساخت upload intent، تولید object key، صدور URL امضاشده، verification و deletion propagation است. object key، callback URL و storage privilege از body کلاینت authority نمی‌گیرند.

هر artifact به Organization، Workspace، MemoryNamespace، StoragePolicy و در صورت وجود به Flow Run متصل است. metadata شامل `sourceHash`، `sourceVersion`، checksum، اندازه، زمان retention، وضعیت integrity، زمان حذف و زمان propagation حذف است. حالت MVP فقط `casio_managed` است؛ modeهای دیگر تا داشتن adapter و آزمون deletion معتبر فعال نمی‌شوند.

## Upload lifecycle

| مرحله        | مرز مسئول      | شرط موفقیت                                                                                         |
| ------------ | -------------- | -------------------------------------------------------------------------------------------------- |
| ایجاد intent | Core/API       | scope معتبر، namespace فعال، run متعلق به همان Organization و Workspace، idempotency بدون conflict |
| انتقال byte  | object storage | PUT روی URL کوتاه‌عمر و object key تولیدشده در Core                                                |
| completion   | Core/API       | HEAD واقعی، تطابق checksum و اندازه، intent منقضی‌نشده                                             |
| حذف          | Core/API       | نقش مدیریتی، StoragePolicy با deletion propagation و حذف موفق object                               |

## Usage و economics

`usage_events` append-only و immutable است. هر رکورد به Organization، Workspace، Flow، FlowVersion، ProcessRun، MemoryNamespace، operation، runtime یا model، token، byte، latency، هزینهٔ واحد، هزینهٔ مشترک تخصیص‌یافته، مبلغ billable، payer و `pricingVersion` متصل است. External App و External Tenant برای مصرف first-party می‌توانند تهی باشند و برای مصرف خارجی باید server-side با Organization resolve شوند.

قیمت در کد hard-code نمی‌شود. `pricing_assumption_versions` ورودی versioned و immutable است و می‌تواند planning یا active باشد. ثبت usage فقط با نسخهٔ active و معتبر ممکن است.

دو view مستقل نگه‌داری می‌شوند: `casioplus_pnl_usage_view` برای revenue، هزینهٔ منتسب به Casioplus و gross margin؛ و `ecosystem_tco_usage_view` برای مجموع هزینهٔ کل ecosystem بدون مخلوط‌کردن آن با P&L محصول.

## گیت‌ها

Migration روی PostgreSQL واقعی، presigned upload با object store test double، integrity verification، idempotency، deletion propagation، mutation rejection برای ledger و تفکیک summaryهای P&L/TCO در CI آزمون می‌شوند.
