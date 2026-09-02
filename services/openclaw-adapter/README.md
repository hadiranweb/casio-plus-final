# Casioplus OpenClaw Adapter

OpenClaw در Casioplus فقط **action plane محدود، deterministic و approval-gated** است. Core/API مالک Flow، ProcessRun، target، policy، approval، outbox، audit، usage و lifecycle باقی می‌ماند. Adapter هیچ دسترسی PostgreSQL ندارد و فقط outbox item احرازشده را پس از resolve شدن policy و approval در Core اجرا می‌کند.

Action plane دو action محدود می‌پذیرد: `send_message` و `repository.open_translation_pr`. در مسیر پیام، target خام، channel، account، callback URL یا privilege از درخواست کاربر یا definition Flow به OpenClaw منتقل نمی‌شود؛ Core فقط یک `executorRef` ثبت‌شده در policy تولید می‌کند و adapter آن را از `OPENCLAW_EXECUTOR_TARGETS_JSON` به channel و target واقعی resolve می‌کند. در مسیر ترجمه، adapter فقط payload سخت‌گیر و approval-bound را به `GITHUB_APP_ADAPTER_URL` داخلی proxy می‌کند؛ repository، base، catalog path و branch pattern در shared contract ثابت‌اند و هیچ endpoint برای merge وجود ندارد. هر دو مسیر approval ID، expiry، payload hash کنترل‌شده در Core و idempotency key پایدار دارند.

## قرارداد runtime

| مورد           | مقدار                                                            |
| -------------- | ---------------------------------------------------------------- |
| Port           | `8084`                                                           |
| Health         | `GET /healthz`                                                   |
| Dispatch       | `POST /dispatch`                                                 |
| Operation      | `action.send_message` یا `action.repository.open_translation_pr` |
| Authentication | `x-casioplus-adapter-secret`                                     |
| Execution      | `openclaw gateway call send` با `idempotencyKey` canonical       |
| Persistence    | state داخلی OpenClaw؛ بدون canonical DB access                   |

## تنظیمات الزامی

`ADAPTER_SHARED_SECRET` الزامی است. برای مسیر پیام، `OPENCLAW_GATEWAY_URL`، `OPENCLAW_GATEWAY_TOKEN` و `OPENCLAW_EXECUTOR_TARGETS_JSON` لازم‌اند؛ برای مسیر Pull Request ترجمه، `GITHUB_APP_ADAPTER_URL` باید به سرویس داخلی GitHub App اشاره کند. نسخهٔ CLI در image به `2026.7.1-2` pin شده و Node runtime آن مستقل از Core است.

## Activation gates

پیش از فعال‌سازی باید OpenClaw Gateway در private network باشد، release یا digest image ثابت باشد، onboarding و channel credentialها خارج از Git انجام شوند، target map فقط allowlist مصوب باشد، approval و payload-hash test روی PostgreSQL واقعی عبور کند، duplicate delivery با idempotency تأیید شود و هیچ action دیگری از contract عبور نکند. متن پیام در invocation process قرار می‌گیرد؛ بنابراین adapter باید در PID namespace ایزوله و بدون co-tenant اجرا شود و دسترسی diagnostic به process list محدود باشد تا direct Gateway client پایدار در release آینده جایگزین CLI invocation شود.
