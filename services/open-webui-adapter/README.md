# Open WebUI Adapter

این adapter مسیر interaction/model plane را به Core/API فراهم می‌کند. تمام درخواست‌ها باید identity mapping، HMAC، timestamp، replay protection، allowlisted typed tools و redaction داشته باشند. Open WebUI و مدل‌ها به PostgreSQL یا secret خام دسترسی ندارند و وضعیت unavailable نباید به‌عنوان موفقیت جعل شود.
