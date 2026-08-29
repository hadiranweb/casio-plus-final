# سیاست امنیت dependencyهای Casioplus

## قاعدهٔ release

هیچ vulnerability سطح Critical یا High در dependencyهای production مجاز نیست. `pnpm security:audit` این قانون را در CI enforce می‌کند. advisoryهای Moderate فقط با ثبت شناسه، اثر، کنترل جبرانی، owner و تاریخ انقضا می‌توانند موقتاً باز بمانند؛ waiver منقضی‌شده release را متوقف می‌کند.

## وضعیت ثبت‌شده

| Advisory              | Dependency         | سطح      | کنترل جبرانی                                                                                 | شرط بسته‌شدن                                             |
| --------------------- | ------------------ | -------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `GHSA-wrjc-x8rr-h8h6` | `react-router`     | Moderate | destinationها فقط از route allowlist داخلی؛ redirect خارجی فقط پس از validation سمت Core     | انتشار patch سازگار با Remix یا migration مصوب framework |
| `GHSA-jjmj-jmhj-qwj2` | `react-router-dom` | Moderate | هیچ `Link` یا navigation از URL خام و کنترل‌نشده ساخته نمی‌شود                               | انتشار patch سازگار با Remix یا migration مصوب framework |
| `GHSA-337j-9hxr-rhxg` | `react-router`     | Moderate | دادهٔ error سمت server کمینه و allowlisted؛ object یا constructor از payload hydrate نمی‌شود | انتشار patch سازگار با Remix یا migration مصوب framework |

**Owner:** Platform Security  
**ثبت:** ۳۰ اوت ۲۰۲۶  
**انقضا:** ۱۵ سپتامبر ۲۰۲۶

## dependencyهای patch‌شده

`drizzle-orm` به `0.45.2` ارتقا یافته است. `turbo-stream` با override workspace روی `3.2.1` تثبیت شده و تمام testها و buildهای Console و Forge پس از تغییر موفق بوده‌اند.

## گیت بازبینی

تا زمانی که سه advisory Moderate بسته یا waiver آن‌ها با evidence تازه تمدید نشده باشد، promotion به production مجاز نیست. staging برای validation فنی مجاز است، اما release evidence باید وضعیت advisoryها را صریحاً نشان دهد.

## References

[1]: https://github.com/advisories/GHSA-wrjc-x8rr-h8h6 'React Router open redirect advisory'
[2]: https://github.com/advisories/GHSA-jjmj-jmhj-qwj2 'React Router DOM open redirect advisory'
[3]: https://github.com/advisories/GHSA-337j-9hxr-rhxg 'React Router SSR hydration advisory'
