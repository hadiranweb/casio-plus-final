# قانون اساسی توپولوژی Casioplus

**وضعیت:** الزام‌آور از اولین commit repository `hadiranweb/casio-plus`
**دامنه:** تمام کد، اسناد، migrationها، runtimeها، adapterها، Memory Control Plane، Integration Gateway، FinOps، workflowها و deployment unitهای Casioplus
**اولویت تصمیم:** launchability و سرعت رسیدن به MVP، بدون قربانی‌کردن مرزهای tenant، هویت، provenance و امنیت

## تعریف قانون

> هیچ feature، service، integration یا refactor جدیدی نباید dependency direction، مرز مالکیت داده یا مرز اعتماد تعریف‌شده در این سند را نقض کند. اگر نیاز جدید با این قانون سازگار نیست، ابتدا همین سند و ADR مربوطه باید آگاهانه اصلاح شود؛ سپس پیاده‌سازی آغاز می‌شود.

این سند توپولوژی را به معنای **جایگاه هر جزء، مسیر مجاز ارتباط، مالکیت state و سطح اعتماد** تعریف می‌کند. نام repository `casio-plus` است، نام محصول `Casioplus` و scope بسته‌های داخلی `@casioplus` است. نام‌های repositoryهای قدیمی فقط در provenance تاریخی مجازند و جزء runtime یا source of truth نیستند.

## اصل‌های تغییرناپذیر

| اصل                         | قانون اجرایی                                                                                                                                                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core canonical              | فقط Core/API نویسندهٔ canonical برای PostgreSQL، lifecycle، authorization، audit، memory governance، artifact metadata، mapping و usage attribution است.                                                                               |
| PostgreSQL canonical        | PostgreSQL تنها store رسمی دامنه است؛ MySQL legacy وارد مسیر جدید یا dual-write دائمی نمی‌شود.                                                                                                                                         |
| Memory Control Plane        | حافظهٔ هر سازمان namespace مستقل و default-deny دارد؛ Memory Broker تنها مرجع resolve و enforce کردن grant، scope، validity و result minimization است.                                                                                 |
| Integration Gateway         | تنها مرز رسمی External App/External Tenant با Core است؛ mapping، invocation، callback، replay، idempotency و audit را کنترل می‌کند و writer موازی نیست.                                                                                |
| FinOps evidence             | هر usage و cost به Run/operation و pricing version متصل و immutable است؛ P&L کاسیو از TCO کل ecosystem جدا گزارش می‌شود.                                                                                                               |
| TypeScript MVP              | Core بحرانی با TypeScript/Node.js ساخته می‌شود. Rust در critical path نیست و تنها بعداً، با مزیت اندازه‌پذیر، می‌تواند Worker تخصصی باشد.                                                                                              |
| دو surface، یک محصول        | Console و Forge دو سطح محصول با boundary و UX مستقل‌اند، اما از Core/API و قراردادهای مشترک استفاده می‌کنند.                                                                                                                           |
| tenant-first                | organization و workspace پیش از هر read، search، artifact access یا runtime callback resolve و authorize می‌شوند.                                                                                                                      |
| memory governed             | OperationalEvent، SemanticRecord، KnowledgeClaim، KnowledgeReview، KnowledgePromotion و OrganizationalMemoryItem مراحل متمایز هستند؛ هر claim بدون review، promotion، provenance، scope و validity وارد retrieval قابل‌اعتماد نمی‌شود. |
| runtime محدود               | Worker، n8n، Open WebUI و OpenClaw به PostgreSQL credential مستقیم ندارند؛ ارتباطشان با Core از قرارداد typed، identity سرویس و HMAC/nonce/replay control عبور می‌کند.                                                                 |
| no hidden side effects      | write side-effect در action plane فقط با allowlist، approval و idempotency مجاز است.                                                                                                                                                   |
| generated files خارج از Git | `node_modules`، `dist`، build output، `.env`، secret، dump و log در repository commit نمی‌شوند.                                                                                                                                        |

## توپولوژی دایرکتوری

