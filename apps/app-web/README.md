# Casioplus App

این package سطح مصرف و عملیات Casioplus است و در `app.casioplus.com` ارائه می‌شود. مسئولیت‌های آن شامل Account/Organization/Workspace، Work Board، فهرست publicationهای مجاز، اجرای Flow منتشرشده، ProcessRun history، Review Inbox، Artifact download و Memory View است.

App نباید draft Flow، connector secret، prompt داخلی، policy runtime یا مستقیم PostgreSQL را ببیند. تمام mutationها و queryهای canonical از Core/API عبور می‌کنند.
