# ممیزی ورودی‌های معماری حافظه و Integration Gateway

## نتیجهٔ اجرایی

دو سند پیوست با معماری Casioplus هم‌راستا هستند و ارزش آن‌ها در تکمیل سه مرز قبلی است: **Memory Control Plane چندمستاجری، Integration Gateway چندمحصولی و FinOps قابل‌بازسازی**. هیچ‌کدام به‌تنهایی شواهد پیاده‌سازی production نیستند؛ هر ادعا باید با migration، route، contract، test و deployment evidence اثبات شود.

تصمیم نهایی این ممیزی، **پذیرش مشروط** است: اصول امنیت، tenant isolation، MemoryGrant، storage mode، callback، outbox، idempotency، deletion propagation و cost attribution به قانون معماری اضافه می‌شوند؛ اما مدل‌های گستردهٔ داده و قابلیت‌های Product-managed/Hybrid تا زمان implementation و validation در backlog باقی می‌مانند.

## ماتریس تصمیم

| موضوع                                               | تصمیم                               | اثر در Casioplus                                                       |
| --------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------- |
| یک Forge و Memory Control Plane مرکزی برای چند سایت | پذیرفته                             | کنترل مرکزی است، اما namespace و مالکیت هر organization جداست          |
| ExternalApp و ExternalTenant                        | پذیرفته                             | mapping در سمت server به organization/workspace انجام می‌شود           |
| Memory namespace خصوصی با default deny              | پذیرفته و release gate              | هیچ retrieval فقط با similarity، source app یا شناسهٔ client مجاز نیست |
| MemoryGrant محدود و قابل‌لغو                        | پذیرفته                             | purpose، Flow، kind، mode، زمان اعتبار، approver و audit لازم است      |
| Knowledge Pack نسخه‌دار                             | پذیرفته به‌عنوان مدل sharing ترجیحی | اشتراک pack از raw namespace جدا می‌ماند                               |
| چهار storage mode                                   | پذیرفته در contract                 | MVP با `casio_managed`؛ مدل‌های دیگر مرحله‌ای فعال می‌شوند             |
| Memory Broker                                       | پذیرفته                             | تنها مسیر access-check و query است؛ writer مستقل نیست                  |
| HMAC روی raw body، timestamp، nonce و key rotation  | پذیرفته و اجباری                    | verify پیش از parsing، با replay persistence                           |
| callback allowlist و عدم اعتماد به URL body         | پذیرفته و اجباری                    | URL مقصد فقط از mapping/policy سمت server می‌آید                       |
| outbox/dispatcher و retry                           | پذیرفته، backlog اجرایی             | برای failure isolation و restart durability لازم است                   |
| Cost Attribution immutable                          | پذیرفته                             | هر usage به Run/operation و `pricingVersion` متصل می‌شود               |
| قیمت‌های $129، $199 و floorهای سناریویی             | فقط فرض برنامه‌ریزی                 | price list یا تصمیم commercial فعلی نیستند                             |
| Product-managed و Hybrid                            | contract از ابتدا؛ activation بعدی  | raw/source ownership و deletion propagation باید اثبات شود             |
| Customer-managed/Dedicated                          | future-compatible                   | برای MVP ساخته نمی‌شود، اما contract نباید آن را ناممکن کند            |

## نکات معماری استخراج‌شده

### مدل tenant

زنجیرهٔ canonical برای اتصال محصولات متعدد چنین است:

```text
ExternalApp
→ ExternalTenant
→ CasioOrganization
→ Workspace
→ MemoryNamespace
→ StoragePolicy
```

تمام شناسه‌های موجود در payload خارجی assertion هستند. `organizationId`، `workspaceId`، `memoryNamespaceId`، `memoryGrantId`، privilege و callback URL فقط پس از resolve سمت server اعتبار پیدا می‌کنند. `sourceApp` به‌تنهایی مجوز نیست.

### مدل حافظه

حافظه باید در lifecycle زیر حرکت کند:

```text
OperationalEvent
→ SemanticRecord
→ KnowledgeClaim
→ KnowledgeReview
→ KnowledgePromotion
→ OrganizationalMemoryItem
→ governed retrieval
```

`MemoryAccessEvent` موازی با این lifecycle ثبت می‌شود و نشان می‌دهد چه actor، Flow، Run و grantای چه scopeای را مصرف کرده است؛ اما نباید raw context محرمانه را در audit کپی کند. revoke دسترسی آینده را متوقف می‌کند، درحالی‌که reference/hash اجرای قبلی برای provenance می‌تواند باقی بماند.

### مدل اشتراک

دو نوع sharing نباید با هم مخلوط شوند. در raw sharing، بخشی از item/evidence/context با مجوز صریح قابل مصرف است. در Knowledge Pack، مالک یک مجموعهٔ پالایش‌شده و versioned منتشر می‌کند و مصرف‌کننده به namespace خام دسترسی ندارد. برای sharing تجاری و چندمحصولی، Knowledge Pack انتخاب پیش‌فرض امن‌تر و قابل‌حکمرانی‌تر است.

