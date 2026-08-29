# دستورالعمل اجرایی canonical Casioplus

**وضعیت:** سند مرجع اجرایی برای repository `hadiranweb/casio-plus`
**نقش:** تکمیل‌کنندهٔ `TOPOLOGY_CONSTITUTION_FA.md` و مبنای طراحی، کدنویسی، review، migration، تست و release
**منبع تصمیم:** ادغام نتایج معتبر نشست، سند معماری چندمستاجری حافظهٔ سازمانی و بررسی Integration Gateway/مدل مالی حافظه

> این سند دو سطح را از هم جدا می‌کند: «قرارداد و قانون معماری» و «قابلیت واقعاً پیاده‌سازی‌شده». هر موردی که هنوز migration، route، test، deployment یا evidence ندارد، فقط **proposed/backlog** است و نباید به‌عنوان قابلیت production معرفی شود.

## ۱. هویت محصول و معیار تصمیم

نام repository جدید `casio-plus`، نام محصول `Casioplus` و scope بسته‌های داخلی `@casioplus` است. repositoryهای قبلی فقط provenance تاریخی/read-only هستند. Core MVP با TypeScript/Node.js و PostgreSQL ساخته می‌شود؛ Rust در critical path نیست و تنها در صورت وجود مزیت اندازه‌پذیر می‌تواند بعداً به Worker یا engine تخصصی اضافه شود.

معیار قبول هر تصمیم، **launchability، مرز امنیتی روشن، قابلیت rollback، evidence قابل‌تکرار و کمینه‌کردن دوباره‌کاری** است. افزودن technology، adapter یا abstraction بدون نیاز concrete و test معتبر milestone محسوب نمی‌شود.

### سیاست نام‌گذاری مطلق

از این نقطه فقط دو صورت رسمی مجازند: `Casioplus` در کد و اسناد لاتین، و «کاسیو پلاس» در متن فارسی و UI. نام‌ها، aliasها، abbreviationها و spellingهای محصولات یا پروژه‌های پیشین در هیچ کد، سند، UI، hostname، package، database schema، runtime، workflow، commit، log، test fixture، seed، project memory یا پیام اجرایی مجاز نیستند. اگر اشاره به گذشته برای audit لازم باشد، باید بدون بازتولید نام، به‌صورت «repository یا نسخهٔ تاریخی» و خارج از مسیر اجرایی ثبت شود؛ ترجیح این پروژه حذف کامل آن اشاره از source جدید است. این policy خود یک release gate است و scan نام‌گذاری باید پیش از commit و در CI اجرا شود.

## ۲. مدل محصول: یک Control Plane، دو surface، چند محصول متصل

Casioplus یک Control Plane مرکزی دارد که App، Studio، Core/API، Memory Broker، Integration Gateway، policy، audit و cost metering را در مرزهای مشخص مدیریت می‌کند. App برای مصرف و عملیات است؛ Studio برای authoring و governance است؛ محصولات ثالث و سایت‌های متعدد از طریق قرارداد Integration Gateway به Flowهای منتشرشده متصل می‌شوند.

> مرکزی‌بودن Studio و Memory Control Plane به معنی مشترک‌بودن حافظه نیست. کنترل مرکزی است، اما مالکیت، namespace، policy و دسترسی حافظه برای هر سازمان مستقل و پیش‌فرض خصوصی است.

| سطح                 | مسئولیت                                                                                            | ممنوعیت اصلی                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| App                 | account، organization، workspace، catalog/publication، Work/Run، Artifact، review و Memory view    | نمایش credential، prompt خصوصی یا runtime internals                |
| Studio              | Flow authoring، schema، policy، version، test، publish، audience و runtime binding                 | تبدیل‌شدن به clone عمومی n8n یا نمایش secret                       |
| Core/API            | تنها تصمیم‌گیرندهٔ authorization و canonical writer برای PostgreSQL، lifecycle، audit و governance | دورزدن tenant policy یا پذیرفتن assertion خارجی به‌عنوان authority |
| Memory Broker       | resolve و enforce کردن namespace، grant، scope، sensitivity، validity و result minimization        | retrieval بر اساس similarity یا شناسهٔ ارسالی به‌تنهایی            |
| Integration Gateway | مرز رسمی identity، invocation، callback، idempotency، mapping و audit بین محصول خارجی و Core       | direct database mutation یا اعتماد به callback URL داخل payload    |
| FinOps/Metering     | ثبت usage و cost attribution immutable و تفکیک P&L کاسیو از TCO ecosystem                          | hard-code کردن قیمت سناریویی به‌عنوان price list                   |

