# سند انتقال سنگ‌بنا به `casio-plus`

## هدف

این repository از صفر با تاریخچهٔ Git مستقل ساخته شده است تا Casioplus source of truth روشن، clean و قابل‌ادامه داشته باشد. هدف انتقال **نتیجهٔ معتبر** نشست قبلی است، نه ادامه‌دادن blind تاریخچه یا ادغام دوبارهٔ repositoryهای قدیمی.

## تصمیم انتقال

| مورد                    | تصمیم                                                                             |
| ----------------------- | --------------------------------------------------------------------------------- |
| repository جدید         | [`hadiranweb/casio-plus`](https://github.com/hadiranweb/casio-plus)               |
| branch اصلی             | `main`                                                                            |
| محصول                   | Casioplus                                                                         |
| scope بسته‌ها           | `@casioplus`                                                                      |
| snapshot مبدأ           | snapshot معتبر نشست قبلی، آخرین commit `701cde5440536474d60072c516aee719293af47a` |
| تاریخچهٔ Git مبدأ       | منتقل نشد؛ repository جدید با Git history مستقل ساخته شد                          |
| generated output        | `node_modules` و تمام `dist`ها منتقل نشدند                                        |
| credentialها            | هیچ token، secret، `.env` یا database dump منتقل یا commit نشد                    |
| نقش repositoryهای قدیمی | provenance تاریخی و read-only؛ نه محل توسعهٔ جدید                                 |

## آنچه به‌عنوان foundation منتقل شد

معماری پایهٔ TypeScript/Node.js + PostgreSQL canonical، monorepo pnpm، Core/API Express، migration runner ordered با checksum، domain contracts، App و Studio، Native Diagnosis Worker، adapter contractهای n8n/Open WebUI/OpenClaw، smokeهای Golden Flow، Dockerfileهای deployment، CI/CD workflowها و اسناد فارسی Charter، Golden Flow، Threat Model، Memory Taxonomy و Release Readiness در این baseline حضور دارند.

این انتقال به معنای production-ready بودن محصول نیست. قابلیت‌های موجود، یک **vertical slice قابل‌اجرا و قابل‌اعتبارسنجی** هستند. login/onboarding واقعی، service identity کامل، replay protection پایدار، asynchronous queue، artifact object storage، publication participant flow، isolation integration tests و staging واقعی باید در فازهای بعدی ساخته و با evidence پذیرفته شوند.

## قوانین نام‌گذاری

نام repository به‌صورت slug برابر `casio-plus` است. نام محصول و متن‌های کاربرپسند `Casioplus` باقی می‌ماند. نام بسته‌های داخلی `@casioplus/*` است تا با برند محصول سازگار باشد. ارجاع به نام‌ها یا repositoryهای پیشین در source جدید مجاز نیست و نباید در hostname، package، runtime service، database schema جدید، UI یا documentation استفاده شود.

## معیار پذیرش انتقال

انتقال foundation زمانی معتبر است که working tree clean باشد، مسیرهای generated در Git نباشند، remote مقصد `hadiranweb/casio-plus` باشد، topology validator سبز باشد، dependency direction ثبت‌شده نقض نشود، و format، typecheck، test، build و smokeهای متناسب موفق باشند. هر تغییر بعدی باید سند topology را رعایت کند و در صورت تغییر مرزها، ADR خود را همراه همان change اضافه کند.
