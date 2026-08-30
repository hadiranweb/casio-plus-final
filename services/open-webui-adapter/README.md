# Casioplus Open WebUI Adapter

این سرویس، تنها مرز Casioplus با **Open WebUI interaction/model plane** است. Dispatcher یک outbox item احرازشده را به `POST /dispatch` می‌فرستد؛ adapter مدل را از allowlist محیط resolve می‌کند، فقط `POST /api/chat/completions` را فراخوانی می‌کند و نتیجهٔ typed شامل output، model، token usage و latency را برای ثبت canonical به Core بازمی‌گرداند.

Adapter هیچ دسترسی PostgreSQL، session کاربر، target URL از payload، tool، pipe، file، knowledge base، `chat_id` یا privilege ندارد. API key باید متعلق به service account اختصاصی و non-admin باشد؛ instance باید endpoint restriction و rotation عملیاتی داشته باشد.

## قرارداد runtime

| مورد           | مقدار                                                                        |
| -------------- | ---------------------------------------------------------------------------- |
| Port           | `8083`                                                                       |
| Health         | `GET /healthz`                                                               |
| Dispatch       | `POST /dispatch`                                                             |
| Operation      | `model.chat.complete`                                                        |
| Authentication | `x-casioplus-adapter-secret`                                                 |
| Context        | organization، Workspace، operation و idempotency فقط از headerهای Dispatcher |
| Persistence    | Open WebUI داخلی؛ هیچ canonical data در آن نوشته نمی‌شود                     |

## تنظیمات الزامی

`ADAPTER_SHARED_SECRET`، `OPEN_WEBUI_API_URL`، `OPEN_WEBUI_API_KEY` و `OPEN_WEBUI_ALLOWED_MODELS_JSON` الزامی‌اند. `OPEN_WEBUI_TIMEOUT_MS` و محدودیت body اختیاری‌اند. در production، URL باید HTTPS باشد مگر hostname خصوصی runtime یعنی `open-webui`.

## Activation gates

پیش از فعال‌سازی، image Open WebUI باید به release یا digest ثابت pin شود؛ service account باید non-admin باشد؛ allowlist مدل باید با runtime meter binding فعال تطابق داشته باشد؛ testهای auth، contract، token metering و PostgreSQL lifecycle باید سبز باشند؛ و adapter و runtime نباید credential پایگاه دادهٔ canonical دریافت کنند.