```text
casio-plus/
├── apps/
│   ├── console-web/                    # Remix surface مصرف، عملیات و مشاهده
│   │   └── app/                     # root، routes و entryهای Remix
│   └── forge-web/                 # Remix surface ساخت، حکمرانی و publication
│       └── app/                     # root، routes و entryهای Remix
├── services/
│   ├── core-api/                   # تنها API writer و مرز canonical دامنه
│   ├── integration-dispatcher/     # مصرف‌کنندهٔ outbox از API داخلی Core؛ بدون DB access
│   ├── native-diagnosis-worker/    # runtime تخصصی بدون DB access
│   ├── n8n-adapter/                # orchestrator-only contract
│   ├── open-webui-adapter/         # interaction/model-plane contract
│   ├── openclaw-adapter/           # محدود به action allowlist و approval
│   └── github-app-adapter/         # PR ترجمهٔ محدود و webhook امضاشده؛ بدون DB/merge
├── packages/
│   ├── contracts/                  # schema و قرارداد transport مشترک
│   ├── domain/                     # type و invariantهای دامنه، بدون I/O
│   ├── knowledge-model/            # taxonomy و governance حافظه
│   ├── i18n/                       # catalogهای Git-owned، compiler و formatter مشترک en/fa
│   └── ui/                         # primitiveهای presentation-only مشترک
├── migrations/                     # SQL ordered و checksum-verified برای PostgreSQL
├── deployment/                     # Dockerfile و release manifest هر unit
├── scripts/                       # validation، smoke و ابزار توسعهٔ کنترل‌شده
├── docs/                          # Charter، ADR، threat model و قوانین معماری
├── .github/workflows/              # CI/CD؛ بدون secret در source
├── package.json
├── pnpm-workspace.yaml
└── pnpm-lock.yaml
```

وجود directoryهای جدید فقط وقتی مجاز است که نقش آن‌ها در همین سند یا یک ADR پذیرفته‌شده ثبت شود. Memory Broker و Integration Gateway در MVP ابتدا module یا boundary تحت مالکیت Core هستند؛ extraction به service مستقل فقط با ADR، service identity و test مرزی مجاز است. ایجاد یک `gateway`، `web`، `target` یا root service موازی برای دورزدن Core ممنوع است.

### قرارداد UI قطعی MVP

Console و Forge هر دو **Remix application** هستند و routeهای canonical آن‌ها باید در `apps/console-web/app` و `apps/forge-web/app` قرار گیرند. هر surface باید `root.tsx`، `entry.client.tsx`، `entry.server.tsx`، `routes/` و declaration استاندارد `remix.env.d.ts` داشته باشد. UI مستقل مبتنی بر Vite/React، `createRoot`، static SPA server، `src/`، `index.html` قدیمی یا entrypoint جدا از Remix مجاز نیست. استفاده از Vite فقط در نقش compiler رسمی Remix Vite مجاز است؛ runtime، routing، SSR، loader/action و server entry متعلق به Remix است. build باید `build/server` و `build/client` تولید کند و production با `remix-serve` اجرا شود. هر تغییر این قرارداد باید هم‌زمان validator، package scripts، Dockerfile، CI و release manifest را به‌روزرسانی کند.

## dependency direction

مسیر dependency مجاز از پایین به بالا و از surface به Core است؛ reverse import یا circular dependency ممنوع است. در لایهٔ UI، dependency مستقیم به `@remix-run/*` مجاز و dependency به database، migration، runtime داخلی یا secret ممنوع است. deploy production dependency در pnpm 10 تا زمان migration رسمی به injected workspace packages باید با `pnpm --filter ... deploy --prod --legacy` validation شود.

```text
apps/console-web ───────┐
                    ├──> packages/contracts
                    └──> packages/ui
apps/forge-web ────┘          │
                               ├──> packages/domain
                               └──> packages/knowledge-model

services/core-api ─────────────> contracts + domain + knowledge-model + PostgreSQL
                              ├── Memory Broker (Core-owned boundary)
                              ├── Integration Gateway (Core-owned boundary)
                              └── FinOps/Metering (Core-owned boundary)
services/integration-dispatcher ─> Core internal API only (بدون PostgreSQL credential)
services/native-worker ──────────> contracts + domain      (بدون PostgreSQL و Redis credential)
services/n8n-adapter ────────────> contracts               (orchestrator-only)
runtime/n8n ─────────────────────> GitHub App snapshot read-only + Core signed tick (بدون DB/action)
services/open-webui-adapter ─────> contracts               (typed interaction/context)
services/openclaw-adapter ───────> contracts               (allowlist/approval/idempotency)
services/github-app-adapter ─────> contracts + GitHub API  (فقط branch/catalog/PR؛ بدون DB/merge)
```

`packages/domain` و `packages/knowledge-model` نباید به Express، `pg`، Drizzle، Redis، browser API یا یک adapter خارجی import داشته باشند. `packages/ui` فقط presentation primitive، token و accessibility helper است و نباید route، session، tenant policy، Core client یا persistence داشته باشد. `packages/contracts` باید transport-neutral بماند و نباید session secret، database client یا runtime credential را در schema خود قرار دهد. Console و Forge نباید مستقیماً به database، migration، runtime داخلی یا secret دسترسی داشته باشند.

## مرز مالکیت داده و write path

