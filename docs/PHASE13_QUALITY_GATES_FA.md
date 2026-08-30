# گیت‌های کیفیت مرحلهٔ ۱۳

**نویسنده:** Manus AI  
**وضعیت:** آمادهٔ candidate پس از عبور CI

## نتیجهٔ اجرایی

گراف سه‌بعدی حافظه فقط از `Memory Broker` و پس از کنترل organization، Workspace، namespace، grant، purpose، sensitivity، validity و promotion داده می‌گیرد. Console داده را فقط با اقدام صریح کاربر درخواست می‌کند و chunk سه‌بعدی در بار اولیه دریافت نمی‌شود.

| گیت                                          |                                              نتیجه | شواهد                                                                 |
| -------------------------------------------- | -------------------------------------------------: | --------------------------------------------------------------------- |
| PostgreSQL integration برای graph governance |                                        ۴ از ۴ موفق | self-access، grant محدود، revoke، lineage و access audit              |
| API graph local warm benchmark               | p50 برابر ۶٫۷ ms؛ p95 برابر ۸٫۱ ms؛ بیشینه ۱۰٫۴ ms | ۳۰ درخواست authenticated با PostgreSQL محلی و ۲۷ node/۳۳ edge         |
| Console initial JavaScript                   |                                   ۹۶٬۷۱۹ بایت gzip | سقف enforceشده: ۱۲۵ KiB                                               |
| Forge initial JavaScript                     |                                   ۹۴٬۰۰۷ بایت gzip | سقف enforceشده: ۱۲۵ KiB                                               |
| Console CSS                                  |                                    ۵٬۲۶۲ بایت gzip | سقف enforceشده: ۲۰ KiB                                                |
| Forge CSS                                    |                                    ۳٬۳۶۰ بایت gzip | سقف enforceشده: ۲۰ KiB                                                |
| graph lazy JavaScript                        |                                  ۱۳۰٬۳۸۹ بایت gzip | سقف enforceشده: ۱۵۰ KiB؛ فقط پس از درخواست کاربر                      |
| axe anonymous                                |                                      صفر violation | Console و Forge                                                       |
| axe authenticated                            |                                      صفر violation | Console و Forge در ۱۴۴۰×۱۰۰۰ و ۳۹۰×۸۴۴؛ Console با graph بارگذاری‌شده |

دو نتیجهٔ `incomplete` مربوط به تشخیص خودکار contrast روی sticky header و itemهای خارج از viewport scroll بودند. رنگ‌های نهایی روی background ثابت بازبینی شدند و violation قطعی باقی نماند. نتیجهٔ خودکار جایگزین keyboard، responsive و visual review دستی نیست.[1]

## تصمیم‌های ممیزی design-slop

دو ممیز مستقل Console و Forge را از screenshot authenticated و source بررسی کردند. یافته‌های زیر پس از تطبیق با رفتار واقعی پذیرفته شدند.

| یافته                                        | تصمیم      | اصلاح                                                                                                                                                            |
| -------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| دو primary action برای ساخت version در Forge | پذیرفته    | action تکراری header حذف شد؛ submit اصلی فقط در مرحلهٔ Version باقی ماند.                                                                                        |
| label `live` بدون subscription یا polling    | پذیرفته    | به «آخرین داده» تغییر کرد.                                                                                                                                       |
| نوع گره فقط با رنگ قابل تشخیص بود            | پذیرفته    | entity type متنی در فهرست keyboard-accessible اضافه شد.                                                                                                          |
| تعامل drag/zoom گراف کشف‌پذیر نبود           | پذیرفته    | راهنمای کوتاه و کنترل reset افزوده شد.                                                                                                                           |
| contrast متن‌های کوچک                        | پذیرفته    | tokenهای Console و Forge تا عبور صفر-violation اصلاح شدند.                                                                                                       |
| گرید ظریف canvas تزئینی است                  | رد با دلیل | گرید فقط داخل فضای graph/canvas به‌عنوان مرجع فضایی استفاده می‌شود و در قواعد ممیزی برای map/canvas کاربردی مجاز است؛ حذف آن depth و orientation را ضعیف می‌کرد. |
| حذف همهٔ surfaceهای مرحله‌ای Forge           | رد با دلیل | چهار surface، مراحل واقعی Identity، Runtime، Contract و Version هستند و ترتیب کار را می‌سازند؛ کارت‌های آماری یا تزئینی نیستند.                                  |
| حذف connectorهای Flow Map                    | رد با دلیل | connectorها ترتیب اجرایی را منتقل می‌کنند و بدون آن‌ها map به فهرست نامرتبط تبدیل می‌شود.                                                                        |
| حذف focus treatment                          | رد با دلیل | focus-visible برای navigation کیبورد لازم است؛ visual treatment حفظ شد.                                                                                          |

## قرارداد performance

`validate:performance` پس از build در CI اجرا می‌شود و regression اندازهٔ initial bundle، CSS یا chunk گراف را متوقف می‌کند. graph query در قرارداد UI به ۶۰ memory item و در contract عمومی به ۸۰ محدود است. رندر WebGL تنها در زمان resize یا interaction اجرا می‌شود؛ animation loop دائمی وجود ندارد و resourceها هنگام unmount آزاد می‌شوند.

> این اعداد baseline توسعه‌اند، نه SLA production. p95 نهایی باید روی topology، شبکه، PostgreSQL و دادهٔ production-like در staging دوباره اندازه‌گیری شود.

## References

[1]: https://www.deque.com/axe/ 'axe accessibility testing — Deque Systems'
