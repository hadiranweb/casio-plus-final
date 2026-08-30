# Identity و Integration Control Plane کاسیو پلاس

## وضعیت

این سند وضعیت پیاده‌سازی مرحلهٔ ۱۵ را ثبت می‌کند. تمام writeها از Core/API عبور می‌کنند، PostgreSQL canonical تنها store است و Console هیچ شناسهٔ Organization، Workspace، ExternalTenant یا privilege را به‌عنوان authority تعیین نمی‌کند.

## Organization، Workspace و عضویت

| قابلیت                       | مسیر canonical                                                            | کنترل اصلی                                                                      |
| ---------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| مشاهدهٔ scopeهای قابل دسترسی | `GET /api/v1/organizations`                                               | session پایدار، عضویت فعال Organization و Workspace                             |
| تغییر context                | `POST /api/v1/auth/switch-context`                                        | target فقط از membership سرور، rotation session و CSRF                          |
| ایجاد Organization           | `POST /api/v1/organizations`                                              | ایجاد actor، owner، Workspace، namespace خصوصی و session جدید در یک transaction |
| ایجاد Workspace              | `POST /api/v1/workspaces`                                                 | owner/admin، عضویت Workspace و audit                                            |
| مشاهده و تغییر عضو           | `GET/PATCH /api/v1/members`                                               | owner/admin، last-owner invariant و ابطال sessionهای عضو revoke‌شده             |
| دعوت                         | `GET/POST /api/v1/invitations`                                            | token digest، expiry، یک pending دعوت یکتا و audit                              |
| لغو یا پذیرش دعوت            | `POST /api/v1/invitations/:id/revoke` و `POST /api/v1/invitations/accept` | تطبیق ایمیل، عضویت Organization/Workspace و rotation session                    |

تحویل invitation در MVP به‌صورت **manual link** است. token فقط در پاسخ ایجاد نمایش داده می‌شود و PostgreSQL فقط digest آن را نگه می‌دارد. اتصال به email provider بخشی از تصمیم محیط استقرار است و پیش از انتخاب provider هیچ credential یا workflow ارسال فرضی به repository اضافه نشده است.

## Integration Gateway control plane

| قابلیت                       | مسیر canonical                                         | کنترل اصلی                                                               |
| ---------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------ |
| فهرست و ایجاد ExternalApp    | `GET/POST /api/v1/external-apps`                       | ownership مدیریتی Organization و owner/admin                             |
| غیرفعال‌سازی ExternalApp     | `POST /api/v1/external-apps/:id/disable`               | fail-closed در Gateway و audit                                           |
| ثبت و rotation metadata کلید | `POST /api/v1/integration-keys`                        | فقط `secretRef`؛ مقدار secret پذیرفته نمی‌شود                            |
| revoke کلید                  | `POST /api/v1/integration-keys/:id/revoke`             | ownership سازمانی، زمان پایان و audit                                    |
| ساخت mapping                 | `POST /api/v1/external-workspace-mappings`             | ExternalTenant assertion، Workspace server-resolved و callback allowlist |
| غیرفعال‌سازی mapping         | `POST /api/v1/external-workspace-mappings/:id/disable` | Organization scope و audit                                               |

ExternalApp دارای `managing_organization_id` است. شناسه‌های خارجی تنها assertion هستند و mapping به Organization و Workspace در transaction سرور انجام می‌شود. callback فقط به‌صورت origin دارای HTTPS و path prefix allowlisted ثبت می‌شود؛ callback URL داخل payload runtime authority نیست.

Integration key شامل `keyId`، `secretRef`، وضعیت و بازهٔ اعتبار است. secret واقعی باید در secret manager محیط runtime قرار گیرد و از map environment به Gateway تزریق شود. contractهای management strict هستند و فیلد ناشناخته، از جمله secret value، را رد می‌کنند.

## UI

بخش Organization در Console شامل context switch، ساخت Organization و Workspace، member lifecycle، دعوت و پذیرش دعوت است. بخش Integration Gateway شامل ExternalApp، key metadata/rotation، tenant/workspace mapping، callback allowlist و lifecycle غیرفعال‌سازی است. این UI داخل همان Remix Console و در chunk lazy کنترل سازمان قرار دارد؛ هیچ React root یا data plane موازی ساخته نشده است.

## شواهد پذیرش

- integration test PostgreSQL مسیر session rotation، tenant-negative، role-negative، last-owner، invitation deduplication و revoke را پوشش می‌دهد.
- integration test PostgreSQL مدیریت ExternalApp، رد secret field، key rotation، mapping، callback allowlist، revoke/disable و isolation میان Organizationها را پوشش می‌دهد.
- browser validation با cookie session و CSRF واقعی، ایجاد Workspace، context switch، invitation create/revoke، ExternalApp، key metadata و mapping را اجرا کرده است.
- accessibility در حالت anonymous و authenticated برای Console و Forge در desktop و mobile باید صفر violation و صفر unresolved incomplete باقی بماند.