| داده                                              | مالک canonical                 | نویسندهٔ مجاز                                             | مصرف‌کنندگان                             |
| ------------------------------------------------- | ------------------------------ | --------------------------------------------------------- | ---------------------------------------- |
| identity، organization، workspace، membership     | Core/PostgreSQL                | Core/API و identity subsystem آینده                       | Console، Forge، audit                    |
| Work، Flow، FlowVersion، ProcessRun، RuntimeEvent | Core/PostgreSQL                | Core/API                                                  | Console، Forge، runtime با callback مجاز |
| Artifact metadata و بعداً object payload          | Core + Object Storage boundary | Core/API یا artifact service تحت authorization Core       | Console با signed download/proxy         |
| SemanticRecord و KnowledgeClaim                   | Core/PostgreSQL                | Core/API پس از provenance check                           | review و governed retrieval              |
| KnowledgeReview و KnowledgePromotion              | Core/PostgreSQL                | actor مجاز و policy Core                                  | retrieval و audit                        |
| اجرای runtime                                     | Worker خارج از DB              | Core dispatch؛ Worker فقط نتیجهٔ signed را بازمی‌گرداند   | Core و Console/Forge از طریق Core        |
| action side-effect                                | سرویس مقصد از طریق adapter     | OpenClaw adapter پس از approval و allowlist               | Core audit و actor مجاز                  |
| Translation Proposal Schedule و ScheduleRun       | Core/PostgreSQL                | Core/API؛ n8n فقط tick امضاشده و snapshot read-only       | Forge، audit و dispatcher                |
| Translation Change Set و وضعیت PR                 | Core/PostgreSQL                | Core/API؛ webhook GitHub فقط از Integration Gateway       | Forge، audit و actor مجاز                |
| branch/commit/Pull Request ترجمه                  | GitHub repository              | GitHub App adapter پس از approval؛ هرگز main/merge مستقیم | CI و بازبین انسانی                       |

هیچ adapter یا Worker حق ندارد SQL، migration یا database credential داشته باشد. Runtime output باید از مسیر Core به event، run state، artifact و memory governance تبدیل شود؛ ثبت مستقیم و بی‌واسطهٔ runtime در PostgreSQL ممنوع است.

## مرزهای اعتماد و ارتباط

ارتباط انسانی از Console یا Forge با Bearer/session معتبر به Core می‌رسد. در نسخهٔ MVP، session امضاشده فقط foundation توسعه و smoke است و login، rotation، revocation، onboarding، invitation و CSRF/cookie policy باید پیش از public launch تکمیل شوند.

ارتباط Core با Native Worker یک مسیر private service-to-service است و باید دارای `RUNTIME_SHARED_SECRET`، HMAC روی body، timestamp، nonce و replay persistence باشد. human session نباید در production جایگزین service identity شود. Worker فقط payload typed را دریافت می‌کند و نتیجهٔ typed را برمی‌گرداند؛ Core authorization، persistence و state transition را انجام می‌دهد.

ارتباط با n8n فقط برای orchestration مجاز است. n8n نباید source of truth یا محل نگهداری state canonical شود. workflow زمان‌بندی ترجمه فقط می‌تواند snapshot خواندنی catalog از `main` بگیرد و tick دارای secret و timestamp به Core بفرستد؛ ساخت ScheduleRun، ProcessRun، outbox، usage و Translation Change Set فقط در Core انجام می‌شود. خروجی زمان‌بندی‌شده همیشه `draft` است و review، approval، Pull Request، merge و release خودکار ممنوع‌اند. Open WebUI فقط interaction/model plane است و از typed tools/context استفاده می‌کند. OpenClaw فقط action plane محدود است و هر side-effect آن باید allowlisted، approval-gated، دارای approval UUID، expiry و idempotency باشد.

## قواعد سطح‌های محصول

### Console

Console برای account، organization، workspace، membership، Flow catalog/publication، Work/Run history، Artifact و Memory view است. Console می‌تواند دادهٔ مجاز را از Core بخواند یا command معتبر به Core بفرستد، اما نباید Flow internals، credentials، runtime secret، prompt خصوصی یا topology داخلی Worker را نمایش دهد.

### Forge

Forge برای authoring و governance است: input/output schema، policy، version، test، publish، audience و runtime binding. Forge باید به‌جای بازسازی UI عمومی n8n، contract سطح Casioplus را ارائه کند. credential و runtime internals فقط به‌صورت reference/policy قابل‌نمایش‌اند، نه secret یا database detail.

### Core/API

Core تنها نقطهٔ تصمیم‌گیری authorization و تنها canonical writer است. routeهای جدید باید tenant scope را پیش از query یا retrieval enforce کنند، correlation ID و audit مناسب داشته باشند، idempotency و terminal immutability را رعایت کنند و خطاهای runtime را typed و قابل‌ردیابی برگردانند.

## قانون حافظهٔ سازمانی

