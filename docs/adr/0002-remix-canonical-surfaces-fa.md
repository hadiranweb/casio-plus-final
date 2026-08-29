# ADR-0002 — Remix به‌عنوان UI canonical برای App و Studio

**وضعیت:** پذیرفته‌شده و الزام‌آور برای MVP

**تاریخ:** 2026-08-27

## زمینه

Casioplus یک محصول واحد با دو surface است: App برای control و عملیات، و Studio برای authoring و governance. هر دو باید به Core/API مشترک متصل بمانند و نباید منطق canonical identity، authorization، tenant، lifecycle، memory یا usage را جداگانه مالک شوند.

## تصمیم

تمام UIهای Casioplus، شامل App و Studio، فقط با Remix ساخته می‌شوند. Core/API با TypeScript/Node.js و PostgreSQL مسیر critical MVP باقی می‌ماند. Vite فقط compiler رسمی Remix Vite است؛ standalone Vite/React، static SPA server، `createRoot` مستقل، routing خارج از Remix و server entry مستقل از Remix برای UI canonical مجاز نیست.

هر surface از `app/root.tsx`، `app/routes/`، `app/entry.client.tsx` و `app/entry.server.tsx` استفاده می‌کند. build با `remix vite:build`، توسعه با `remix vite:dev` و production server با `remix-serve ./build/server/index.js` انجام می‌شود. خروجی `build/server` و `build/client` generated است و در Git commit نمی‌شود.

## پیامدها

loader/action و BFF هر surface فقط facade برای Core/API هستند و نمی‌توانند writer یا policy موازی بسازند. environment عمومی مانند Core API URL از root loader با حداقل داده به client می‌رسد؛ secret، session خام، tenant assertion و دادهٔ خارج از scope نباید به browser برگردد. Dockerfile هر surface باید production dependencyهای مستقل را با pnpm deploy آماده و Remix server را اجرا کند.

این تصمیم استفاده از Vite را حذف نمی‌کند؛ استفادهٔ آن به compiler رسمی Remix Vite محدود می‌شود. distinction بین compiler و UI framework در validator، package scripts، Dockerfile، CI و review checklist enforce می‌شود.

## migration evidence

فایل‌های UI به routeهای `apps/app-web/app/routes/_index.tsx` و `apps/studio-web/app/routes/_index.tsx` منتقل شدند. root، client entry، server entry، CSS import، NodeNext type declarations، package scripts، production Dockerfile و release manifest به قرارداد Remix تغییر کردند. اجرای `pnpm --filter @casioplus/app-web deploy --prod --legacy` و معادل Studio با موفقیت production package و `remix-serve` entry را تولید کرد.

## validation و rollback

validation لازم برای این ADR شامل `pnpm format:check`، `pnpm check`، test suite، `pnpm validate:topology`، build هر دو surface و Docker build مربوط است. rollback این تصمیم فقط با ADR جدید، migration plan و evidence جایگزین مجاز است؛ بازگرداندن surface به static SPA بدون تغییر رسمی source of truth مجاز نیست.
