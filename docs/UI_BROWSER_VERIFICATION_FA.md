# شواهد browser verification سطح‌های Console و Forge

## محیط

در ۲۷ اوت ۲۰۲۶، Console و Forge به‌عنوان Remix application با Remix Vite dev compiler روی پورت‌های ۵۱۷۳ و ۵۱۷۴ اجرا شدند. هر دو صفحه با `lang=fa` و `dir=rtl` از root Remix رندر شدند و titleهای `Casioplus / Console` و `Casioplus / Forge` را نمایش دادند.

## Console

صفحهٔ Console با sidebar تیره، workspace switcher، ناوبری Work/Flow/Memory، hero card مسیر Golden Flow، Session panel، KPI cards، Work queue، Run timeline، فرم ساخت Work و governed memory search مشاهده شد. در حالت بدون session، وضعیت `نیازمند اتصال` و `offline` نمایش داده شد، فیلدهای عملیاتی غیرفعال بودند و متن صریح اتصال Bearer session نشان داده شد. این رفتار با اصل عدم استفاده از raw tenant header هم‌راستاست.

## Forge

صفحهٔ Forge با sidebar authoring، Flow builder، Session bar، rubric پنج‌محوره، قراردادهای `input.schema.json` و `output.schema.json`، Flow Map و بخش versionها مشاهده شد. در حالت بدون session، ساخت Flow و ذخیرهٔ version غیرفعال بودند. Flow Map به‌ترتیب Form input، Five-axis diagnosis با Native Worker، Review gate و Publication را نشان داد و متن governance boundary تصریح کرد که credentialهای runtime در Forge نمایش داده نمی‌شوند.

## نتیجه

هر دو surface بدون runtime error قابل مشاهده بودند، SSR و hydration Remix با layout دسکتاپ، sidebar و grid مناسب رندر شد و empty stateهای بدون session به‌صورت شفاف نمایش داده شدند. Browser interaction با session معتبر باید بعد از فراهم‌بودن محیط staging و identity واقعی تکرار شود؛ dev token نباید در build عمومی قرار گیرد.
