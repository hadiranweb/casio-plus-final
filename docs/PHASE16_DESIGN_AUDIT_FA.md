# ممیزی طراحی کنترل‌پلین مرحلهٔ ۱۶

## دامنهٔ بررسی

این ممیزی دو state احراز‌شده را بررسی کرد: **Governance Control در Console** و **Run Control در Forge**. شواهد از screenshotهای واقعی browser، رفتار فرم‌ها، stateهای persisted و source همان build گرفته شد. ممیزی صرفاً تشخیصی بود و نتیجه‌ها پیش از هر اصلاح با source و اجرای واقعی تطبیق داده شدند.

## حکم

جهت بصری موجود حفظ شد. هیچ الگوی P0، اثبات جعلی، decoration stacking، nested-card system یا شکست عملیاتی در stateهای بررسی‌شده مشاهده نشد. دو اصلاح محتوایی پذیرفته شد: حذف تکرار غیرضروری واژهٔ version و تبدیل Flow Map ثابت به lifecycle واقعی هر runtime. سایر پیشنهادهای screenshot-only به‌دلیل false positive یا نبود شواهد کافی به‌عنوان blocker پذیرفته نشدند.

| اولویت | finding                              | تصمیم                                   | شواهد و اقدام                                                                                                                                    |
| ------ | ------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1     | رقابت «ثبت و اجرا» با «ساخت version» | رد به‌عنوان defect                      | دو action در دو task boundary مستقل قرار دارند: authoring و execution. رنگ و container جداست و هیچ‌کدام در heading مشترک نیستند.                 |
| P1     | فضای خالی Approval Inbox             | رد به‌عنوان defect                      | فضای خالی state واقعی `0 pending` است و هنگام درخواست approval با payload، reason و تصمیم پر می‌شود. browser lifecycle هر دو state را تأیید کرد. |
| P2     | تکرار واژهٔ version                  | پذیرفته                                 | heading به «یادداشت تغییر» و action به «ثبت نسخهٔ immutable» اصلاح شد.                                                                           |
| P2     | Flow Map ثابت و گمراه‌کننده          | پذیرفته و ارتقا یافته                   | مراحل سوم و چهارم اکنون برای Native، n8n، Open WebUI و OpenClaw به‌ترتیب lifecycle واقعی را نمایش می‌دهند.                                       |
| P2     | clipping یا contrast                 | نیازمند گیت ماشینی، نه قضاوت screenshot | هیچ clipping قطعی در browser مشاهده نشد. accessibility شش‌حالته و performance budget پس از build نهایی دوباره اجرا می‌شوند.                      |
| P3     | تمایز action مخرب                    | رد به‌عنوان defect                      | actionهای disable/retire با رنگ متن مخرب و بدون وزن primary نمایش داده می‌شوند؛ action اصلی سبز و جداست.                                         |

## مهم‌ترین اصلاح

**Flow Map نباید approval و artifact را برای همهٔ runtimeها ثابت نشان دهد.** این مورد اصلاح شد تا نقشهٔ Forge به‌جای نمایش یک مسیر عمومی، مدل واقعی execution و result هر adapter را بازتاب دهد.

## Unknownها

رفتار نهایی در دادهٔ بسیار حجیم، ترجمهٔ کامل localeهای دیگر و stateهای واقعی runtime پس از اتصال provider در این مرحله قابل اثبات نیستند. این موارد در staging و Golden Flowهای provider-bound بررسی می‌شوند.
