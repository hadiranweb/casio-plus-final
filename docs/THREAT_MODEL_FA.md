# Threat Model امنیتی MVP Casioplus

## هدف و مرز

این سند تهدیدهای مسیر MVP را برای یک محصول با دو surface App و Studio، یک Core/API canonical، PostgreSQL و runtimeهای Native Worker، n8n، Open WebUI و OpenClaw مشخص می‌کند. هدف، جلوگیری از افشای tenant، جعل هویت، تبدیل دادهٔ خام به حافظهٔ معتبر، اجرای action بدون approval و ازبین‌رفتن قابلیت audit است.

## دارایی‌های حساس

| دارایی                | نمونه                                        | نیاز حفاظتی                                          |
| --------------------- | -------------------------------------------- | ---------------------------------------------------- |
| Identity و session    | actor، membership، role، session cookie      | محرمانگی، اصالت، انقضا و revocation                  |
| Tenant data           | WorkItem، فرم، تحلیل، FlowVersion و Memory   | isolation کامل organization/workspace                |
| Runtime binding       | connector reference، endpoint و signing key  | secret management و عدم نمایش در UI                  |
| Process state         | ProcessRun، RuntimeEvent و idempotency key   | integrity، replay protection و terminal immutability |
| Evidence و Artifact   | input، JSON، HTML، PDF و upload              | scoped access، redaction و retention                 |
| Organizational Memory | claim، review، promotion و memory item       | provenance، governance، validity و explainability    |
| Audit trail           | permission failure، action، review و release | append-only، correlation و دسترسی محدود              |

## بازیگران و trust boundaryها

```text
Participant / Reviewer / Author
          ↓ session + HTTPS
App / Studio surface
          ↓ typed authenticated API
Core/API — تنها canonical writer
          ↓ private credentials
PostgreSQL / Redis / Object Storage
          ↑ signed callbacks
Native Worker / n8n / Open WebUI / OpenClaw adapters
          ↓ محدود، allowlisted و policy-gated
External systems
```

App و Studio لایهٔ presentation هستند و نباید به database، secret یا runtime internals دسترسی داشته باشند. Runtimeها untrusted یا partially trusted محسوب می‌شوند: می‌توانند نتیجه یا event تولید کنند، اما مالک state canonical نیستند. Core باید هر payload، identity، tenant و transition را مستقل validate کند.

## تهدیدها و کنترل‌ها

| شناسه | تهدید                                 | کنترل MVP                                                                                | آزمون پذیرش                                                       |
| ----- | ------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| T-01  | جعل tenant با header یا شناسهٔ کاربر  | tenant از session/service identity و membership سرور مشتق شود؛ header خام فقط test local | درخواست با org/workspace دیگر 403 و بدون data leak                |
| T-02  | IDOR روی Work، Artifact یا Memory     | تمام repository helperها scoped به organization/workspace و actor هستند                  | تغییر UUID در URL نتیجهٔ 404/403 کنترل‌شده می‌دهد                 |
| T-03  | privilege escalation در role          | role در هر mutation و query حساس بررسی شود؛ client role قابل‌اعتماد نیست                 | Participant نمی‌تواند publish، promote یا invite انجام دهد        |
| T-04  | سرقت session یا CSRF                  | secure/httpOnly/sameSite cookie، CSRF token برای mutation و session rotation             | mutation بدون CSRF معتبر رد می‌شود                                |
| T-05  | runtime با direct DB credential       | credential PostgreSQL فقط در Core/API؛ شبکهٔ runtime private و adapter-based             | image و env runtime فاقد DATABASE_URL هستند                       |
| T-06  | replay یا جعل callback                | HMAC، timestamp window، nonce/idempotency، correlation ID و secret rotation              | callback تکراری یا امضای غلط state را تغییر نمی‌دهد               |
| T-07  | duplicate submission                  | idempotency key با scope و نتیجهٔ ذخیره‌شده                                              | retry همان submission یک Run جدید ناخواسته نمی‌سازد               |
| T-08  | status spoofing یا terminal mutation  | Core transition table و terminal immutability را enforce کند                             | worker نمی‌تواند succeeded را به failed دلخواه تبدیل کند          |
| T-09  | prompt/tool injection                 | مدل فقط typed context و allowlisted tools می‌گیرد؛ دادهٔ خام instruction محسوب نمی‌شود   | متن فرم نمی‌تواند tool جدید یا policy را فعال کند                 |
| T-10  | side effect بدون approval در OpenClaw | action registry، approval token، expiry، timeout، retry policy و private gateway         | action حساس بدون approval هیچ request بیرونی نمی‌فرستد            |
| T-11  | memory poisoning                      | candidate/pending_review از retrieval حذف؛ provenance و review/promotion اجباری          | claim unreviewed در context مدل ظاهر نمی‌شود                      |
| T-12  | cross-tenant retrieval                | permission و scope قبل از full-text/similarity اعمال شود                                 | query مشابهی از tenant دیگر نتیجه نمی‌دهد                         |
| T-13  | نشت secret در log/artifact            | redaction برای token، cookie، PII و connector payload؛ access policy برای artifact       | fixture دارای secret در log و download خام دیده نمی‌شود           |
| T-14  | payload بزرگ یا DoS                   | body limit، rate limit، timeout، bounded retries و queue backpressure                    | ورودی oversized با 413 و بدون worker execution رد می‌شود          |
| T-15  | migration destructive یا نیمه‌کاره    | ordered migration، transaction، checksum و backup قبل از release                         | clean DB و restart idempotent و checksum mismatch fail-fast هستند |
| T-16  | failure خاموش                         | error envelope typed، status mapping، no `                                               |                                                                   | true` و no success fallback | failure worker در UI failed و قابل‌ردیابی است |
| T-17  | artifact private link leakage         | object key opaque، signed URL کوتاه‌عمر و permission recheck                             | actor خارج از scope download نمی‌کند                              |
| T-18  | audit tampering                       | audit append-only، actor/correlation/IP policy و retention مستند                         | update/delete مستقیم audit از API ممکن نیست                       |
| T-19  | supply-chain و secret در CI           | lockfile، pinned actions، secretهای GitHub، least privilege و محیط protected             | build بدون token چاپ‌شده و با dependency lock اجرا می‌شود         |
| T-20  | DNS/public exposure پیش از hardening  | raw header Core public نشود؛ staging private/controlled تا auth و tests کامل شود         | release gate deploy عمومی را تا evidence لازم مسدود می‌کند        |

