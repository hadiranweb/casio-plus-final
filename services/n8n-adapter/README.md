# Casioplus n8n Adapter

این سرویس مرز HTTP احرازشده میان **Integration Dispatcher** و runtime مستقل n8n است. n8n فقط orchestrator است؛ هیچ credential مربوط به PostgreSQL canonical دریافت نمی‌کند و هیچ write مستقیمی روی state محصول انجام نمی‌دهد.

## قرارداد اجرا

Dispatcher فقط `POST /dispatch` را با `ADAPTER_SHARED_SECRET` فراخوانی می‌کند. adapter، organization و Workspace و operation resolveشده توسط Core را validate می‌کند، envelope نسخه‌دار `casioplus.n8n.dispatch.v1` می‌سازد و آن را با credential مستقل `N8N_WEBHOOK_TOKEN` به webhook خصوصی n8n می‌فرستد. نتیجه باید دقیقاً یکی از وضعیت‌های `succeeded` یا `failed` را با output محدود برگرداند؛ سپس Dispatcher آن را به Core می‌دهد تا ProcessRun، RuntimeEvent و WorkItem به‌صورت transactional به‌روزرسانی شوند.

| مرز      | مجاز                                                       | ممنوع                                                      |
| -------- | ---------------------------------------------------------- | ---------------------------------------------------------- |
| Adapter  | validation، timeout، forwarding، response parsing          | SQL، business authorization، canonical state               |
| n8n      | orchestration، transform، call به APIهای allowlisted       | PostgreSQL canonical، tenant resolution، pricing authority |
| Core/API | authorization، lifecycle، audit، outbox، usage attribution | واگذاری canonical write به n8n                             |

Webhook node در n8n می‌تواند workflow را از ورودی HTTP شروع کند و Header authentication و production URL مستقل داشته باشد.[1] JSON موجود در repository عمداً credential ID ندارد تا selector جعلی یا secret وارد source نشود؛ credential واقعی در deployment bind می‌شود.

## workflow canonical

فایل `runtime/n8n/workflows/casioplus-runtime-execution.json` در repository غیرفعال نگه داشته می‌شود. فعال‌سازی فقط پس از validation، import به نسخهٔ pinشده، binding credential واقعی Header Auth، بازبینی connection graph، safe test و بررسی execution result مجاز است. workflow از Code nodeهای `Run Once for All Items` استفاده می‌کند و هیچ database node یا URL و secret hard-coded ندارد.

## environment

| متغیر                    | مصرف‌کننده                           | توضیح                                     |
| ------------------------ | ------------------------------------ | ----------------------------------------- |
| `ADAPTER_SHARED_SECRET`  | Dispatcher و adapter                 | secret مستقل شبکهٔ داخلی، حداقل ۳۲ نویسه  |
| `N8N_WEBHOOK_URL`        | adapter                              | production webhook داخلی n8n              |
| `N8N_WEBHOOK_TOKEN`      | adapter و Header Auth credential n8n | token اختصاصی webhook؛ در Git ثبت نمی‌شود |
| `N8N_WEBHOOK_TIMEOUT_MS` | adapter                              | deadline درخواست synchronous              |

endpoint سلامت `GET /healthz` هیچ تنظیم یا secretی را نمایش نمی‌دهد. اجرای runtime محلی و staging در `runtime/n8n/docker-compose.yml` از n8n نسخهٔ pinشده و datastore داخلی جدا استفاده می‌کند؛ این datastore canonical نیست و به schema محصول دسترسی ندارد.

## validation

`pnpm validate:n8n` تطبیق manifest، UUID v4 nodeها، authentication، connection graph، allowlist node type، نبود credential placeholder، نبود database node و نبود URL یا Bearer token hard-coded را enforce می‌کند. `pnpm test` نیز adapter و lifecycle کامل ProcessRun → outbox → n8n result را پوشش می‌دهد.

## References

[1]: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook 'n8n Webhook node documentation'
