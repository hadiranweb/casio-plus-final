# یافته‌های بازبینی بصری مرحلهٔ ۱۵

## محیط

بازبینی روی Console Remix با Core/API واقعی، cookie session، CSRF و PostgreSQL disposable انجام شد. دادهٔ آزمون فقط از routeهای canonical ساخته شد و هیچ fixture نمایشی وارد محصول نشد.

## نتیجهٔ اولیه

صفحهٔ ناشناس ثبت‌نام و ورود بدون regression نمایش داده شد. پس از ایجاد Organization، Console authenticated با Organization و Workspace فعال بارگذاری شد و بخش «کنترل سازمان» به‌صورت lazy در همان surface نمایش داده شد.

Control plane در وضعیت owner این قابلیت‌ها را نمایش داد: context selector، ساخت Organization جدید، پذیرش invitation با token، ساخت Workspace، دعوت عضو با Workspace و role، جدول اعضا، فهرست دعوت‌ها و لغو دسترسی. Context و role از session server-managed آمده‌اند؛ هیچ شناسهٔ tenant از browser authority گرفته نشد.

## نقاط تأییدشده

- ناوبری «تنظیمات» و scope card هر دو به بخش control plane واقعی متصل‌اند.
- آخرین owner در UI قابلیت revoke ندارد و invariant متناظر در Core نیز integration test دارد.
- دعوت تازه token را فقط در پاسخ همان درخواست نشان می‌دهد؛ فهرست persisted token را بازنمایی نمی‌کند.
- بخش جدید hierarchy و design system فعلی Console را حفظ کرده و nested-card تزئینی یا metric ساختگی اضافه نکرده است.

## بررسی باقی‌مانده

بازبینی کامل بخش پایین صفحه در desktop و mobile، interaction واقعی ساخت Workspace/دعوت/context switch و اجرای accessibility gate پس از final build هنوز باید تکمیل شود.

## بازبینی desktop بخش کنترل سازمان

در viewport دسکتاپ، پنج بلوک context، ایجاد Organization، پذیرش دعوت، ایجاد Workspace و دعوت عضو با hierarchy تخت و borderهای مشترک نمایش داده شدند. جدول اعضا و فهرست دعوت‌ها زیر فرم‌ها قرار گرفتند و overflow افقی ناخواسته در صفحه مشاهده نشد. دکمهٔ لغو دسترسی آخرین owner به‌صورت disabled نمایش داده شد.

فرم ایجاد Workspace با دادهٔ QA تکمیل شد و آمادهٔ آزمون submit واقعی است. انتخاب‌گر invitation فقط Workspaceهای server-returned را نمایش داد. بخش economics پس از control plane باقی ماند و با فرم‌ها یا جدول‌ها هم‌پوشانی نداشت.

## تعامل واقعی Workspace

ارسال فرم ایجاد Workspace از Console موفق بود. پیام موفقیت نمایش داده شد، context selector بدون reload کامل دو Workspace را نشان داد، شمار Workspaceهای عضو owner از ۱ به ۲ تغییر کرد و Workspace جدید در selector دعوت نیز ظاهر شد. این مسیر از cookie session و CSRF استفاده کرد و پاسخ Core تنها منبع refresh UI بود.

تلاش نخست ابزار browser برای انتخاب گزینهٔ دوم به‌دلیل خطای encoding در harness انجام نشد؛ این خطا از صفحه یا API نبود. آزمون context switch با روش browser جایگزین و سپس با session rotation در integration test ادامه می‌یابد.

## Context switch واقعی

انتخاب Workspace دوم در selector باعث فراخوانی route server-authoritative، rotation session، refresh داده‌های scoped و تغییر هم‌زمان header، rail scope card و جزئیات Context فعال شد. پیام موفقیت نیز صریحاً اعلام کرد که context با session جدید تغییر کرده است. Workspaceهای مقصد فقط از فهرست membership سرور انتخاب شدند و browser هیچ شناسهٔ دلخواهی تولید نکرد.

## Invitation lifecycle واقعی