## ۳. توپولوژی canonical

```text
External App
└── External Tenant
    └── Integration Gateway
        ├── identity/mapping resolution
        ├── HMAC + timestamp + nonce + key rotation
        ├── allowlist + idempotency + audit
        └── Core/API
            ├── Casio Organization
            │   └── Workspace
            │       └── Project/Team
            │           └── Memory Namespace
            ├── Flow / FlowVersion / ProcessRun
            ├── Memory Broker
            ├── Artifact + Object Storage boundary
            └── FinOps / Usage Metering

Core/API ──private typed dispatch──> Native Worker / approved runtime
Core/API ──typed contract──────────> n8n / Open WebUI / OpenClaw adapters
```

Dependency direction همچنان همان قانون `TOPOLOGY_CONSTITUTION_FA.md` است: App و Studio به contract و Core API متصل می‌شوند؛ Core به domain، knowledge model و PostgreSQL متصل است؛ Worker و adapterها database credential ندارند. Integration Gateway و Memory Broker در مسیر Core/API یا service boundary تحت مالکیت Core قرار می‌گیرند و نباید writer موازی بسازند.

### قرارداد UI قطعی MVP: Remix-only

App و Studio فقط Remix application هستند. routeها، root، server entry و client entry باید در `apps/app-web/app` و `apps/studio-web/app` قرار بگیرند. scripts رسمی هر دو surface عبارت‌اند از `remix vite:dev`، `remix vite:build` و `remix-serve ./build/server/index.js`. Vite در این پروژه فقط compiler رسمی Remix Vite است؛ Vite/React standalone، `createRoot` مستقل، static SPA server، routing خارج از Remix و dependency مربوط به plugin مستقل React مجاز نیست.

loader/action یا BFF surface فقط facade برای Core/API است و نباید authorization، tenant mapping، ownership، memory policy یا usage ledger موازی بسازد. خروجی loader مانند پاسخ API عمومی تلقی می‌شود؛ secret، session خام، assertion خارجی و دادهٔ خارج از scope نباید به browser برگردد. `build/server` و `build/client` generated هستند و باید خارج از Git بمانند. primitiveهای مشترک presentation در `@casioplus/ui` و schemaهای transport در `@casioplus/contracts` نگهداری می‌شوند؛ هیچ‌کدام مالک route، session، persistence، authorization یا Core client نیستند. جزئیات tree و baseline code در `REPOSITORY_STRUCTURE_AND_REMIX_BASELINE_FA.md` ثبت شده است.

## ۴. مدل چندمستاجری و mapping

هر سایت یا محصول متصل به‌صورت `ExternalApp` ثبت می‌شود و هر سازمان/حساب تجاری در آن محصول یک `ExternalTenant` است. Core آن‌ها را در سمت سرور به `CasioOrganization` و `Workspace` نگاشت می‌کند. mapping پیشنهادی کامل چنین است:

```text
ExternalApp
→ ExternalTenant
→ CasioOrganization
→ Workspace
→ MemoryNamespace
→ StoragePolicy
```

شناسه‌های `organizationId`، `workspaceId`، `memoryNamespaceId`، `memoryGrantId`، callback URL، privilege و `allowedMemoryKinds` که از محصول خارجی یا client می‌آیند فقط **assertion** هستند. Core باید tenant، actor، membership، mapping، grant و policy را از storage و identity خودش resolve کند. `sourceApp` نیز به‌تنهایی مجوز نیست.

در MVP می‌توان یک mapping ثابت برای نخستین External App داشت، اما contract نباید طوری نوشته شود که افزودن چند سایت نیازمند مسیر موازی شود. هر mapping تغییرپذیر باید version، actor، effective time و audit داشته باشد.

## ۵. حافظه: namespace، lifecycle و اشتراک

هر سازمان هنگام bootstrap حداقل یک namespace خصوصی دارد. سلسله‌مراتب منطقی چنین است:

