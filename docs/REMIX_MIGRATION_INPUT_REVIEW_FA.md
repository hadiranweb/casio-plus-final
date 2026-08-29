# ممیزی ورودی‌های migration Remix در Casioplus

**وضعیت:** نتیجهٔ ممیزی و ادغام در source of truth

**تاریخ:** 2026-08-27

## جمع‌بندی

سه پیوست از یک تصمیم معماری منسجم پشتیبانی می‌کنند: App و Studio دو surface یک محصول‌اند، هر دو فقط با Remix ساخته می‌شوند، Core/API با TypeScript/Node.js و PostgreSQL canonical باقی می‌ماند، و Vite فقط compiler/dev bundler داخلی Remix است. این تصمیم با [`CASIOPLUS_CANONICAL_ARCHITECTURE_FA.md`](CASIOPLUS_CANONICAL_ARCHITECTURE_FA.md)، [`TOPOLOGY_CONSTITUTION_FA.md`](TOPOLOGY_CONSTITUTION_FA.md) و [`CANONICAL_OPERATING_INSTRUCTIONS_FA.md`](CANONICAL_OPERATING_INSTRUCTIONS_FA.md) هم‌راستا است.

با این حال، log و patch به‌تنهایی production evidence نیستند. log یک اجرای موفق validation را نشان می‌دهد، اما warning مربوط به build scriptهای نادیده‌گرفته‌شده دارد و Docker build، browser SSR smoke و identity staging را اثبات نمی‌کند. patch یک implementation proposal است؛ فقط بخش‌هایی که با repository فعلی، NodeNext typecheck، pnpm 10 و topology validator سازگار بودند ادغام شدند.

## تطبیق تصمیم‌ها

| موضوع             | نتیجهٔ ممیزی                                         | وضعیت در repository                                                         |
| ----------------- | ---------------------------------------------------- | --------------------------------------------------------------------------- |
| UI framework      | App و Studio فقط Remix                               | پذیرفته و enforce‌شده با package scripts، route layout و topology validator |
| نقش Vite          | فقط compiler رسمی Remix                              | پذیرفته؛ plugin مستقل React و routing مستقل مجاز نیست                       |
| Core/API          | TypeScript/Node.js با PostgreSQL canonical           | بدون تغییر باقی ماند                                                        |
| surface boundary  | دو Remix app در یک monorepo                          | پذیرفته؛ App و Studio dependency و route boundary مستقل دارند               |
| configuration     | `CASIOPLUS_CORE_API_URL` از server loader به browser | پذیرفته؛ secretها به loader، HTML، bundle یا log راه پیدا نمی‌کنند          |
| runtime           | `remix-serve` با `build/server` و `build/client`     | پذیرفته و در Dockerfileها ثبت شد                                            |
| generated output  | عدم commit `build/`، `dist/` و `node_modules/`       | validator و Git policy آن را enforce می‌کنند                                |
| security boundary | mutation canonical فقط از Core/API                   | پذیرفته؛ loader/action facade مجاز به writer موازی نیست                     |

## اختلاف‌های فنی و adaptationهای لازم

patch پیوست برای production runtime از مسیرهای workspace و CLI عمیق استفاده می‌کند. در validation واقعی pnpm 10، اجرای `pnpm --filter ... deploy --prod` بدون flag اضافه با خطای non-injected workspace متوقف شد. بنابراین Dockerfileهای Casioplus به‌طور صریح از `pnpm --filter ... deploy --prod --legacy` استفاده می‌کنند و runtime را از `/out` مستقل می‌سازند؛ سپس `remix-serve ./build/server/index.js` را از همان production bundle اجرا می‌کنند. این adaptation بر اساس رفتار واقعی ابزار و قابل‌بازسازی است، نه سلیقهٔ اسمی.

برای عبور root typecheck با `moduleResolution: NodeNext`، import type بین route و root با پسوند `.js` ثبت شده و declarationهای `vite/client` در `app/vite-env.d.ts` قرار گرفته‌اند. این جزئیات implementation-specific هستند و اصل معماری را تغییر نمی‌دهند.

علاوه بر patch، topology validator در repository اکنون وجود routeهای Remix، dependencyهای لازم، scriptهای Remix، نبود dependencyهای مستقل و نبود مسیرهای `src/` و `index.html` را بررسی می‌کند. Dockerfileهای App و Studio نیز باید `remix-serve` و `build/server/index.js` داشته باشند و نباید static server یا `/dist` را در runtime contract خود وارد کنند.

## ممیزی log

log پیوست موارد زیر را گزارش می‌کند: install موفق با pnpm 10.18.0، formatting موفق، typecheck موفق، هفت فایل و ۲۷ تست موفق، topology موفق و build موفق Core، Worker، App و Studio. بخش build هر دو surface از `remix vite:build` و تولید هم‌زمان client/server خبر می‌دهد.

با وجود این، log یک warning دربارهٔ ignored build scripts مربوط به esbuild دارد. این warning در صورت تکرار باید در CI با policy dependency بررسی شود و نباید بدون تصمیم تیمی با `|| true` پوشانده شود. همچنین مسیر گزارش‌شده در log یک working copy است و به‌تنهایی نمی‌تواند SHA یا وضعیت فعلی repository canonical را اثبات کند. برای همین، validation همان commit در repository فعلی باید دوباره اجرا شود.

## تصمیم ادغام

| ورودی             | تصمیم                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| راهنمای migration | به‌عنوان راهنمای اجرایی پذیرفته و در ADR، topology و canonical instructions منعکس شد                         |
| patch             | به‌عنوان design input پذیرفته؛ فقط adaptationهای سازگار با NodeNext، pnpm 10 و production isolation ادغام شد |
| log               | به‌عنوان evidence تاریخی/کمکی پذیرفته؛ منبع انحصاری release claim نیست و با اجرای مستقل تکمیل می‌شود         |

## Definition of Done تکمیل migration

migration UI زمانی کامل است که هر دو surface با SSR build شوند، HTML با `lang=fa` و `dir=rtl` و title درست تولید کنند، public Core URL بدون secret از loader به client برسد، Core API تنها mutation boundary باقی بماند، topology validator سبز باشد، production dependency deploy برای هر دو surface موفق شود، و Docker build در CI یا محیط دارای Docker daemon موفق شود. browser smoke با build server، identity امن، artifact delivery و staging evidence همچنان gateهای بعدی‌اند.

این سند به‌عنوان review record در کنار ADR و Source of Truth معماری نگهداری می‌شود و هیچ ادعای production readiness را جایگزین شواهد staging نمی‌کند.
