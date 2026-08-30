# Specification اجرایی UI کاسیو پلاس

## thesis مشترک

Console و Forge باید مانند **ابزار عملیاتی دقیق** دیده شوند، نه landing page و نه مجموعه‌ای از کارت‌های تزئینی. hierarchy از وضعیت واقعی، scope سازمانی، صف کار، lifecycle و تصمیم‌های قابل‌اقدام ساخته می‌شود. دادهٔ ساختگی، greeting شخصی hard-coded، orbit تزئینی، gradient بدون نقش و metric بدون منبع حذف می‌شوند.

| token   |     مقدار | نقش                                  |
| ------- | --------: | ------------------------------------ |
| Canvas  | `#f4f5f0` | زمینهٔ خنثی و کم‌خستگی               |
| Ink     | `#111814` | متن و rail اصلی                      |
| Surface | `#ffffff` | سطح داده و فرم                       |
| Line    | `#d9ded8` | تفکیک ساختاری                        |
| Accent  | `#55e69b` | فقط active، success و primary action |
| Warning | `#df9e31` | نیازمند بررسی                        |
| Failure | `#d9544d` | خطا یا blocked                       |

Typography از system stack با اعداد tabular استفاده می‌کند. spacing بر پایهٔ ۴px، radius محدود ۶ تا ۱۲px و shadow فقط برای overlay یا لایهٔ واقعاً شناور مجاز است. animation فقط برای تغییر state و ورود panel است و `prefers-reduced-motion` را رعایت می‌کند.

## Console

**هدف:** پاسخ سریع به سه پرسش: اکنون چه چیزی در حال رخ‌دادن است، چه چیزی نیازمند تصمیم است، و اثر آن بر حافظه و اقتصاد چیست؟

Layout شامل rail جمع‌شونده، topbar فشرده با scope واقعی، command launcher، signal strip و workspace دو ستونه است. اولویت content به‌ترتیب queue تصمیم‌ها، run timeline، حافظهٔ governed و economics است. metrics فقط از Core بارگذاری می‌شوند و در نبود داده empty state صریح دارند.

Auth با cookie session و CSRF انجام می‌شود. token دستی یا localStorage در UI وجود ندارد. حالت anonymous یک auth gateway کوچک و production-grade برای login و registration نشان می‌دهد. حالت authenticated نام کاربر، نقش، Organization و Workspace واقعی را از `/api/v1/auth/session` و `/api/v1/organizations` می‌گیرد.

## Forge

**هدف:** ساخت، versioning، test و publication یک Flow با نمایش روشن مرز runtime و approval.

Layout شامل rail Flowها، canvas/definition workspace، inspector قرارداد و timeline نسخه‌ها است. workflow map صرفاً بازنمایی definition واقعی است؛ node یا وضعیت جعلی نمایش داده نمی‌شود. runtime bindingها از قرارداد canonical استفاده می‌کنند و برای n8n، Open WebUI و OpenClaw readiness واقعی adapter را نشان می‌دهند.

Forge نیز از cookie session و CSRF استفاده می‌کند. navigation به Console از `consoleUrl` loader می‌آید. publication، version creation و writeهای دیگر CSRF header دارند و هیچ credential runtime در browser bundle نمایش داده نمی‌شود.

## state contract

| state   | رفتار الزام‌آور                                          |
| ------- | -------------------------------------------------------- |
| Loading | skeleton با ابعاد ثابت؛ بدون layout shift                |
| Empty   | توضیح علت و یک اقدام معتبر، بدون دادهٔ نمونه             |
| Error   | code قابل‌خواندن، retry و حفظ input                      |
| Success | feedback محدود و مرتبط با اقدام                          |
| Offline | تفکیک Core unavailable از anonymous                      |
| Narrow  | rail به drawer، inspector زیر canvas و target حداقل ۴۴px |

## performance و accessibility

گراف‌ها و visualizationهای سنگین lazy-load می‌شوند. initial route نباید graph engine، dataset بزرگ یا component پنهان را eager-load کند. focus visible، label صریح، keyboard navigation، landmarkها، contrast و reduced motion الزامی‌اند. بررسی نهایی در viewportهای desktop و `390 × 844` انجام می‌شود.
