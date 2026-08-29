# ساختار عملیاتی repository و baseline کد Remix در Casioplus

**وضعیت:** قرارداد اجرایی ساختار repository و کد پایهٔ MVP

**محصول:** Casioplus / کاسیو پلاس

**repository:** `hadiranweb/casio-plus`

## ۱. اصل ساختاری

Casioplus یک monorepo با یک Core/API canonical و دو Remix surface است. App و Studio دو application مستقل از نظر route، hostname، permission و deployment unit هستند، اما یک محصول واحد را ارائه می‌کنند. PostgreSQL تنها canonical store است و هیچ surface، Worker یا adapter نباید writer یا persistence موازی بسازد.

```text
casioplus/
├── apps/
│   ├── app-web/                         # App / Remix control surface
│   │   ├── app/
│   │   │   ├── root.tsx                 # document shell، root loader و links/meta
│   │   │   ├── entry.client.tsx         # Remix hydration
│   │   │   ├── entry.server.tsx         # Node SSR
│   │   │   ├── routes/
│   │   │   │   └── _index.tsx           # route composition و App experience
│   │   │   └── styles.css               # surface-specific presentation
│   │   ├── package.json
│   │   ├── remix.env.d.ts               # Remix/Vite type declarations
│   │   ├── tsconfig.json
│   │   └── vite.config.ts               # فقط Remix Vite compiler
│   └── studio-web/                      # Studio / Remix authoring surface
│       ├── app/
│       │   ├── root.tsx
│       │   ├── entry.client.tsx
│       │   ├── entry.server.tsx
│       │   ├── routes/
│       │   │   └── _index.tsx
│       │   └── styles.css
│       ├── package.json
│       ├── remix.env.d.ts
│       ├── tsconfig.json
│       └── vite.config.ts
├── services/
│   ├── core-api/                        # TypeScript/Node.js canonical API
│   ├── native-diagnosis-worker/         # runtime بدون DB access
│   ├── n8n-adapter/                     # orchestrator-only boundary
│   ├── open-webui-adapter/              # interaction/model boundary
│   └── openclaw-adapter/                # allowlisted approval-gated actions
├── packages/
│   ├── contracts/                       # Zod schemas و transport contracts
│   ├── domain/                          # typeها و invariantهای pure domain
│   ├── knowledge-model/                 # taxonomy و memory governance types
│   └── ui/                              # presentation primitives مشترک
├── migrations/                          # ordered PostgreSQL migrations
├── deployment/                          # Dockerfile و release manifest هر unit
├── scripts/                             # topology، smoke و ابزار validation
├── docs/                                # Charter، ADR، topology و runbookها
└── .github/workflows/                   # CI/CD بدون credential در source
```

هر directory جدید باید مسئولیت مشخص، dependency direction روشن و در صورت اثر معماری یک ADR داشته باشد. انتقال componentهای بزرگ route به `app/components/`، منطق API به `app/services/` و schemaهای surface به `app/schemas/` پس از تثبیت contract مجاز است؛ این extraction نباید Core ownership یا authorization را به UI منتقل کند.

## ۲. قانون dependency

جهت dependency از surface به shared contract و از Core به domain/knowledge است. App و Studio می‌توانند به `@casioplus/contracts` و `@casioplus/ui` وابسته باشند؛ آن‌ها نباید به `pg`، migration، Worker internals، adapter implementation یا secret وابستگی داشته باشند. Core می‌تواند `@casioplus/contracts`، `@casioplus/domain` و `@casioplus/knowledge-model` را مصرف کند. Worker و adapterها فقط contractهای لازم را می‌گیرند و direct database access ندارند.

```text
App Remix ───────┐
                 ├──> @casioplus/contracts ───> Zod transport schemas
                 └──> @casioplus/ui ──────────> presentation primitives
Studio Remix ────┘

Core/API ────────> contracts + domain + knowledge-model + PostgreSQL
Worker/Adapters ─> contracts فقط؛ بدون PostgreSQL credential
```

`@casioplus/ui` باید presentation primitive، token و accessibility helper باشد؛ نباید route، session، tenant policy، Core client یا persistence را در خود جای دهد. contractهای transport نیز باید browser-safe و transport-neutral بمانند و secret را schema نکنند.

## ۳. baseline کد Remix

هر surface چهار نقطهٔ پایه دارد. `root.tsx` document shell، metadata، direction، stylesheet و root loader را فراهم می‌کند. `entry.server.tsx` SSR را روی Node اجرا می‌کند. `entry.client.tsx` فقط hydration را انجام می‌دهد. `routes/` محل composition تجربهٔ سطح است و route نباید با `createRoot` یا router مستقل bootstrap شود.

نمونهٔ root loader باید فقط public runtime configuration را از environment server بخواند و با shared contract validate کند:

