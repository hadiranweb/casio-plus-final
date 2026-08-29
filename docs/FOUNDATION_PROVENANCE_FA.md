# شناسنامهٔ Foundation ریپوی Casioplus

## تصمیم

این repository با نام `casio-plus-final` منبع canonical جدید Casioplus است. foundation اولیه به‌صورت snapshot از commit `cd36acb1ca5e7e156a9de412c615b6734f4fa5b5` در source canonical قبلی منتقل شده است. تاریخچهٔ Git، branchها، tagها، dependency install، build output و secretهای منابع قبلی وارد این repository نشده‌اند.

## Evidence انتقال

| شاخص                | مقدار                                                 |
| ------------------- | ----------------------------------------------------- |
| نوع انتقال          | snapshot بدون تاریخچه                                 |
| commit مبدا         | `cd36acb1ca5e7e156a9de412c615b6734f4fa5b5`            |
| نخستین commit مقصد  | `38ba32a5d8a0d7ac48301a44be9cf41f97092edb`            |
| تعداد source backup | ۷ bundle کامل                                         |
| وضعیت bundleها      | `git bundle verify` و `git fsck --full --strict` موفق |
| نگهداری backup      | خارج از تاریخچهٔ محصول                                |

## Naming و topology

surfaceهای canonical محصول **Console** و **Forge** هستند. Core/API با TypeScript/Node.js تنها canonical writer و PostgreSQL تنها canonical store است. Workerها، adapterها، n8n، Open WebUI و OpenClaw هیچ دسترسی مستقیم به PostgreSQL canonical ندارند.

## سیاست donor

قابلیت‌های مفید منابع قبلی فقط از راه یکی از این تصمیم‌ها وارد می‌شوند: انتقال با adaptation، بازپیاده‌سازی بر اساس رفتار، یا تبدیل به test scenario. merge، fork، subtree، submodule و cherry-pick تاریخچهٔ قدیمی ممنوع است. هر انتقال باید با contract، authorization، audit، tenant isolation و validation مقصد سازگار باشد.