ارسال invitation از Console برای Workspace انتخاب‌شده موفق بود. token فقط در همان پاسخ و به‌صورت لینک قابل کپی نمایش داده شد؛ ردیف persisted دعوت فقط ایمیل، Workspace، role، expiry و status را نشان داد و token را بازنمایی نکرد. عملیات revoke نیز در همان ردیف و فقط برای وضعیت pending در دسترس است.

## بررسی revoke invitation

نخستین کلیک browser روی کنترل «لغو» invitation تغییری در state ایجاد نکرد و پیام خطای UI نیز نمایش داده نشد. چون integration test مستقیم route موفق است، این وضعیت به‌عنوان blocker باز ثبت شد تا target button، handler و درخواست browser بررسی شود؛ موفقیت UI تا رفع و تکرار آزمون اعلام نمی‌شود.

DOM inspection نشان داد فهرست دعوت دقیقاً یک دکمهٔ فعال با type=button دارد. همان کنترل به‌صورت مستقیم کلیک شد؛ نتیجهٔ درخواست و state در مشاهدهٔ بعدی بررسی می‌شود تا تفاوت click harness و رفتار UI مشخص گردد.

کلیک مستقیم همان کنترل DOM موفق بود و invitation به وضعیت `revoked` تغییر کرد؛ پیام موفقیت در Console ظاهر شد. بنابراین route، CSRF و UI state صحیح‌اند و عدم تغییر در تلاش قبلی ناشی از target/index ابزار browser بود، نه defect محصول.

## بازبینی build دارای Integration Gateway

Build جدید Console روی PostgreSQL و migrationهای تازه راه‌اندازی شد. صفحهٔ ناشناس ورود و ثبت Organization بدون regression بصری یا تغییر در مرز cookie/CSRF نمایش داده شد. مرحلهٔ بعد ایجاد Organization disposable و مشاهدهٔ پنل Integration Gateway authenticated است.

## Integration Gateway control plane

در build نهایی مرحله، بخش Integration Gateway فقط برای owner/admin و پس از بخش Organization نمایش داده شد. حالت خالی شامل ثبت ExternalApp، انتخاب application فعال، key metadata و rotation، ExternalTenant mapping و callback allowlist است. متن UI صریحاً اعلام می‌کند که مقدار secret وارد PostgreSQL نمی‌شود و شناسه‌های خارجی authority نیستند.

در viewport دسکتاپ، فرم‌ها با layout دو ستونه و hierarchy موجود Console نمایش داده شدند؛ بخش economics پس از control plane باقی ماند. submitهای key و mapping تا انتخاب ExternalApp فعال غیرفعال‌اند و Workspace مقصد فقط از فهرست server-returned انتخاب می‌شود. آزمون interaction واقعی و accessibility build جدید در ادامه انجام می‌شود.

در scroll واقعی بخش Integration Gateway، چهار ناحیهٔ functional در یک grid خوانا دیده شدند و controls غیرفعال قبل از انتخاب application به‌درستی state خود را نشان دادند. فرم ExternalApp با نام و کلید معتبر پر شد؛ submit واقعی در گام بعد اجرا می‌شود.

ثبت ExternalApp از Console موفق بود: application به‌صورت خودکار در selector انتخاب شد، summary واقعی Keys=0 و Mappings=0 نمایش یافت و record قابل غیرفعال‌سازی ایجاد شد. فرم‌های key metadata و mapping سپس با secret reference، tenant/workspace assertion و callback origin/path پر شدند؛ هیچ مقدار secret در UI دریافت نشد.

## Key و mapping end-to-end

ثبت key metadata از Console موفق بود و record فقط Key ID، secret reference و status را نمایش داد. مقدار secret نه در فرم دریافت شد و نه در پاسخ بازنمایی شد. selector rotation کلید فعال را نمایش داد و برای rotation بعدی زمان پایان کلید قبلی را الزام می‌کند.

ثبت ExternalTenant/Workspace mapping نیز موفق بود. شمار Mappings از صفر به یک تغییر کرد و record شامل Workspace server-resolved، external tenant ref، external workspace ref و status active نمایش یافت. callback allowlist از origin و path prefix جدا ساخته شد و URL یا privilege دلخواه به‌عنوان authority پذیرفته نشد.
