# قرارداد CI/CD و Promotion کاسیو پلاس

**نویسنده:** Manus AI

**وضعیت:** Provider-neutral و non-deploying تا تصمیم زیرساخت

## اصل

GitHub source of truth کد و release evidence است. build روی سرور production مجاز نیست. هر release از SHA مشخص ساخته، با image digest immutable ثبت و ابتدا در staging اجرا می‌شود. workflow فعلی [`Prepare Casioplus Release Candidate`](../.github/workflows/release-candidate.yml) فقط validation و artifact evidence تولید می‌کند و مقدار `deploymentPerformed: false` را ثبت می‌نماید؛ هیچ provider، DNS، database یا runtime واقعی را تغییر نمی‌دهد.

GitHub Environment می‌تواند approval، branch/tag restriction و secretهای محیط را اعمال کند، اما دسترس‌پذیری برخی protectionها برای repository خصوصی به plan حساب وابسته است.[1] تا زمان فعال‌شدن protection کامل، کنترل جبرانی عبارت است از workflow دستی provider-neutral، CI سبز روی همان SHA، review صریح کاربر و ثبت release evidence.

## Pipeline اجباری

| مرحله      | گیت                                                                            |
| ---------- | ------------------------------------------------------------------------------ |
| Source     | format، typecheck، topology constitution و repository security                 |
| Dependency | Critical/High صفر و Moderate فقط با waiver معتبر و منقضی‌نشده                  |
| Data       | migration روی PostgreSQL خالی، checksum ledger و integration test واقعی        |
| Product    | build Console/Forge/Core/Worker/Dispatcher/adapterها و performance budgets     |
| Workflow   | import واقعی n8n با image pin‌شده                                              |
| UX         | Golden Flow، accessibility شش‌حالته و Remix SSR smoke                          |
| Runtime    | Compose contract و image build همهٔ واحدهای production                         |
| Evidence   | SHA، workflow run، target intended، gate status و `deploymentPerformed: false` |

## Promotion پس از انتخاب provider

| گذار                | شرط                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------- |
| SHA → Candidate     | CI و release-candidate workflow روی همان SHA سبز باشد.                                |
| Candidate → Staging | secret injection، PostgreSQL، object storage، DNS sandbox و observability آماده باشد. |
| Staging → Canary    | پنج Golden Flow، negative tenant tests، restore drill و rollback rehearsal موفق باشد. |
| Canary → Production | تأیید صریح کاربر، image digest، schema state، alert و rollback pointer ثبت شده باشد.  |

workflow استقرار واقعی فقط پس از انتخاب provider ایجاد می‌شود و باید این ورودی‌ها را بگیرد: environment، candidate SHA، image digest map، migration mode و approval reference. workflow نباید image را دوباره بسازد و نباید secret را در log یا artifact چاپ کند.

## Environment contract

| محیط       | کاربرد                      | داده                         | runtime بیرونی                      |
| ---------- | --------------------------- | ---------------------------- | ----------------------------------- |
| CI         | validation deterministic    | PostgreSQL disposable        | n8n import؛ بدون credential واقعی   |
| Staging    | اثبات topology و operations | دادهٔ مصنوعی یا پاک‌سازی‌شده | credential و channel آزمایشی محدود  |
| Production | workload واقعی              | دادهٔ canonical              | allowlist، approval و metering فعال |

staging و production نباید database، bucket، secret namespace یا runtime datastore مشترک داشته باشند. Console و Forge فقط از Core همان محیط استفاده می‌کنند و adapterها هیچ‌گاه `DATABASE_URL` canonical دریافت نمی‌کنند.

## Rollback

Rollback application با بازگرداندن image digest قبلی انجام می‌شود. migrationهای canonical append-only هستند؛ down migration خودکار ندارند. در failure ناسازگار با schema، traffic write و Dispatcher متوقف و forward fix یا PITR طبق [`BACKUP_RESTORE_ROLLBACK_RUNBOOK_FA.md`](BACKUP_RESTORE_ROLLBACK_RUNBOOK_FA.md) اجرا می‌شود.

Docker برای production استفاده از configuration جدا، حذف bind mount کد، restart policy، logging و rebuild image در تغییر را توصیه می‌کند.[2] جزئیات تصمیم provider و خط توقف در [`PRODUCTION_DEPLOYMENT_DECISION_PACKET_FA.md`](PRODUCTION_DEPLOYMENT_DECISION_PACKET_FA.md) آمده است.

## References

[1]: https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments 'GitHub Deployments and Environments'
[2]: https://docs.docker.com/compose/how-tos/production/ 'Docker — Use Compose in production'
