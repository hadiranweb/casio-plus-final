# OpenClaw Runtime for Casioplus

این runtime فقط action plane محدود Casioplus است. Compose هیچ پورت عمومی منتشر نمی‌کند، Gateway را به release `2026.7.1-2` pin می‌کند و state داخلی و workspace آن را در volumeهای مستقل نگه می‌دارد. PostgreSQL canonical و credential آن نباید به Gateway یا adapter داده شوند.

## Bootstrap

Onboarding و ثبت channelها باید به‌صورت یک عملیات کنترل‌شدهٔ خارج از Git انجام شود. `OPENCLAW_GATEWAY_TOKEN`، credential کانال‌ها و `ADAPTER_SHARED_SECRET` فقط از secret manager تزریق می‌شوند. `OPENCLAW_EXECUTOR_TARGETS_JSON` در adapter نگاشت محدود `executorRef`های مصوب به channel، target و account است؛ target خام از Flow یا کاربر authority نیست. شبکهٔ خارجی `casioplus-integration` باید پیش از اجرای Compose توسط deployment owner ایجاد شود.

## کنترل امنیتی

Gateway فقط از private network قابل دسترسی است، Bonjour غیرفعال است و MVP فقط Gateway RPC `send` را پس از approval معتبر Core اجرا می‌کند. adapter باید در PID namespace ایزوله و بدون co-tenant اجرا شود. هیچ shell، browser، file یا arbitrary tool action از contract Casioplus عبور نمی‌کند.

## عملیات

پشتیبان‌گیری از volumeهای `openclaw_state` و `openclaw_workspace` پیش از upgrade الزامی است. upgrade فقط با release یا digest ثابت، `doctor --json`، health/startup/readiness probe، Golden Flow staging و rollback pointer انجام می‌شود. imageهای rolling و mirrorهای غیررسمی در production مجاز نیستند.