```text
Platform
└── External App
    └── Organization
        └── Workspace
            └── Project / Team
                └── Memory Namespace
                    ├── Memory Item
                    ├── Evidence
                    └── Edge
```

سطح حافظه می‌تواند Personal، Team، Workspace، Organization، Shared Pack یا Platform-safe باشد. پیش‌فرض همهٔ این سطوح private/deny است مگر policy صریح وجود داشته باشد. `Knowledge Pack` نسخه‌دار و پالایش‌شده برای اشتراک تجاری، reusable SOP و flow template بر raw namespace اولویت دارد؛ مصرف‌کنندهٔ pack نباید به namespace خام مالک دسترسی بگیرد.

### lifecycle canonical

```text
OperationalEvent
→ SemanticRecord
→ KnowledgeClaim (candidate)
→ KnowledgeReview
→ KnowledgePromotion
→ OrganizationalMemoryItem
→ governed retrieval
```

OperationalEvent واقعیت خام اجرای سیستم است؛ SemanticRecord برداشت ساختاریافته با provenance است؛ KnowledgeClaim ادعای نیازمند review است؛ KnowledgeReview تصمیم را ثبت می‌کند؛ KnowledgePromotion انتقال کنترل‌شده به سطح trusted است؛ OrganizationalMemoryItem نمای قابل retrieval است. هیچ متن یا event خامی نباید خودکار Fact، Procedure یا Rule معتبر شود. محتوای untrusted می‌تواند prompt injection یا memory poisoning ایجاد کند و هرگز مجاز به ساختن grant، policy یا tool permission نیست.

## ۶. MemoryGrant و access modes

هر cross-organization یا cross-namespace access باید grant صریح، محدود، قابل‌لغو و قابل‌حسابرسی داشته باشد. حداقل policy grant شامل این ابعاد است: owner و consumer organization، source و consumer workspace، namespace، purpose، access mode، نوع memory، Flowهای مجاز، External Appهای مجاز، raw evidence، export، derived memory، valid window، approver، policy version و status.

| access mode        | کاربرد                             | قاعدهٔ پیش‌فرض              |
| ------------------ | ---------------------------------- | --------------------------- |
| `metadata_only`    | discovery بدون محتوای حساس         | بدون raw content            |
| `retrieval_only`   | context پالایش‌شده برای اجرای Flow | حالت پیش‌فرض اشتراک         |
| `suggestion_only`  | پیشنهاد بدون ذخیرهٔ متن خام        | candidate باقی می‌ماند      |
| `append_candidate` | افزودن Candidate Claim             | promotion خودکار ممنوع      |
| `contribute`       | ثبت evidence/memory طبق schema     | نیازمند policy و audit      |
| `export`           | دانلود داده                        | استثنایی، هرگز default نیست |

لغو grant باید retrievalهای آینده را فوراً متوقف کند. Run و Artifact قبلی برای audit می‌توانند reference و hash خود را نگه دارند، اما grant لغوشده نباید context را دوباره تحویل دهد. اگر deletion policy لازم بداند، حذف باید به projection، embedding، graph، cache و backupهای قابل‌دسترسی propagate شود.

## ۷. Memory Broker و retrieval contract

هیچ Flow یا runtime نباید مستقیماً بر اساس namespaceهای ارسالی client retrieval کند. Memory Broker ابتدا actor، organization، workspace، Flow، purpose، grant، storage policy، sensitivity، validity و result mode را resolve می‌کند و فقط سپس query را اجرا می‌کند.

قرارداد پیشنهادی آینده:

```text
POST /api/v1/memory/access-check
POST /api/v1/memory/query
```

درخواست می‌تواند `consumerOrganizationId`، `consumerWorkspaceId`، `actorId`، `flowId`، `purpose`، namespace assertion، kind filter، text و limit داشته باشد؛ اما authority هیچ‌کدام از شناسه‌های client نیست. پاسخ باید حداقل context لازم، `memoryRefs`، provenance، grant reference، scope، expiry و result mode را برگرداند و در مدل Product-managed ترجیحاً context کوتاه‌عمر باشد.

ترتیب enforce اجباری retrieval عبارت است از: organization → workspace → namespace → grant → Flow/purpose → kind/sensitivity → validity → promotion state → ranking. فیلتر UI هرگز جایگزین query authorization نیست.

## ۸. Storage Policy و چهار مدل نگهداری

