# یافته‌های بصری مرحلهٔ ۱۳

بازبینی روی Console authenticated با دادهٔ واقعی PostgreSQL و گراف ۲۷ گره/۳۳ رابطه انجام شد. صفحه در viewport دسکتاپ بدون overlap یا horizontal overflow رندر شد و گراف WebGL فقط پس از اقدام کاربر بارگذاری شد.

| اولویت | کلاس           | شواهد                                                                                                                  | اصلاح لازم                                                                                       |
| ------ | -------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| P1     | Quality defect | فهرست fallback گراف برای Memory، Claim و Semantic Record عنوان یکسان را سه بار تکرار می‌کند و نوع فقط با رنگ مشخص است. | نوع entity باید به‌صورت متن کنار هر عنوان نمایش داده شود؛ رنگ تنها carrier معنا نباشد.           |
| P1     | Quality defect | label `live` روی Run Timeline وجود دارد ولی UI subscription یا polling پیوسته ندارد.                                   | label به «آخرین داده» تغییر کند و ادعای live حذف شود.                                            |
| P2     | Slop pattern   | micro-labelهای uppercase/monospace در اغلب surface headها تکرار شده‌اند.                                               | فقط labelهای دارای نقش navigation/operational context حفظ و موارد تشریفاتی ادغام شوند.           |
| P2     | Quality defect | نقطه‌های گراف در scale اولیه کوچک‌اند و کلیک با pointer برای برخی گره‌ها دشوار است.                                    | اندازهٔ point و raycaster threshold کمی افزایش یابد، بدون افزودن glow یا animation.              |
| P2     | Quality defect | گراف فقط روی کلیک canvas جزئیات را نشان می‌دهد؛ keyboard fallback به فهرست وابسته است.                                 | فهرست entity type متنی، selected state واضح و focus-visible حفظ شود؛ canvas نقش مکمل داشته باشد. |

مسیرهای screenshot بازبینی local و خارج از repository نگه‌داری می‌شوند و در preview نهایی فقط پس از پاک‌سازی داده‌های disposable استفاده خواهند شد.

## Forge authenticated

Forge با session واقعی و Flow منتشرشده در viewport دسکتاپ بدون overflow یا overlap رندر شد. rail، workspace، runtime binding و version history قابل تشخیص‌اند و هیچ metric یا دادهٔ ساختگی نمایش داده نمی‌شود.

| اولویت | کلاس           | شواهد                                                                                                                                    | اصلاح لازم                                                                                            |
| ------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| P1     | Quality defect | اقدام بالای صفحه «ذخیرهٔ version» و اقدام داخل مرحلهٔ ۰۴ «ساخت version immutable» دو primary action نزدیک برای یک intent به‌نظر می‌رسند. | اقدام header حذف یا به anchor کم‌تأکید برای مرحلهٔ Version تبدیل شود؛ submit اصلی فقط داخل فرم بماند. |
| P2     | Slop pattern   | micro-labelهای uppercase در heading اصلی، چهار مرحله، Flow Map و Version History پرتکرارند.                                              | labelهای دارای نقش sequence حفظ و labelهای تکراری header ادغام شوند.                                  |
| P2     | Quality defect | Flow Map چهار tile هم‌وزن دارد، درحالی‌که runtime انتخاب‌شده باید نسبت به مراحل ثابت برجسته‌تر باشد.                                     | selected runtime در map از state واقعی version گرفته و tile ثابت Native حذف شود.                      |
| P3     | Quality defect | عبارت `governed session` با نقطهٔ سبز وضعیت معتبر را نشان می‌دهد اما متن فارسی/انگلیسی در topbar ناهماهنگ است.                           | واژگان وضعیت به «session معتبر» همسان شود، بدون animation یا ادعای live.                              |
