# Casioplus OpenClaw adapter

OpenClaw در Casioplus فقط **action plane** محدود است و owner هیچ‌کدام از Work، Run، Artifact یا Memory نیست. هر action باید در allowlist باشد، به approval معتبر وصل شود، زمان انقضا و idempotency key داشته باشد و نتیجهٔ آن از Core/API و audit عبور کند.

قرارداد `src/index.ts` فقط سه action MVP را می‌پذیرد: `send_message`، `create_ticket` و `post_webhook`. actionهایی مانند shell execution، تغییر credential یا دسترسی مستقیم به PostgreSQL عمداً خارج از schema هستند. secret امضای action باید در secret manager بماند و هرگز به App، Studio یا مدل نمایش داده نشود.

## وضعیت MVP

validation و HMAC header در adapter آماده و در `src/index.test.ts` پوشش داده شده است. اتصال شبکهٔ واقعی OpenClaw تا زمان تثبیت approval persistence، replay protection و staging private network deferred است؛ این package به‌تنهایی side effect خارجی اجرا نمی‌کند.
