# Casioplus — معماری canonical و Source of Truth اجرایی

**وضعیت:** تصمیم معماری مصوب برای implementation و review

**نسخه:** 1.1

**تاریخ مبنا:** 2026-08-27

**محصول:** Casioplus / کاسیو پلاس

**repository canonical:** `hadiranweb/casio-plus-final`

## ۱. تصمیم نهایی در یک نگاه

Casioplus یک محصول واحد است که Console و Forge دو surface آن هستند. Core/API canonical با TypeScript/Node.js و PostgreSQL مسیر critical MVP است. تمام UIهای محصول، شامل Console و Forge، فقط با Remix ساخته می‌شوند؛ UI مستقل Vite/React canonical نیست. استفاده از Vite تنها به‌عنوان compiler رسمی Remix Vite مجاز است و نباید با runtime، routing یا مالکیت UI اشتباه گرفته شود.

| حوزه             | تصمیم قطعی MVP                                                               |
| ---------------- | ---------------------------------------------------------------------------- |
| محصول            | یک محصول واحد با Console و Forge                                             |
| Console          | Remix surface برای control، عملیات، Work/Run، Review، Artifact و Memory view |
| Forge            | Remix surface برای authoring، policy، version، test و publication            |
| Core/API         | TypeScript/Node.js؛ تنها canonical writer و authorization boundary           |
| داده             | PostgreSQL تنها canonical store                                              |
| UI build/runtime | Remix Vite compiler و `remix-serve`؛ خروجی `build/server` و `build/client`   |
| shared code      | contractها، typeها و primitiveهای مشترک در همان monorepo                     |
| Rust             | خارج از critical path MVP؛ فقط Worker تخصصی آینده با evidence اندازه‌پذیر    |
| Runtimeها        | Native Worker، n8n، Open WebUI و OpenClaw پشت contractهای محدود              |

## ۲. سلسله‌مراتب اسناد و حل تعارض

قانون directory و dependency در [`TOPOLOGY_CONSTITUTION_FA.md`](TOPOLOGY_CONSTITUTION_FA.md) الزام‌آور است. دستور تغییر، validation، secret hygiene و release gate در [`CANONICAL_OPERATING_INSTRUCTIONS_FA.md`](CANONICAL_OPERATING_INSTRUCTIONS_FA.md) الزام‌آور است. این سند معماری و قراردادهای سطح محصول را تکمیل می‌کند. برای mapping تجربهٔ command center، route map هدف و مرزبندی اجرایی دو surface، [`BLUEPRINT_RECONCILIATION_FA.md`](BLUEPRINT_RECONCILIATION_FA.md) مرجع تکمیلی است. کد موجود در صورت تعارض خودبه‌خود مرجع نیست؛ تعارض باید به‌عنوان gap ثبت و سپس با implementation، migration و evidence بسته شود یا با ADR مصوب تغییر کند.

## ۳. توپولوژی محصول

```text
کاربر
  ├── console.casioplus.com
  │     └── Console / Remix Control Plane
  └── forge.casioplus.com
        └── Forge / Remix Authoring Surface

Console + Forge
  └── Core/API TypeScript/Node.js
        ├── Authorization و tenant resolution
        ├── Work / Flow / Run / Review lifecycle
        ├── Memory Broker و Knowledge governance
        ├── Integration Gateway
        ├── Artifact metadata و Usage attribution
        └── PostgreSQL canonical store
```

Console و Forge می‌توانند route، navigation و تجربهٔ متفاوت داشته باشند، اما identity، authorization، Flow ownership، Run lifecycle، Memory policy و usage logic را جداگانه پیاده نمی‌کنند. loader/action یا BFF هر surface فقط facade متناسب با همان تجربه است و باید به Core/API canonical متصل بماند.

## ۴. topology دایرکتوری و dependency

