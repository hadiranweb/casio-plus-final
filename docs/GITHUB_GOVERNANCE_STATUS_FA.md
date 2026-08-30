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

تا زمان فعال‌شدن branch protection، هر commit روی `main` باید workflow `CI` را با موفقیت کامل کند. `CI` شامل frozen install، format، typecheck، unit و PostgreSQL integration test، topology، repository security، dependency policy، migration smoke، build، performance، Golden Flow، accessibility، n8n import، Remix SSR، Compose contract و Docker build هشت واحد production است.

workflow دستی `Prepare Casioplus Release Candidate` فقط candidate را اعتبارسنجی و artifact شواهد با `deploymentPerformed: false` تولید می‌کند. هیچ push یا workflow فعلی deployment واقعی انجام نمی‌دهد. workflow staging/production فقط پس از انتخاب provider، ثبت secret reference، health check، restore/rollback evidence و تأیید صریح کاربر ایجاد می‌شود.

## شرط ارتقای governance

قبل از اولین production promotion، branch protection و required status checks باید فعال شوند، یا repository به مالکیتی منتقل شود که این کنترل‌ها را برای repository خصوصی ارائه دهد. در غیر این صورت exception ریسک باید به‌صورت مکتوب و زمان‌دار تأیید شود.
