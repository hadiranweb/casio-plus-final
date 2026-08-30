# Runbook پشتیبان‌گیری، بازیابی و Rollback کاسیو پلاس

**نویسنده:** Manus AI

**وضعیت:** قرارداد provider-neutral؛ اجرای واقعی پس از انتخاب زیرساخت

**دامنه:** PostgreSQL canonical، object storage و stateهای داخلی n8n، Open WebUI و OpenClaw

## اصل بازیابی

PostgreSQL تنها canonical store است. runtimeهای n8n، Open WebUI و OpenClaw state عملیاتی خود را جدا نگه می‌دارند، اما هیچ‌کدام مرجع Organization، Workspace، Flow، ProcessRun، حافظه، approval، artifact metadata یا usage نیستند. بنابراین ترتیب بازیابی همیشه از canonical data آغاز می‌شود و سپس runtime state با همان release candidate هم‌راستا می‌گردد.

PostgreSQL برای Point-in-Time Recovery به base backup و آرشیو پیوستهٔ WAL متکی است و رویهٔ recovery باید پیش از اتکا به آن آزمایش شود.[1] مقدارهای RPO و RTO در این سند hard-code نمی‌شوند؛ پس از restore drill روی staging اندازه‌گیری و به‌عنوان SLO عملیاتی ثبت خواهند شد.

## موجودی persistence

| داده               | مالک                             | محل                         | روش backup                                          | اولویت restore |
| ------------------ | -------------------------------- | --------------------------- | --------------------------------------------------- | -------------: |
| دادهٔ canonical    | Core/API                         | PostgreSQL مدیریت‌شده       | base backup، WAL/PITR و snapshot provider           |              1 |
| artifact byte      | Core/API metadata + object store | bucket خصوصی S3-compatible  | versioning، replication یا provider snapshot        |              2 |
| n8n metadata       | n8n                              | volume `n8n-runtime-db`     | dump سازگار PostgreSQL یا volume snapshot           |              3 |
| n8n local state    | n8n                              | volume `n8n-data`           | volume snapshot همراه encryption key reference      |              4 |
| Open WebUI state   | Open WebUI                       | volume `open_webui_data`    | volume snapshot                                     |              4 |
| OpenClaw state     | OpenClaw                         | volume `openclaw_state`     | volume snapshot همراه config و credential reference |              4 |
| OpenClaw workspace | OpenClaw                         | volume `openclaw_workspace` | volume snapshot                                     |              5 |

Secretها داخل backup داده قرار نمی‌گیرند. secret manager باید lifecycle مستقل creation، rotation، revocation و audit داشته باشد.[2] backup فقط reference و version secret را ثبت می‌کند و مقدار secret از مسیر recovery مجاز دوباره تزریق می‌شود.

## گیت پشتیبان‌گیری

قبل از هر deployment، migration، runtime upgrade یا credential rotation باید این evidence ثبت شود:

| گیت                      | معیار پذیرش                                                                 |
| ------------------------ | --------------------------------------------------------------------------- |
| PostgreSQL restore point | timestamp، backup identifier و آخرین WAL قابل دسترس ثبت شده باشد.           |
| Object storage           | versioning و lifecycle روشن باشد و delete marker آزمایشی قابل بازیابی باشد. |
| Runtime volume           | snapshot هر volume stateful با image digest runtime جفت شده باشد.           |
| Secret references        | version/reference فعال بدون نمایش مقدار ثبت شده باشد.                       |
| Release pointer          | SHA و image digest فعلی و candidate ثبت شده باشند.                          |
| Outbox state             | تعداد pending، inflight و dead-letter قبل از تغییر ثبت شده باشد.            |
| Action plane             | OpenClaw ابتدا disable و target credential قابل revoke باشد.                |

## Restore drill در staging