## سیاست‌های اجرایی

### Identity و authorization

Session edge باید actor را تعیین کند و Core از membership رکورد فعال برای organization/workspace استفاده نماید. هیچ `organizationId` یا `workspaceId` ارسالی از client به‌تنهایی trust نمی‌شود. هر repository method باید یک scoped context اجباری بگیرد تا query بدون scope از نظر type یا review دشوار باشد.

### Runtime و callback

Native Worker و adapterها فقط event/result contractهای versionدار ارسال می‌کنند. callback پس از اعتبارسنجی HMAC، timestamp و idempotency پذیرفته می‌شود. Core باید correlation ID را به ProcessRun، OperationalEvent، Artifact، SemanticRecord و AuditEvent پیوند دهد. failure، timeout و unavailable باید به state صادقانه تبدیل شوند؛ fallback خاموش ممنوع است.

### حافظه و retrieval

SemanticRecord و KnowledgeClaim با evidence و provenance ثبت می‌شوند. Review و promotion یک transition کنترل‌شده هستند. Governed Retrieval ابتدا tenant، permission، scope، audience، status و validity را اعمال می‌کند و بعد full-text یا similarity را اجرا می‌نماید. هیچ embedding یا ranking نمی‌تواند deny را override کند.

### OpenClaw

هر action به registry با `actionType`، input schema، risk level، approval requirement و timeout متصل است. action read-only می‌تواند policy ساده‌تری داشته باشد، اما write/side-effect همیشه approval و expiry دارد. نتیجهٔ action باید idempotent، auditشده و به ProcessRun متصل باشد.

## حوادث و پاسخ

در صورت تشخیص cross-tenant leak، secret exposure، callback forgery یا unauthorized side effect، publication و connector مربوطه متوقف می‌شود، sessionها و signing keyهای درگیر rotate می‌شوند، audit و correlation trail حفظ می‌گردد و artifactهای عمومی revoke می‌شوند. هیچ cleanupی نباید evidence لازم برای تحلیل حادثه را حذف کند. restore از backup فقط پس از تعیین revision و validation انجام می‌شود.

## Release gates امنیتی

هیچ public deploymentی پیش از وجود session/auth واقعی، membership authorization، negative isolation tests، migration smoke، callback verification، redaction test، artifact permission test و staging rollback evidence مجاز نیست. raw tenant-header bootstrap در محیط public یک blocker قطعی است.

## منابع

[1]: ./MVP_CHARTER_FA.md 'MVP Charter Casioplus'
[2]: ./CORE_SELECTION_ADR_FA.md 'Core Selection ADR'
[3]: https://owasp.org/www-project-application-security-verification-standard/ 'OWASP Application Security Verification Standard'
[4]: https://owasp.org/www-project-api-security/ 'OWASP API Security Project'