```tsx
import { publicRuntimeConfigSchema } from '@casioplus/contracts';
import { json, type LoaderFunctionArgs } from '@remix-run/node';

export async function loader(_args: LoaderFunctionArgs) {
  return json(
    publicRuntimeConfigSchema.parse({
      coreApiUrl: process.env.CASIOPLUS_CORE_API_URL ?? 'http://localhost:8080',
      appUrl: process.env.CASIOPLUS_APP_URL ?? 'http://localhost:5173',
      studioUrl: process.env.CASIOPLUS_STUDIO_URL ?? 'http://localhost:5174',
    }),
  );
}
```

`DATABASE_URL`، `SESSION_SECRET` و `RUNTIME_SHARED_SECRET` هرگز نباید در loader response، HTML، browser bundle یا log قرار بگیرند. در baseline توسعه، route می‌تواند public Core URL و URL surface مقابل را از `useRouteLoaderData('root')` دریافت کند؛ session ذخیره‌شده در localStorage فقط foundation توسعه است و برای public identity کافی نیست. `CASIOPLUS_APP_URL` و `CASIOPLUS_STUDIO_URL` فقط public navigation configuration هستند و نباید برای انتقال credential یا tenant authority استفاده شوند.

نمونهٔ route composition باید منطق canonical را به Core/API بسپارد:

```tsx
import { useRouteLoaderData } from '@remix-run/react';
import type { loader as rootLoader } from '../root.js';

export default function SurfaceRoute() {
  const runtime = useRouteLoaderData<typeof rootLoader>('root');
  const coreApiUrl = runtime?.coreApiUrl ?? 'http://localhost:8080';
  return <main data-core-api={coreApiUrl}>...</main>;
}
```

در milestone بعد، mutationها باید به actionهای server-side یا service moduleهای محدود منتقل شوند تا cookie/session امن و CSRF policy قابل‌اعمال باشد. حتی در آن حالت نیز action فقط facade است و mutation canonical از Core/API عبور می‌کند.

## ۴. قرارداد package و build

هر surface باید scripts زیر را داشته باشد:

```json
{
  "dev": "remix vite:dev --host",
  "build": "remix vite:build",
  "start": "remix-serve ./build/server/index.js",
  "check": "tsc --noEmit"
}
```

در Docker، production dependency package با `pnpm --filter ... deploy --prod --legacy` ساخته می‌شود؛ `build/server` و `build/client` از stage ساخت به runtime منتقل می‌شوند و `remix-serve` روی پورت قراردادی اجرا می‌شود. `--legacy` در pnpm 10 یک adaptation صریح برای workspace غیر-injected است و حذف آن فقط پس از migration رسمی به injected workspace packages و validation کامل مجاز است.

## ۵. مرز مسئولیت surfaceها

| سطح             | مسئولیت مجاز                                                                                                 | مسئولیت ممنوع                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| App             | account، organization، workspace، Work/Run، publication، Review، Artifact و Memory view                      | direct DB، secret، prompt خصوصی، runtime internals و policy موازی            |
| Studio          | Flow authoring، input/output، policy، version، test، publish و runtime binding                               | clone رابط ابزار خارجی، credential خام، direct runtime access و writer موازی |
| Core/API        | authorization، tenant resolution، lifecycle، audit، artifact metadata، memory governance و usage attribution | پذیرش assertion خارجی، direct trust به client و bypass کردن tenant policy    |
| Shared packages | schema، type، primitive و invariant قابل‌استفاده                                                             | session issuance، DB client، route ownership و secret                        |

## ۶. validation و Definition of Done

هر تغییر ساختاری یا UI باید از این gateها عبور کند:

```text
pnpm format:check
pnpm check
pnpm test
pnpm validate:topology
pnpm build
pnpm smoke:remix
```

در تغییر Dockerfile یا package dependency، production dependency deploy و Docker build همان surface نیز لازم است. `pnpm validate:topology` باید وجود routeهای پایهٔ Remix، declaration، scriptها، dependency direction، نبود مسیرهای SPA مستقل، نبود generated output در Git و وجود contract `remix-serve` را تأیید کند. CI همین smoke و Docker build را بدون push image اجرا می‌کند.

## ۷. منابع مرجع

[1]: ./CASIOPLUS_CANONICAL_ARCHITECTURE_FA.md 'معماری canonical Casioplus'
[2]: ./TOPOLOGY_CONSTITUTION_FA.md 'قانون topology و dependency'
[3]: ./CANONICAL_OPERATING_INSTRUCTIONS_FA.md 'دستورالعمل اجرایی و release gates'
[4]: ./REMIX_ARCHITECTURE_REFERENCE_FA.md 'منابع رسمی Remix و قرارداد SSR/deployment'
[5]: ./REMIX_MIGRATION_INPUT_REVIEW_FA.md 'ممیزی guide، patch و log migration'
