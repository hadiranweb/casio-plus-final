# Open WebUI Runtime for Casioplus

این runtime فقط interaction/model plane است و از طریق Open WebUI adapter قابل دسترسی است. Compose هیچ پورت عمومی منتشر نمی‌کند، image را به `v0.11.1` pin می‌کند و state داخلی را در volume مستقل نگه می‌دارد. PostgreSQL canonical و credential آن نباید به هیچ سرویس این topology داده شوند.

## Bootstrap

پیش از startup، secretهای `OPEN_WEBUI_SECRET_KEY`، `OPEN_WEBUI_API_KEY` و `ADAPTER_SHARED_SECRET` باید از secret manager تزریق شوند. API key باید متعلق به service account اختصاصی non-admin باشد. `OPEN_WEBUI_ALLOWED_MODELS_JSON` باید دقیقاً با runtime meter bindingهای فعال در Core تطابق داشته باشد. شبکهٔ خارجی `casioplus-integration` باید پیش از اجرای Compose توسط deployment owner ایجاد شود.

## عملیات

پشتیبان‌گیری از volume `open_webui_data` پیش از هر upgrade الزامی است. upgrade فقط با تغییر version tag یا digest در pull request، اجرای testهای adapter و Golden Flow در staging و ثبت rollback pointer انجام می‌شود. tagهای rolling مانند `main`، `latest` و `dev` در production مجاز نیستند.
