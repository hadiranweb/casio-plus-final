# وضعیت Governance ریپوی Casioplus

## وضعیت جاری

| کنترل                                        | وضعیت                                       |
| -------------------------------------------- | ------------------------------------------- |
| visibility                                   | private                                     |
| branch اصلی                                  | `main`                                      |
| merge policy                                 | فقط squash merge                            |
| merge commit                                 | غیرفعال                                     |
| rebase merge                                 | غیرفعال                                     |
| حذف branch پس از merge                       | فعال                                        |
| Environment staging                          | ایجاد شده                                   |
| Environment production                       | ایجاد شده                                   |
| branch protection و required checks          | در سطح فعلی حساب خصوصی GitHub در دسترس نیست |
| Environment wait timer و reviewer protection | در سطح فعلی حساب خصوصی GitHub در دسترس نیست |

## کنترل‌های جبرانی

تا زمان فعال‌شدن branch protection، هر commit روی `main` باید workflowهای `CI` و `Release Casioplus` را اجرا کند. `CI` شامل frozen install، format، typecheck، unit test، topology، repository security، dependency policy، migration smoke، build، Remix SSR smoke و Docker build چهار واحد Core، Worker، Console و Forge است.

production deployment تنها از workflow دستی و Environment `production` انجام می‌شود. متغیر `LIARA_DEPLOY_ENABLED` به‌صورت پیش‌فرض تعریف نشده است؛ بنابراین هیچ push عادی استقرار واقعی انجام نمی‌دهد. فعال‌سازی deployment مستلزم ثبت secretها، health check، rollback و تأیید صریح release است.

## شرط ارتقای governance

قبل از اولین production promotion، branch protection و required status checks باید فعال شوند، یا repository به مالکیتی منتقل شود که این کنترل‌ها را برای repository خصوصی ارائه دهد. در غیر این صورت exception ریسک باید به‌صورت مکتوب و زمان‌دار تأیید شود.