storage mode در سطح Memory Namespace یا حداقل Organization Policy ثبت می‌شود، نه در هر Node آزاد. تغییر policy باید version و audit event داشته باشد و migration بین modeها با sync، verification و deletion policy انجام شود.

| mode               | canonical owner                                          | وضعیت معماری                                                        |
| ------------------ | -------------------------------------------------------- | ------------------------------------------------------------------- |
| `casio_managed`    | Casioplus                                                | default MVP برای دادهٔ عادی؛ PostgreSQL/Object Storage/Index کاسیو  |
| `product_managed`  | محصول ثالث                                               | contract از ابتدا؛ raw، embedding دائمی و graph کامل در Casio ممنوع |
| `hybrid`           | محصول ثالث برای source، Casioplus برای projection حداقلی | contract از ابتدا، فعال‌سازی عملی بعد از تثبیت مدل A                |
| `customer_managed` | مشتری/زیرساخت dedicated                                  | مسیر Enterprise بعدی، اما contract نباید آن را غیرممکن کند          |

StoragePolicy باید دست‌کم `storageMode`، `canonicalOwner`، `region`، `rawContentPolicy`، `projectionPolicy`، `retentionPolicy`، `deletePropagationPolicy`، `providerTrainingPolicy`، `costOwner`، encryption/KMS reference و deletion SLA را مشخص کند. در Hybrid هر projection باید `sourceVersion`، `sourceHash`، retention و deletion token داشته باشد؛ stale projection یا source delete باید قابل تشخیص و invalidation باشد.

## ۹. Integration Gateway

Integration Gateway تنها مرز رسمی میان External Appها و Core است. این ماژول اجرای Flow، mapping، callback، memory access و usage event را در یک قرارداد typed و audit-friendly هماهنگ می‌کند، اما مالک domain خارجی یا writer جداگانه نیست.

کنترل‌های اجباری Gateway عبارت‌اند از:

| کنترل          | قاعده                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------- |
| authentication | HMAC روی raw bytes، timestamp، nonce، key ID و rotation؛ verify پیش از JSON parsing      |
| authorization  | resolve سمت سرور برای ExternalApp، ExternalTenant، organization، workspace، Flow و grant |
| replay         | nonce/timestamp persistence و رد request تکراری یا خارج از window                        |
| callback       | allowlist سمت server؛ URL داخل body authority ندارد                                      |
| reliability    | outbox و dispatcher مستقل، retry/backoff، timeout و dead-letter visibility               |
| idempotency    | WorkItem/FlowRun و callback keyهای یکتا و race-safe                                      |
| mutation       | فقط commandهای Core؛ direct SQL یا mutation محصول ثالث ممنوع                             |
| audit          | invocation، callback، grant، memory access، revoke، export و failure بدون raw secret     |
| redaction      | log و audit بدون token، body محرمانه یا context خام غیرضروری                             |

Flow invocation باید به WorkItem و ProcessRun canonical متصل شود. callback نتیجه باید typed، signed و idempotent باشد و failure domain محصول خارجی، Gateway و runtime قابل تفکیک بماند. ادعای «Gateway موجود است» فقط زمانی پذیرفته می‌شود که route، migration/contract، integration test و restart/retry evidence وجود داشته باشد.

## ۱۰. مدل دادهٔ پیشنهادی برای فازهای بعدی

این جدول‌ها extension پیشنهادی‌اند و تا زمان migration و تست، implemented تلقی نمی‌شوند:

```text
external_apps
external_tenants
external_tenant_mappings
memory_namespaces
memory_items
memory_evidence
memory_edges
memory_grants
memory_projections
memory_queries
memory_access_events
memory_deletion_jobs
storage_policies
knowledge_packs
knowledge_pack_versions
usage_events
cost_attributions
pricing_versions
```

`MemoryItem` باید source app/entity/version، kind، status، visibility، sensitivity، purpose، content reference/hash، storage mode، projection status، actor، approval، validity، retention و version داشته باشد. `MemoryAccessEvent` باید consumer organization/workspace، actor، Flow، Run، namespace، item references، purpose، mode، grant، result mode، raw-content flag و time را بدون ثبت محتوای محرمانه ثبت کند.

