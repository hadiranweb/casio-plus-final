# شناسنامهٔ منابع Interaction و Action Plane کاسیو پلاس

## Open WebUI

مبنای قرارداد Open WebUI، مستندات رسمی API در تاریخ ممیزی است. endpoint مدل `POST /api/chat/completions` است و با Bearer API key احراز می‌شود.[1] پاسخ‌های tool-using ممکن است چند model call داشته باشند؛ برای metering کل پاسخ باید `input_tokens` و `output_tokens` خوانده شوند، نه صرفاً `prompt_tokens` و `completion_tokens` آخرین call.[1]

API key همان permissionهای account صادرکننده را به ارث می‌برد، برای هر account فقط یک key وجود دارد، expiry خودکار ندارد و endpoint restriction در سطح instance اعمال می‌شود، نه per-key.[2] بنابراین Casioplus باید از instance یا service account اختصاصی non-admin، endpoint allowlist محدود به model completion و rotation عملیاتی استفاده کند. Adapter هیچ `tool_ids`، `tools`، `chat_id` یا privilege را از payload Casioplus به Open WebUI منتقل نمی‌کند؛ Open WebUI فقط interaction/model plane است.

release ثابت بررسی‌شده `v0.11.1` با تاریخ انتشار ۲۰۲۶-۰۸-۲۵ است.[3] استفاده از image در deployment باید به release یا digest ثابت محدود شود و `latest` مجاز نیست.

## OpenClaw

repository رسمی OpenClaw تحت MIT منتشر می‌شود و معماری آن Gatewayمحور است.[4] interface deterministic برای ارسال مستقیم، Gateway RPC method با نام `send` است. schema رسمی آن `to`، `message`، `channel`، `accountId` و `idempotencyKey` را می‌پذیرد؛ side-effecting methodها idempotency key می‌خواهند.[5]

CLI رسمی `openclaw gateway call <method> --params <json>` راه استاندارد فراخوانی RPC است و token/URL می‌توانند از محیط یا config ایزوله بارگذاری شوند.[6] برای outbound delivery، command عمومی `openclaw message send` نیز وجود دارد، اما adapter کاسیو پلاس از Gateway RPC استفاده می‌کند تا idempotency key canonical حفظ شود.[7]

نسخهٔ npm ثابت بررسی‌شده `2026.7.1-2` با license MIT و Node engineهای `>=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0` است. runtime OpenClaw باید image/نسخهٔ مستقل داشته باشد و engine آن نباید Node نسخهٔ Core را تغییر دهد.

## تصمیم معماری Casioplus

Open WebUI و OpenClaw هیچ‌کدام canonical writer نیستند و credential PostgreSQL ندارند. ProcessRun، policy، approval، payload hash، outbox، retry، audit، RuntimeEvent و usage attribution فقط در Core/API ثبت می‌شوند. OpenClaw تنها action allowlisted `send_message` را در MVP می‌پذیرد؛ target خام از request دریافت نمی‌شود و `executorRef` فقط از mapping server-side resolve می‌شود. هر action به approval معتبر، scope سازمان/Workspace، FlowVersion، payload hash، expiry و idempotency key متصل است.

## References

[1]: https://docs.openwebui.com/reference/api-endpoints/ 'Open WebUI API Endpoints'
[2]: https://docs.openwebui.com/features/authentication-access/api-keys/ 'Open WebUI API Keys'
[3]: https://github.com/open-webui/open-webui/releases/tag/v0.11.1 'Open WebUI v0.11.1'
[4]: https://github.com/openclaw/openclaw 'OpenClaw repository'
[5]: https://docs.openclaw.ai/gateway/protocol 'OpenClaw Gateway protocol'
[6]: https://docs.openclaw.ai/cli/gateway 'OpenClaw Gateway CLI'
[7]: https://docs.openclaw.ai/cli/message 'OpenClaw message CLI'
