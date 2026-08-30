# شناسنامهٔ مرجع UI Casioplus

## مرجع بیرونی

برای بررسی الگوهای نمایش از repository عمومی [Bennettxai/FounderOS-DEMO](https://github.com/Bennettxai/FounderOS-DEMO) در commit `d5e565ea1ee82069e17cd176a33c2f272619e002` استفاده شد. license مرجع MIT و copyright آن `Copyright (c) 2026 FounderOS` است.

این مرجع فقط برای تحلیل معماری اطلاعات، hierarchy، density، graph exploration، workflow map، connection management و state presentation به‌کار می‌رود. کد Next.js، persistence مبتنی بر SQLite، routeهای API، نام‌ها، copy، داده‌ها، assetها و منطق دامنهٔ آن وارد Casioplus نمی‌شوند. هر implementation در این repository مستقل، با Remix و قراردادهای Casioplus نوشته می‌شود.

## الگوهای پذیرفته‌شده برای بازسازی مستقل

| حوزه           | الگوی نمایش                                                   | مقصد Casioplus  |
| -------------- | ------------------------------------------------------------- | --------------- |
| Command center | rail جمع‌شونده، topbar فشرده، metric strip و activity feed    | Console         |
| Flow authoring | workspace چندناحیه‌ای، workflow map، inspector و version rail | Forge           |
| حافظه          | canvas تمام‌صفحه، سوییچ نما، directory و detail inspector     | Console         |
| سازمان         | org tree و کارت وضعیت نقش‌ها                                  | Console         |
| اتصال‌ها       | دسته‌بندی، status chip و connect flow مرحله‌ای                | Console و Forge |
| Economics      | metric card، روند و تفکیک summaryها                           | Console         |
| عملیات         | board، inbox split view و calendar                            | Console         |

## الگوهای ردشده

Casioplus هیچ Next.js App Router، direct database read در UI، seeded metric ساختگی، local API authority، hard-coded connector credential، decorative animation بی‌کارکرد یا copy/branding مرجع را منتقل نمی‌کند. Shared UI فقط presentation-only باقی می‌ماند و همهٔ writeها از Core/API عبور می‌کنند.

## معیار بازبینی

پیاده‌سازی نهایی باید desktop و narrow viewport، حالت‌های loading/empty/error/success، focus و keyboard، reduced motion، عدم clipping و Core-backed data را پوشش دهد. در README نهایی، مرجع MIT و ماهیت inspiration-only ذکر می‌شود.
