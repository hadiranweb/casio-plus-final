# حاکمیت Interaction و Action Plane کاسیو پلاس

## مرزهای قطعی

Open WebUI فقط **interaction/model plane** و OpenClaw فقط **action plane محدود** است. هیچ‌کدام canonical writer نیستند، credential PostgreSQL ندارند و lifecycle مستقل برای Work، Flow، ProcessRun، Memory، Artifact، Approval یا Usage ایجاد نمی‌کنند. Integration Dispatcher تنها از API داخلی Core outbox claim می‌کند و نتیجهٔ typed adapter را به Core بازمی‌گرداند.

| Runtime    | operation مجاز MVP    | کنترل پیش از queue                                                                                 | نتیجهٔ canonical                                                 |
| ---------- | --------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Open WebUI | `model.chat.complete` | model allowlist و runtime meter binding فعال                                                       | ProcessRun، RuntimeEvent و UsageEvent immutable                  |
| OpenClaw   | `action.send_message` | target server-side، policy versioned، approval معتبر، payload hash، expiry و runtime meter binding | ProcessRun، ActionExecution، RuntimeEvent و UsageEvent immutable |

## Open WebUI

FlowVersion فقط `model`، `systemPrompt` و `maxTokens` محدود را تعریف می‌کند و ProcessRun فقط prompt و input داده‌ای را فراهم می‌کند. Adapter هیچ tools، files، knowledge، callback، chat identifier یا privilege را forward نمی‌کند. مدل از `OPEN_WEBUI_ALLOWED_MODELS_JSON` resolve می‌شود و API key باید service account اختصاصی non-admin باشد.

## OpenClaw

MVP فقط `send_message` را می‌پذیرد. FlowVersion یک `targetKey` منطقی دارد؛ Core آن را به ActionTarget و ActionPolicy همان Organization، Workspace، Flow و FlowVersion resolve می‌کند. ActionTarget فقط `executorRef` را نگه می‌دارد و channel/target/account واقعی فقط در secret-backed map adapter وجود دارند. Approval شامل risk class، payload hash، actor، expiry، تصمیم و rationale است. تغییر message پس از approval باعث payload hash mismatch و رد execution می‌شود.

Adapter از interface رسمی `openclaw gateway call send` و `idempotencyKey` canonical استفاده می‌کند. token در environment می‌ماند و در argv قرار نمی‌گیرد. متن پیام به‌علت interface CLI در params process قرار می‌گیرد؛ بنابراین container باید PID namespace ایزوله و فاقد co-tenant باشد و دسترسی diagnostic به process list محدود شود. جایگزینی با direct Gateway client پایدار یک سخت‌سازی بعدی است، نه مجوز برای گسترش action surface.

## Metering و economics

قیمت در source hard-coded نیست. مدیر Organization ابتدا یک `pricing_assumption_versions` فعال و سپس `runtime_meter_bindings` نسخه‌دار ایجاد می‌کند. Core هنگام queue شدن execution، binding فعال را resolve و snapshot عددی آن را روی outbox ثبت می‌کند. نتیجهٔ موفق runtime در همان transaction acknowledgment به `usage_events` immutable تبدیل می‌شود و به Organization، Workspace، Flow، FlowVersion، ProcessRun، namespace، operation، runtime/model، token/byte/latency، unit cost، shared cost، billable amount، payer و pricingVersion متصل است. نبود binding معتبر باعث `503 runtime_metering_not_configured` و عدم queue می‌شود.

## شبکه و persistence

Composeهای `runtime/open-webui` و `runtime/openclaw` imageهای ثابت دارند، پورت عمومی منتشر نمی‌کنند، شبکهٔ داخلی و adapter network جدا دارند و PostgreSQL canonical را دریافت نمی‌کنند. state runtimeها operational و غیرcanonical است. volume backup، health/readiness، rotation secret، staging Golden Flow و rollback pointer پیش از production الزامی‌اند.

## شواهد اجباری

گیت مرحله شامل format، typecheck، unit tests، migration روی PostgreSQL خالی، integration test lifecycle مدل و action، default-deny approval، payload hash، target resolution، usage immutability، topology/security validator، dependency audit، build، SSR smoke، Compose config و Docker build دو adapter است.