1. یک محیط بازیابی کاملاً جدا ایجاد می‌شود؛ production database هرگز target آزمون نیست.
2. PostgreSQL به restore point منتخب بازگردانده و migration ledger و checksumها بررسی می‌شوند.
3. Core با Dispatcher و runtimeها خاموش اجرا و health و queryهای read-only بررسی می‌شود.
4. invariantهای tenant isolation، active Workspace membership، nonce replay، idempotency، approval و usage immutability اجرا می‌شوند.
5. bucket به namespace آزمایشی mount و تطابق metadata با object key، hash و retention بررسی می‌شود.
6. runtime volumeها با image digest متناظر بازیابی می‌شوند؛ هیچ workflow یا action هنوز فعال نمی‌شود.
7. n8n workflow import می‌شود ولی inactive می‌ماند؛ Open WebUI فقط health/model allowlist و OpenClaw فقط gateway health را می‌گذراند.
8. پنج Golden Flow متوالی و negative testهای cross-tenant اجرا می‌شوند.
9. RPO و RTO واقعی از timestampها محاسبه و ثبت می‌شود.
10. محیط بازیابی پس از حفظ evidence نابود می‌شود.

## Rollback application

Rollback application با تغییر ingress یا deployment reference از candidate digest به **digest قبلی** انجام می‌شود. rebuild از branch یا tag مجاز نیست. Docker توصیه می‌کند production configuration از development جدا باشد، imageها در تغییر بازسازی شوند و restart/logging policy صریح باشد.[3]

| وضعیت                           | اقدام                                                                                                    |
| ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| failure قبل از migration        | candidate خاموش و digest قبلی restore می‌شود.                                                            |
| failure بعد از migration سازگار | digest قبلی فقط اگر schema backward-compatible است فعال می‌شود؛ در غیر این صورت forward fix اجرا می‌شود. |
| corruption یا destructive bug   | write traffic و Dispatcher متوقف، runtimeها disable و PITR روی محیط جدا بررسی می‌شود.                    |
| duplicate integration delivery  | Dispatcher متوقف؛ idempotency، nonce و outbox ledger حفظ و مقصد خارجی reconcile می‌شود.                  |
| action incident                 | OpenClaw adapter و Gateway disable، target credential revoke و approval/execution audit بررسی می‌شود.    |
| model incident                  | Open WebUI adapter disable و runtime meter binding غیرفعال می‌شود؛ Core و حافظه مستقل ادامه می‌دهند.     |
| n8n incident                    | workflow deactivate و destination dispatch متوقف می‌شود؛ outbox حذف نمی‌شود.                             |

Down migration خودکار برای schema canonical وجود ندارد. migrationها append-only هستند. اصلاح schema با forward migration انجام می‌شود مگر اینکه Incident Commander، data owner و operator با evidence restore تصمیم دیگری بگیرند.

## اعتبارسنجی پس از restore

| حوزه       | بررسی                                                                 |
| ---------- | --------------------------------------------------------------------- |
| Identity   | sessionهای مورد انتظار، revocation، cookie/CSRF و context server-side |
| Tenant     | Organization/Workspace membership و RLS/authorization negative tests  |
| Gateway    | key metadata، nonce، idempotency و callback allowlist                 |
| Memory     | namespace، grant validity/revoke، promotion و access decision audit   |
| Artifact   | object existence، hash، size، retention و deletion propagation        |
| Usage      | append-only trigger، pricingVersion و تفکیک P&L/TCO                   |
| Runtime    | image digest، workflow version، model allowlist و OpenClaw target map |
| Operations | health، logs، metrics، alerts و rollback pointer                      |

## مالکیت و ثبت incident

در staging نقش‌ها می‌توانند روی یک operator محدود جمع شوند، اما در production باید دست‌کم owner تصمیم، operator اجرا و reviewer evidence مشخص باشند. هر restore یا rollback باید شناسهٔ incident، timestamp، release SHA، backup ID، restore point، measured RPO/RTO، تصمیم و نتیجهٔ validation داشته باشد.

## References

[1]: https://www.postgresql.org/docs/current/continuous-archiving.html 'PostgreSQL Continuous Archiving and Point-in-Time Recovery'
[2]: https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html 'OWASP Secrets Management Cheat Sheet'
[3]: https://docs.docker.com/compose/how-tos/production/ 'Docker — Use Compose in production'