```text
apps/
├── console-web/                  # Remix Console
│   └── app/                  # root، routes و entryهای Remix
└── forge-web/               # Remix Forge
    └── app/                  # root، routes و entryهای Remix

services/
├── core-api/                 # canonical writer و authorization boundary
├── native-diagnosis-worker/  # runtime بدون DB access
├── n8n-adapter/              # orchestrator-only
├── open-webui-adapter/       # interaction/model plane
└── openclaw-adapter/         # allowlisted approval-gated action plane

packages/
├── contracts/                # typed transport/event contracts
├── domain/                   # domain types و invariants بدون I/O
├── knowledge-model/          # taxonomy و memory governance
└── ui/                       # presentation primitives مشترک و بدون I/O
```

جهت dependency از UI به contract و از Core به domain/knowledge/PostgreSQL است. UI، Worker و Adapter به database، migration، secret یا runtime internals دسترسی ندارند. `packages/domain` و `packages/knowledge-model` به Express، `pg`، Redis، browser API یا adapter خارجی وابسته نمی‌شوند. `packages/ui` فقط presentation primitive، token و accessibility helper ارائه می‌کند و نباید route، session، tenant policy، Core client یا persistence داشته باشد. packageهای shared مالک identity، authorization یا persistence نیستند.

## ۵. قرارداد قطعی Remix

هر surface باید `app/root.tsx`، `app/routes/`، `app/entry.client.tsx` و `app/entry.server.tsx` داشته باشد. scripts canonical عبارت‌اند از `remix vite:dev`، `remix vite:build` و `remix-serve ./build/server/index.js`. `build/` generated است و وارد Git نمی‌شود.

Vite در این معماری فقط compiler رسمی Remix است؛ وجود `vite.config.ts` به‌تنهایی به معنی UI مبتنی بر Vite نیست. `createRoot` به‌عنوان entrypoint مستقل، `src/main.tsx`، static SPA server، routing خارج از Remix و dependencyهایی مانند plugin مستقل React برای surfaceهای canonical ممنوع‌اند. loader داده را سمت server می‌خواند و action mutation را سمت server انجام می‌دهد؛ هر داده‌ای که به client برگردانده می‌شود باید مانند پاسخ عمومی API حداقل‌سازی و پالایش شود. secret، session خام و دادهٔ tenant خارج از scope هرگز در loader response قرار نمی‌گیرد.

## ۶. مرز Core و سرویس‌های بیرونی

Core/API تنها مالک canonical identity، organization، workspace، membership، Flow، Run، Work، Review، Memory governance، Artifact metadata و usage ledger است. PostgreSQL منبع حقیقت است. Redis/BullMQ، Object Storage، embedding/vector index، graph و سرویس‌های بیرونی projection یا execution boundary هستند و canonical owner نیستند.

Native Worker اولین runtime Golden Flow است و نتیجهٔ typed را از طریق Core/API برمی‌گرداند. n8n فقط orchestrator/integration runtime است. Open WebUI فقط interaction/model plane است. OpenClaw فقط action plane محدود، allowlisted و approval-gated است. هیچ‌کدام direct SQL یا database credential Core ندارند.

## ۷. چندمستاجری و حافظهٔ governed

مسیر resolve اجباری چنین است:

```text
ExternalApp → ExternalTenant → CasioOrganization → Workspace → MemoryNamespace → StoragePolicy
```

شناسه‌های payload خارجی assertion هستند و authority ایجاد نمی‌کنند. هر organization حداقل یک namespace خصوصی default-deny دارد. cross-tenant و cross-namespace access فقط با MemoryGrant محدود به purpose، Flow، kind، scope، sensitivity و validity مجاز است و revoke و audit دارد.

لایه‌های حافظه از هم جدا هستند:

```text
OperationalEvent
  → SemanticRecord
      → KnowledgeClaim
          → KnowledgeReview
              → KnowledgePromotion
                  → OrganizationalMemoryItem
```