Raw event و دانش تأییدشده دو چیز متفاوت‌اند. `OperationalEvent` واقعیت خام اجرای سیستم است؛ `SemanticRecord` برداشت ساختاریافتهٔ وابسته به provenance است؛ `KnowledgeClaim` گزاره‌ای است که نیاز به review دارد؛ `KnowledgeReview` تصمیم انسانی یا policy-based را ثبت می‌کند؛ `KnowledgePromotion` انتقال کنترل‌شده به سطح قابل‌اعتماد است؛ `OrganizationalMemoryItem` نمای canonical مورد استفادهٔ governed retrieval است.

هر retrieval باید به ترتیب زیر محدود شود: organization، workspace، namespace، grant، Flow/purpose، sensitivity، validity، promotion state و سپس full-text/vector ranking. نتیجهٔ unreviewed، candidate یا خارج از scope نباید در پاسخ قابل‌اعتماد ظاهر شود. شناسه‌های namespace و grant ارسالی client یا External App فقط assertion هستند و باید سمت server resolve شوند. هر memory item باید بتواند provenance، actor، source record، review، validity، storage mode و deletion policy خود را توضیح دهد.

### اشتراک حافظه

اشتراک raw namespace از اشتراک Knowledge Pack نسخه‌دار جداست. مدل پیش‌فرض بین سازمانی `retrieval_only` با context پالایش‌شده است؛ `export` استثنایی است و `append_candidate` یا `contribute` هرگز promotion خودکار ایجاد نمی‌کند. revoke باید retrievalهای آینده را فوراً متوقف کند و در صورت نیاز به projection، embedding، graph، cache و backup propagate شود. مدل‌های `casio_managed`، `product_managed`، `hybrid` و `customer_managed` باید در contract قابل‌تشخیص باشند؛ MVP با `casio_managed` شروع می‌کند و activation مدل‌های دیگر به evidence deletion و sync وابسته است.

### Integration Gateway

Gateway باید HMAC را روی raw body و پیش از JSON parsing verify کند و timestamp، nonce، key ID، rotation، callback allowlist، idempotency، outbox/dispatcher، retry، timeout و audit را enforce کند. `organizationId`، `workspaceId`، callback URL و privilege داخل payload authority نیستند. هیچ callback یا محصول خارجی حق direct SQL یا mutation canonical ندارد.

### FinOps و attribution

هر usage event باید به organization، External App/Tenant، workspace، Flow/Version، Run، namespace، operation، runtime/model، token/byte/latency، unit cost، allocated shared cost، billable amount و `pricingVersion` متصل باشد. قیمت‌های سناریویی attachmentها implementation یا price list نیستند؛ allocator، markup و cost owner باید versioned و قابل‌بازسازی باشند.

## Definition of Done برای هر تغییر

یک تغییر فقط وقتی وارد branch اصلی می‌شود که این موارد برقرار باشد:

1. جایگاه فایل و package آن در topology روشن است و dependency direction را نقض نمی‌کند.
2. قرارداد typed و authorization boundary مربوط به آن مشخص است.
3. هیچ credential، secret، token، `.env`، dump یا generated output وارد diff نشده است.
4. tenant isolation، audit، idempotency، redaction و terminal immutability در صورت ارتباط، تست یا دلیل مکتوب دارند.
5. `pnpm format:check`، `pnpm check`، `pnpm test`، `pnpm validate:topology` و build مربوطه موفق‌اند.
6. اگر migration یا runtime تغییر کرده است، migration/restart smoke و Golden Flow یا smoke متناسب با آن موفق است.
7. اگر مرز معماری تغییر کرده است، این سند و ADR مربوطه در همان change به‌روزرسانی شده‌اند.

## قانون فازبندی

ترتیب اجرای بعدی باید این dependency را رعایت کند: **foundation و identity → Core lifecycle و isolation → artifact و asynchronous runtime → publication و participant experience → Console/Forge completion → staging و operational hardening → production promotion**. هیچ UI، adapter یا deployment نباید نقص tenant authorization، identity، service identity یا artifact permission را پنهان کند.

Rust، Redis/BullMQ، Object Storage و integrationهای بیرونی فقط زمانی وارد critical path می‌شوند که نیازشان concrete، boundaryشان ثبت‌شده و validation قابل‌تکرارشان موجود باشد. افزودن فناوری به‌تنهایی milestone محسوب نمی‌شود؛ evidence عملیاتی و افزایش اندازه‌پذیر launchability معیار پذیرش است.

## enforcement فنی

این سند همراه با [`CANONICAL_OPERATING_INSTRUCTIONS_FA.md`](CANONICAL_OPERATING_INSTRUCTIONS_FA.md)، `scripts/validate-topology.ts`، package dependency checks، `pnpm-lock.yaml`، CI و review checklist اجرا می‌شود. validator باید دست‌کم directoryهای لازم، rootهای ممنوع، generated paths و dependencyهای forbidden را بررسی کند. هر failure در topology باید مانند failure تست تلقی شود و bypass آن در CI ممنوع باشد.