`UsageEvent` باید immutable و به invocation یا memory operation مشخص متصل باشد. `CostAttribution` باید ابعاد organization، ExternalApp، ExternalTenant، workspace، Flow، FlowVersion، Run، namespace، operation، runtime، model provider/name، tokens، bytes، latency، unit cost، allocated shared cost، billable amount، currency، pricing version و occurred-at را نگه دارد.

## ۱۱. FinOps و Cost Attribution

اعداد قیمت و margin موجود در سندهای پیوست **فرض سناریویی داخلی** هستند، نه quote فروشنده، price list قطعی، وعدهٔ سود یا توصیهٔ سرمایه‌گذاری. آن‌ها تنها پس از telemetry واقعی، region، provider contract، SLA، tax، support، backup و egress باید وارد مدل commercial شوند.

فرمول canonical:

```text
direct_cost
= model_context_cost
+ memory_gateway_cost
+ retrieval/index_cost
+ ingest_cost
+ sync_cost
+ storage_delta_cost

allocated_shared_cost
= security_ops allocation
+ backup allocation
+ observability allocation
+ support allocation

cost_to_serve
= direct_cost + allocated_shared_cost

billable_amount
= cost_to_serve × (1 + markup)
```

allocator نباید صرفاً هزینهٔ shared را بر تعداد سازمان‌ها تقسیم کند. وزن‌های پیشنهادی سند ورودی برای شروع مدل‌سازی عبارت‌اند از security/support بر اساس active organization و Run، storage/backup بر اساس GB-day، observability بر اساس log/trace volume، model بر اساس token و network بر اساس egress bytes. این وزن‌ها باید در `pricingVersion` ثبت و قابل‌تغییر باشند.

گزارش‌ها باید دست‌کم دو نما داشته باشند: **Casio P&L** برای هزینه و درآمدی که کاسیو واقعاً تحمل می‌کند، و **ecosystem TCO** که هزینهٔ سمت Product-managed یا Hybrid را نیز نشان می‌دهد. در Hybrid، هزینهٔ محصول ثالث باید explicit باشد و فقط با قرارداد pass-through، customer-paid یا owner-paid به مدل مالی منتقل شود.

مدل packaging پیشنهادی برای آزمایش MVP چنین است:

```text
Subscription = memory capacity + base Run/operation + governance
Usage = context tokens + retrieval overage + storage overage + external sync
```

context، storage، retrieval، sync و export باید metered و قابل مشاهده باشند. embedding و graph پیشرفته opt-in هستند؛ full-text و metadata اولویت MVP دارند. هیچ قیمت سناریویی نباید بدون pricing version و usage evidence به UI عمومی راه یابد.

## ۱۲. مدل اقتصادی پرسونا و حافظه

Casioplus باید economics را بر دو محور مستقل مدل کند: پرسونا/سطح مشتری و کانال مصرف. فرد، تیم/Startup و سازمان از یک App، Studio، Core/API و Memory Control Plane استفاده می‌کنند؛ تفاوت اقتصادی از seat، workspace، ظرفیت، governance، SLA، پشتیبانی، حجم مصرف و اتصال چندمحصولی می‌آید، نه از ساختن محصول یا Studio جداگانه.

بسته‌بندی canonical سه جزء دارد: `Platform subscription` برای App/Studio، `Memory entitlement` برای ظرفیت و governance، و `Usage metering` برای context، retrieval، storage، sync و export. `External Studio/Gateway` یک add-on قابل‌فعال‌سازی است و قیمت‌های scenario آن سند، price list یا entitlement hard-coded نیستند. پروفایل‌های planning فرد، تیم و سازمان در [`PERSONA_MEMORY_ECONOMICS_FA.md`](PERSONA_MEMORY_ECONOMICS_FA.md) ثبت شده‌اند.

قواعد economics اجباری‌اند: همهٔ usage/cost باید immutable و به organization، External App/Tenant، workspace، Flow/Version/Run، namespace، operation، runtime/model، token/byte/latency، unit cost، shared allocation، payer، billable amount و `pricingVersion` وصل باشد؛ P&L کاسیو از TCO کل ecosystem جدا گزارش شود؛ Hybrid product-side cost صریح و قراردادی باشد؛ و هیچ عدد سناریویی بدون source، reference date و formula chain در UI یا billing نهایی وارد نشود.

