# شناسنامهٔ مرجع OpenHands برای Casioplus

## منبع و دامنهٔ استفاده

مرجع بیرونی این ممیزی repository رسمی [OpenHands/OpenHands](https://github.com/OpenHands/OpenHands) در commit ثابت `f26d734a848297d8dcf460b0bb739174e76511f0` است. snapshot بررسی‌شده شامل ۲٬۱۷۴ فایل بود و صرفاً به‌عنوان **concept donor** برای طراحی event protocol، sandbox boundary، approval، observability و interaction plane مطالعه شد؛ هیچ فایل، component، runtime یا dependency آن مستقیماً به repository Casioplus منتقل نشده است.

license ریشهٔ snapshot، MIT با copyright سال ۲۰۲۵ برای مشارکت‌کنندگان OpenHands است و در صورت کپی substantial portion الزام حفظ copyright و permission notice دارد.[1] تصمیم Casioplus این است که از کپی کد خودداری کند و فقط الگوهای عمومی معماری را با implementation مستقل TypeScript/Node.js بازسازی کند.

## نتیجهٔ ممیزی موازی

| حوزه                 | الگوی قابل اقتباس                                                                    | الگوی مردود برای Casioplus                                             | حکم                                                       |
| -------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | --------------------------------------------------------- |
| Event و lifecycle    | event envelope نسخه‌دار، state transition صریح، cursor برای replay و snapshot + tail | state authority در WebSocket client یا local storage                   | Core باید sequence و replay را canonical کند.             |
| Sandbox              | جداسازی client از executor، proxy احرازشده، resource limit و lifecycle محدود         | انتقال runtime چندزبانه یا Docker manager OpenHands به critical path   | OpenClaw پشت adapter مستقل و بدون DB credential اجرا شود. |
| Approval             | risk class، درخواست approval نسخه‌دار و پاسخ human-in-the-loop                       | permission helper کلاینتی یا default allow                             | policy و approval فقط server-side و default-deny باشند.   |
| Interaction/model    | stream event و adapter registry                                                      | client هوشمند با business state یا LLM setting authority               | Open WebUI فقط interaction/model plane باقی بماند.        |
| Observability        | error taxonomy، correlation propagation و recovery state                             | telemetry identity ساخته‌شده در مرورگر                                 | trace، audit و usage ID فقط در Core صادر شوند.            |
| Deployment           | secret indirection و health boundary                                                 | all-in-one stateful container، filesystem authority و runtime DB مشترک | واحدهای deploy مستقل و datastore runtime جدا باشند.       |
| License و dependency | مطالعهٔ الگوهای adapter و store                                                      | ورود مستقیم React/Zustand/Python/runtime tree به monorepo              | concept donor only؛ provenance در این سند کافی است.       |

## مسیرهای کلیدی بررسی‌شده

مسیرهای زیر در snapshot مبنای تصمیم بودند: `src/api/agent-server-adapter.ts`، `src/stores/conversation-store.ts`، `src/services/telemetry.ts`، `src/utils/user-facing-error.ts`، `src/utils/error-handler.ts`، `src/hooks/query/use-bash-command-logs.ts`، `src/api/cloud/secrets-service.api.ts`، `docker/Dockerfile`، `docker/entrypoint.sh` و `helm/agent-canvas/values.yaml`.

## قواعد انتقال به پیاده‌سازی Casioplus

هر الگویی که پذیرفته می‌شود باید implementation مستقل داشته باشد و از این مرزها عبور نکند: **Core/API تنها canonical writer است؛ Open WebUI فقط interaction/model plane است؛ OpenClaw فقط action plane دارای allowlist و approval است؛ adapter و runtime هیچ دسترسی مستقیم PostgreSQL ندارند؛ شناسه، scope و privilege کلاینت authority نیست؛ و هر event، approval و usage به organization، Workspace، FlowVersion و ProcessRun متصل می‌شود.**

## References

[1]: https://github.com/OpenHands/OpenHands/blob/f26d734a848297d8dcf460b0bb739174e76511f0/LICENSE 'OpenHands MIT License at audited commit'
