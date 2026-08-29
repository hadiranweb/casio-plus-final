# Native Diagnosis Worker

این worker منطق اولین Golden Flow را اجرا می‌کند: دریافت input معتبر، تحلیل عارضه‌یابی، تولید structured output و ارسال RuntimeEvent/WorkCommit به Core/API. Worker هیچ direct PostgreSQL credential ندارد و فقط از contractهای versioned و endpointهای authenticated استفاده می‌کند.