### مدل storage

`casio_managed` برای MVP مناسب‌ترین مسیر است، زیرا سریع‌ترین vertical slice با PostgreSQL، Object Storage و index مرکزی را می‌دهد. `product_managed` برای residency یا دادهٔ حساس است و فقط context کوتاه‌عمر را از Retrieval API محصول می‌گیرد. `hybrid` به محصول اجازه می‌دهد source را نگه دارد و Casioplus فقط projection حداقلی و قابل‌حذف داشته باشد. `customer_managed` برای Enterprise آینده است.

هر projection در Hybrid باید source version/hash، retention و deletion token داشته باشد. stale projection، cache و embedding باقی‌مانده باید قابل‌تشخیص و invalidation باشد.

### مدل Gateway

Gateway فقط API invocation نیست؛ مرز رسمی identity، mapping، memory access، callback، provenance، privacy و usage است. Core همچنان تنها canonical writer می‌ماند. Gateway نباید domain محصول ثالث را مالک شود، نباید database آن را mutate کند و نباید callback مقصد را از body بپذیرد.

### مدل FinOps

هر usage باید با ابعاد زیر قابل‌بازسازی باشد:

```text
usage_event_id
organization / external_app / external_tenant / workspace
flow / flow_version / flow_run
memory_namespace / memory_item / operation_type
storage_mode / runtime / model_provider / model_name
tokens / bytes / latency
unit_cost / allocated_shared_cost / billable_amount
currency / pricing_version / occurred_at
```

گزارش مالی باید دو نما داشته باشد: P&L واقعی Casioplus و TCO کل ecosystem. هزینهٔ shared با تقسیم ساده بر تعداد سازمان‌ها تخصیص داده نمی‌شود؛ storage بر GB-day، model بر token، observability بر volume و network بر egress قابل‌قبول‌تر است و weightها باید versioned باشند.

## بررسی فرض‌های مالی

فرض‌های پیوست شامل نمونه‌هایی مانند ۲۰ GB حافظهٔ canonical، ۳۰٬۰۰۰ retrieval، ۷۵M token context، نرخ فرضی مدل $1.50/M، بستهٔ $129 برای Casio-managed و $199 برای Hybrid است. خروجی سناریویی، از جمله floorهای تقریبی $313.84 و $464.56، فقط برای نشان‌دادن خطر پلن ثابت و ضرورت metering است.

این اعداد به دلیل وابستگی به provider، region، SLA، support، backup، egress، مالیات و رفتار واقعی مشتری نباید در کد، UI یا contract به‌صورت hard-coded وارد شوند. برای implementation فقط schema و eventهای usage لازم است؛ `pricingVersion` باید منبع نرخ‌ها را نگه دارد و مدل تجاری بعداً با telemetry واقعی تعیین شود.

## gap نسبت به baseline فعلی

| قابلیت                                                | وضعیت در baseline منتقل‌شده | اقدام لازم                                              |
| ----------------------------------------------------- | --------------------------- | ------------------------------------------------------- |
| basic SemanticRecord/Claim/Review/Promotion/retrieval | موجود                       | حفظ invariant و گسترش تدریجی                            |
| namespace مستقل برای هر organization                  | هنوز کامل نیست              | migration، policy و isolation test                      |
| MemoryGrant و access-check                            | contract پیشنهادی           | route، policy engine و revoke test                      |
| MemoryAccessEvent                                     | ناقص/پیشنهادی               | migration، redaction و audit query                      |
| ExternalApp/ExternalTenant mapping                    | contract/طراحی              | server-side mapping و service identity                  |
| HMAC سادهٔ Worker                                     | موجود                       | nonce، timestamp، replay store و key rotation           |
| Gateway کامل                                          | هنوز پیاده‌سازی نشده        | invocation، callback، outbox، retry و allowlist         |
| Object Storage و projection                           | metadata پایه موجود است     | payload، checksum، signed access و deletion propagation |
| UsageEvent/CostAttribution                            | موجود نیست                  | event schema، allocator و pricing version               |
| Product-managed/Hybrid                                | فقط contract design         | retrieval API، projection invalidation و SLA evidence   |
| Knowledge Pack                                        | موجود نیست                  | pack/version/grant و sharing flow                       |

## release implication

تا وقتی tenant isolation، grant revoke، replay protection، callback allowlist، deletion/invalidation و attribution test نشده‌اند، هیچ محصول خارجی نباید به memory sharing واقعی یا public integration متصل شود. معماری اکنون برای این مسیر آمادهٔ design و implementation است، اما status درست آن **architecture accepted / implementation pending** است.

## مرجع ادغام

قواعد استخراج‌شده در این سند در [`TOPOLOGY_CONSTITUTION_FA.md`](TOPOLOGY_CONSTITUTION_FA.md) و نسخهٔ اجرایی یکپارچه در [`CANONICAL_OPERATING_INSTRUCTIONS_FA.md`](CANONICAL_OPERATING_INSTRUCTIONS_FA.md) ثبت شده‌اند.