فرمول‌های پایه عبارت‌اند از `revenue_total = configured_core_price + context_revenue`، `casio_cost_total = core_cost + context_cost`، `ecosystem_cost_total = casio_cost_total + product_side_cost` و `gross_margin = gross_profit / revenue`. مدل values-only یا مقدار گرد‌شده تا زمان بازسازی formula chain فقط planning artifact است. هر اختلاف rounding باید با precision داخلی و گردکردن در لایهٔ presentation حل شود.

## ۱۳. امنیت، حریم خصوصی و حذف

هر memory هم دادهٔ مشتری است و هم می‌تواند رفتار AI/Agent و tool call را شکل دهد. بنابراین tenant isolation، least privilege، data minimization، provenance، human promotion، prompt-injection defense، encryption، audit، retention، deletion و incident response الزام‌اند.

Deletion فقط حذف ردیف canonical نیست. برای هر namespace یا item باید مشخص باشد چگونه cache، embedding، graph، projection، artifact reference، outbox و backupهای قابل‌دسترسی مدیریت می‌شوند. حفظ hash/reference برای audit با نگهداری raw content یکسان نیست. export باید grant و audit مستقل داشته باشد. provider training policy باید در StoragePolicy و قرارداد مشتری مشخص باشد.

این سند مشاورهٔ حقوقی یا مالی شخصی نیست. برای دادهٔ پزشکی، حقوقی، کارکنان، cross-border، residency، subprocessor و termination باید review حقوقی و قراردادی مستقل انجام شود.

## ۱۴. ترتیب پیاده‌سازی

| مرحله | خروجی لازم                                            | gate پذیرش                                                             |
| ----- | ----------------------------------------------------- | ---------------------------------------------------------------------- |
| A     | ExternalApp/ExternalTenant mapping و service identity | mapping server-side، HMAC raw-body، nonce و cross-tenant negative test |
| B     | private MemoryNamespace و StoragePolicy مدل A         | namespace default-deny، policy version و tenant isolation              |
| C     | MemoryGrant، access-check و retrieval-only Broker     | revoke فوری، scope/purpose/Flow enforcement و access audit             |
| D     | MemoryAccessEvent، deletion job و projection boundary | redaction، retention، deletion/invalidation test                       |
| E     | Integration Gateway invocation + outbox/callback      | retry، timeout، idempotency race و callback allowlist                  |
| F     | UsageEvent، CostAttribution و PricingVersion          | rebuildable attribution و گزارش Casio P&L/TCO                          |
| G     | Knowledge Pack و Hybrid/Product-managed contract      | source hash، stale projection، deletion propagation و SLA evidence     |
| H     | public publication/participant flow و staging         | identity واقعی، artifact delivery، E2E، backup/restore و rollback      |

ترتیب مراحل A تا D باید قبل از sharing واقعی حافظهٔ بین سازمانی تکمیل شود. مدل Hybrid و Product-managed از ابتدا در contract قابل‌توسعه می‌ماند، اما activation آن پس از تثبیت `casio_managed` و evidence deletion انجام می‌شود.

## ۱۵. Definition of Done توسعه

هر تغییر جدید باید جای خود را در topology مشخص کند، dependency direction را رعایت کند، و اگر به memory/integration/finance مربوط است contract و migration آن را همراه test اضافه کند. هیچ assertion خارجی نباید authority شود؛ هیچ runtime یا adapter نباید DB credential بگیرد؛ هیچ retrieval نباید بدون tenant/grant policy انجام شود؛ هیچ claim نباید بدون review/promotion trusted شود؛ و هیچ cost number نباید بدون pricing version و source telemetry commercial معرفی شود.

قبل از merge، این validation پایه باید سبز باشد:

```text
pnpm format:check
pnpm check
pnpm test
pnpm validate:topology
pnpm build
```

برای تغییرهای migration/runtime/integration، migration restart، Golden Flow، cross-tenant negative tests، replay/duplicate tests، timeout/retry tests، revoke/deletion tests و cost attribution rebuild نیز لازم است. برای تغییرهای UI یا Dockerfile، build واقعی Remix و Docker build همان surface نیز باید موفق شود. `pnpm --filter @casioplus/app-web deploy --prod --legacy` و معادل Studio باید در صورت تغییر deployment contract قابل‌اثبات باشند. `|| true` برای gateهای امنیتی، isolation، replay، callback، deletion یا financial correctness ممنوع است.

