# منابع رسمی تصمیم استقرار

**نویسنده:** Manus AI  
**تاریخ بررسی:** ۳۰ اوت ۲۰۲۶

این سند فقط یافته‌های بیرونی مورد استفاده در `PRODUCTION_DEPLOYMENT_DECISION_PACKET_FA.md` را ثبت می‌کند.

| حوزه                         | یافتهٔ قابل استفاده                                                                                                                                                                                    | منبع                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| مدیریت secret                | OWASP بر تمرکز و استانداردسازی مدیریت secret، least privilege، automation برای rotation، ثبت audit و پوشش lifecycle شامل creation، rotation، revocation و expiration تأکید می‌کند.                     | [OWASP Secrets Management Cheat Sheet][1]     |
| PostgreSQL recovery          | مستندات PostgreSQL توضیح می‌دهد که ترکیب base backup و آرشیو پیوستهٔ WAL امکان Point-in-Time Recovery را فراهم می‌کند و روی تست‌کردن رویهٔ archive/recovery پیش از اتکا به آن تأکید دارد.              | [PostgreSQL Continuous Archiving and PITR][2] |
| Docker Compose production    | Docker توصیه می‌کند production override جداگانه داشته باشد، bind mount کد حذف شود، environment و portها production-specific باشند، restart policy و logging لحاظ شوند و image هنگام تغییر بازسازی شود. | [Docker: Use Compose in production][3]        |
| GitHub deployment governance | GitHub environmentها می‌توانند approval، wait timer، branch/tag restriction و environment secret فراهم کنند؛ availability برخی protectionها برای repository خصوصی به plan حساب وابسته است.             | [GitHub Deployments and Environments][4]      |

## References

[1]: https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html 'OWASP Secrets Management Cheat Sheet'
[2]: https://www.postgresql.org/docs/current/continuous-archiving.html 'PostgreSQL Continuous Archiving and Point-in-Time Recovery'
[3]: https://docs.docker.com/compose/how-tos/production/ 'Docker — Use Compose in production'
[4]: https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments 'GitHub Deployments and Environments'
