# مرجع معماری Remix در Casioplus

**وضعیت:** مرجع فنی برای تصمیم قطعی Remix-only در Console و Forge

## تصمیم اجرایی

Console و Forge در Casioplus باید Remix applicationهای TypeScript باشند. استفاده از Vite فقط در نقش compiler رسمی Remix Vite مجاز است؛ Vite/React standalone، static SPA server، `createRoot` به‌عنوان entrypoint مستقل و routing خارج از Remix مجاز نیست.

هر surface باید `app/root.tsx`، `app/routes/`، `app/entry.client.tsx` و `app/entry.server.tsx` داشته باشد. build باید با `remix vite:build` و production server با `remix-serve ./build/server/index.js` انجام شود. `build/client` و `build/server` generated output هستند و نباید در Git commit شوند.

`loader` و `action` در Remix مرز server-side route data هستند. loader برای خواندن دادهٔ route و action برای mutation استفاده می‌شود؛ هر داده‌ای که loader برگرداند به client exposure دارد و باید با همان دقت یک API عمومی پالایش شود. در Casioplus، loader/action یا BFF surface فقط باید از Core/API canonical عبور کند و نباید ownership، authorization، tenant policy یا write path جداگانه بسازد.

## نکتهٔ deployment

Dockerfile هر surface باید production dependencyهای همان package را با workspace deployment رسمی pnpm 10 آماده کند، build Remix را در stage ساخت اجرا نماید، `build/server` و `build/client` را به runtime منتقل کند و `remix-serve` را روی پورت قراردادی اجرا نماید. این monorepo از injected workspace packages استفاده می‌کند و image build هر دو surface در CI اجباری است. Console و Forge همچنان دو surface یک محصول‌اند و environment binding عمومی Core باید از loader/root به client برسد؛ secret server-side نباید در loader response یا browser bundle قرار گیرد. provider، ingress، DNS و TLS در مرحلهٔ deployment انتخاب می‌شوند و نباید داخل معماری Remix hard-code شوند.

## منابع رسمی

[1]: https://remix.run/docs/future/vite 'Remix Vite documentation'
[2]: https://v2.remix.run/docs/other-api/adapter/ 'Remix Server Adapters'
[3]: https://remix.run/docs/en/main/route/action 'Remix action documentation'
[4]: https://v2.remix.run/docs/route/loader/ 'Remix loader documentation'

مستندات رسمی توضیح می‌دهند که Remix Vite compiler از طریق plugin Remix پیکربندی می‌شود و build پیش‌فرض server/client را در `build/server` و `build/client` قرار می‌دهد [1]. مستندات adapter نیز نشان می‌دهند که Remix برای Node از adapterهایی مانند `@remix-run/express` یا built-in server استفاده می‌کند و handler سرور مرز اجرای application است [2]. طبق مستندات route، `action` تابع server-only برای mutationهای non-GET است [3] و `loader` روی server اجرا می‌شود، اما خروجی آن به client ارسال می‌شود و نباید دادهٔ بیش‌ازحد یا secret برگرداند [4].