## ۱۶. وضعیت پیاده‌سازی و مرز ادعا

در baseline فعلی، Core، migrationهای اولیه، signed session، membership enforcement، basic memory governance، Native Worker، دو Remix surface با SSR build، adapter contractها، smokeها و CI/CD gated وجود دارند. موارد MemoryNamespace/MemoryGrant گسترده، Memory Broker مستقل، Integration Gateway کامل، outbox durable، storage mode واقعی، Knowledge Pack، MemoryAccessEvent کامل، deletion propagation، UsageEvent/CostAttribution production و Product-managed/Hybrid هنوز باید با migration، route، test و staging evidence ساخته شوند.

بنابراین عبارت‌های درست برای وضعیت فعلی این‌ها هستند: «architecture contract ثبت شده»، «vertical slice قابل‌اجرا»، «backlog implementation»، یا «staging prerequisite». عبارت‌های «memory چندمستاجری کامل»، «Gateway production-ready»، «قیمت نهایی» و «production-ready» تا زمان evidence مربوطه مجاز نیستند.

## اسناد مرجع مرتبط

| سند                                                                                              | نقش                                                  |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| [`TOPOLOGY_CONSTITUTION_FA.md`](TOPOLOGY_CONSTITUTION_FA.md)                                     | قانون directory، dependency، trust و write ownership |
| [`MEMORY_TAXONOMY_FA.md`](MEMORY_TAXONOMY_FA.md)                                                 | lifecycle و terminology حافظه                        |
| [`THREAT_MODEL_FA.md`](THREAT_MODEL_FA.md)                                                       | threat و security control                            |
| [`GOLDEN_FLOW_FA.md`](GOLDEN_FLOW_FA.md)                                                         | مسیر عملیاتی و DoD اصلی                              |
| [`FOUNDATION_TRANSFER_FA.md`](FOUNDATION_TRANSFER_FA.md)                                         | منشأ snapshot و معیار انتقال                         |
| [`RELEASE_READINESS_FA.md`](RELEASE_READINESS_FA.md)                                             | وضعیت validation و release gate                      |
| [`PERSONA_MEMORY_ECONOMICS_FA.md`](PERSONA_MEMORY_ECONOMICS_FA.md)                               | مدل سناریویی پرسونا، حافظه، margin و FinOps          |
| [`ARCHITECTURE_INPUT_REVIEW_FA.md`](ARCHITECTURE_INPUT_REVIEW_FA.md)                             | نتیجهٔ ممیزی ورودی‌های حافظه و Gateway               |
| [`CASIOPLUS_CANONICAL_ARCHITECTURE_FA.md`](CASIOPLUS_CANONICAL_ARCHITECTURE_FA.md)               | معماری نهایی و تصمیم قطعی Remix برای دو surface      |
| [`REMIX_ARCHITECTURE_REFERENCE_FA.md`](REMIX_ARCHITECTURE_REFERENCE_FA.md)                       | منابع رسمی Remix و قرارداد SSR/deployment            |
| [`REMIX_MIGRATION_INPUT_REVIEW_FA.md`](REMIX_MIGRATION_INPUT_REVIEW_FA.md)                       | ممیزی guide، patch و log migration Remix             |
| [`REPOSITORY_STRUCTURE_AND_REMIX_BASELINE_FA.md`](REPOSITORY_STRUCTURE_AND_REMIX_BASELINE_FA.md) | ساختار عملیاتی monorepo و کد پایهٔ Remix             |
| [`BLUEPRINT_RECONCILIATION_FA.md`](BLUEPRINT_RECONCILIATION_FA.md)                               | هم‌راستاسازی command center، route map و دو surface  |

## منابع ورودی

این سند از اسناد معماری حافظه و Integration Gateway و همچنین مدل‌های اقتصادی پرسونا، دادهٔ ساختاریافتهٔ unit economics و workbookهای persona/memory به‌عنوان design input استفاده کرده است. اعداد اقتصادی سناریویی و داخلی‌اند، فایل اقتصادی اعلام‌شدهٔ بارگذاری‌نشده مبنای تحلیل نیست، و هر تصمیم commercial باید با telemetry، قرارداد providerها، SLA، region و cost owner واقعی بازبینی شود.
