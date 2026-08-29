# Casioplus n8n adapter

این package فقط قرارداد اتصال Casioplus به n8n را نگه می‌دارد. n8n در این معماری **orchestrator** است: می‌تواند Webhook production/test را trigger کند، درخواست HTTP typed را به Core بفرستد و پاسخ را به مسیر publication برگرداند؛ اما owner وضعیت canonical، credentialهای PostgreSQL یا lifecycle حافظه نیست.

طبق مستندات رسمی n8n، Webhook node یک trigger است که می‌تواند workflow را با رویداد بیرونی شروع کند و برای هر node آدرس test و production جداگانه دارد. production webhook پس از publish فعال می‌شود و node روش‌های Basic، Header و JWT authentication را پشتیبانی می‌کند.[1] بنابراین adapter در Casioplus وجود authentication و allowlist origin را اجباری می‌کند و URL تست را از URL production جدا نگه می‌دارد.

برای فراخوانی Core، n8n از HTTP Request node استفاده می‌کند. این node روش‌های استاندارد HTTP، header/body JSON و credentialهای predefined یا generic را پشتیبانی می‌کند.[2] adapter فقط marker غیرحساس `x-casioplus-runtime: n8n` را اضافه می‌کند؛ secret واقعی باید در credential store امن n8n یا secret manager deployment نگهداری شود و هر write مهم همچنان از authorization، idempotency و policy Core عبور می‌کند.

## وضعیت MVP

قرارداد و validation در `src/index.ts` و تست آن در `src/index.test.ts` قرار دارد. اتصال شبکهٔ production، مدیریت credential و mapping کامل eventها بعد از تثبیت staging Core و publication contract انجام می‌شود؛ این package عمداً n8n را به persistence مستقیم متصل نمی‌کند.

## References

[1]: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook 'n8n Webhook node documentation'
[2]: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.httprequest 'n8n HTTP Request node documentation'