Raw event، candidate claim و دانش promoted یکی نیستند. retrieval تنها پس از احراز هویت، tenant/workspace/namespace resolve، grant/purpose/Flow check، sensitivity/validity filter و promotion check انجام می‌شود. Memory Broker تنها access-check و query boundary حافظه است. raw namespace از Knowledge Pack نسخه‌دار و پالایش‌شده جداست.

Storage modeها `casio_managed`، `product_managed`، `hybrid` و `customer_managed` هستند. MVP با `casio_managed` آغاز می‌شود. projection در Hybrid باید source version/hash، projection version، retention، deletion token و invalidation status داشته باشد و deletion/revoke به projection، embedding، graph، cache و backup قابل‌دسترسی propagate شود.

## ۸. Integration Gateway

Integration Gateway تنها مرز ExternalApp با Core است و باید HMAC را روی raw body پیش از parsing، با timestamp، nonce، key ID و rotation بررسی کند. callback مقصد از allowlist server-side می‌آید؛ callback URL، privilege، organization، workspace، flow version و grant موجود در body فقط assertion هستند. Gateway باید idempotency، replay persistence، redaction، audit، timeout، retry/backoff، outbox/dispatcher و dead-letter visibility داشته باشد. direct SQL و mutation مستقیم محصول خارجی ممنوع است.

## ۹. economics و FinOps

مدل اقتصادی سه لایه دارد: `Platform subscription`، `Memory entitlement` و `Usage metering`. فرد، تیم و سازمان از control plane مشترک استفاده می‌کنند؛ تفاوت اقتصادی باید از seat، workspace، ظرفیت، governance، SLA، پشتیبانی و مصرف قابل‌ردیابی باشد، نه صرفاً label پرسونا.

هر usage/cost باید immutable و به organization، ExternalApp/Tenant، workspace، Flow/Version/Run، namespace، operation، runtime/model، token/byte/latency، unit cost، allocated shared cost، billable amount، payer و `pricingVersion` متصل باشد. P&L کاسیو از TCO کل ecosystem جدا گزارش می‌شود. اعداد attachmentهای اقتصادی planning assumptions versioned هستند، نه price list، quote، forecast قطعی یا تعهد margin.

## ۱۰. سطح‌های محصول

| سطح                 | مسئولیت                                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Console             | account، organization، workspace، access، Flow catalog/publication، Work/Run history، Review، Artifact و Memory view |
| Forge               | Flow authoring، input/output/policy، version، test، publish، runtime binding و memory binding                        |
| Core/API            | authorization، mapping، lifecycle، audit، artifact metadata، memory governance و usage attribution                   |
| Integration Gateway | inbound/outbound contract، mapping، HMAC، callback و idempotency                                                     |

Forge credential خام یا runtime internals را نمایش نمی‌دهد. Console نیز نباید prompt خصوصی، graph داخلی runtime یا policy enforcement را مالک شود.

## ۱۱. فازبندی و launchability

ترتیب فازهای implementation باید چنین باشد: foundation و identity، Core lifecycle و isolation، Artifact و async runtime، publication و participant experience، تکمیل Console/Forge، staging و operational hardening، سپس production promotion. هر فاز باید evidence قابل‌تکرار، test مرزی و rollback story داشته باشد.

MVP زمانی قابل‌راه‌اندازی تلقی می‌شود که TypeScript/Node.js Core، PostgreSQL، دو Remix surface، Native Worker، Golden Flow، tenant isolation، identity واقعی، artifact delivery، migration/restart smoke و staging evidence همگی قابل‌اثبات باشند. تا پیش از آن، عبارت دقیق «architecture contract» یا «vertical slice» است و نه «production-ready».

## منابع فنی Remix

برای جزئیات compiler، adapter، loader و action به [`REMIX_ARCHITECTURE_REFERENCE_FA.md`](REMIX_ARCHITECTURE_REFERENCE_FA.md) مراجعه شود. منابع رسمی مورد استفاده نیز در همان سند با لینک‌های مستقیم ثبت شده‌اند.
