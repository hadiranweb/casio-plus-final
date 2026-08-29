# واژه‌نامهٔ دامنهٔ Casioplus

این واژه‌نامه مرجع نام‌گذاری API، database، قراردادهای Zod، UI و مستندات Casioplus است. اصطلاحات GitHub فقط برای توضیح analogy در متن محصول مجازند و نباید به entityهای canonical تبدیل شوند.

## مفاهیم هویتی و سازمانی

| اصطلاح canonical | تعریف عملیاتی                                                    | نکتهٔ امنیتی                               |
| ---------------- | ---------------------------------------------------------------- | ------------------------------------------ |
| `Organization`   | مرز مالکیت و حکمرانی یک مجموعهٔ مستقل                            | parent scope برای workspace و memory       |
| `Workspace`      | فضای کاری محدودشده برای Flow، Work و Memory                      | هر query باید workspace را بررسی کند       |
| `Actor`          | انسان، سرویس runtime، agent یا collaborator که عملی انجام می‌دهد | actor از session و service identity می‌آید |
| `Membership`     | رابطهٔ Actor با Organization/Workspace و role آن                 | role باید در سرور enforce شود              |
| `Role`           | مجوز سطح‌دار مانند owner، admin، author، reviewer یا participant | نام UI مجوز اجرای policy نیست              |
| `Publication`    | نمای قابل‌مصرف از FlowVersion منتشرشده برای audience مشخص        | draft و secret داخلی را پنهان می‌کند       |

## مفاهیم کار و فرایند

| اصطلاح canonical     | تعریف عملیاتی                                              | تفاوت کلیدی                                     |
| -------------------- | ---------------------------------------------------------- | ----------------------------------------------- |
| `WorkItem`           | مسئله، درخواست، هدف یا واحد کاری قابل‌پیگیری               | خودِ Flow یا Run نیست                           |
| `FlowDefinition`     | تعریف versionable روش جمع‌آوری، پردازش و ارائهٔ نتیجه      | template اجرایی است، نه یک اجرای واقعی          |
| `FlowVersion`        | snapshot immutable و قابل‌اجرا از Definition               | هر Run دقیقاً به یک version متصل است            |
| `ProcessRun`         | یک اجرای واقعی و قابل‌ردیابی از FlowVersion                | lifecycle و terminal state مستقل دارد           |
| `RuntimeEvent`       | eventی که runtime دربارهٔ پیشرفت یا نتیجه می‌فرستد         | منبع حقیقت Run نیست؛ Core آن را validate می‌کند |
| `Artifact`           | فایل یا payload قابل‌مصرف مانند JSON، HTML یا PDF          | artifact به‌تنهایی memory نیست                  |
| `EvidenceSource`     | input، artifact، run، سند یا منبعی که ادعا به آن اتکا دارد | برای provenance لازم است                        |
| `Policy`             | قواعد اجرای Flow، exposure، capture، review یا action      | policy با prompt یکسان نیست                     |
| `ConnectorReference` | اشارهٔ امن و غیرمحرمانه به یک connector یا runtime binding | secret خام هرگز در domain record نیست           |

## مفاهیم حافظه و دانش

| اصطلاح canonical           | تعریف عملیاتی                                                           | وضعیت مجاز                                     |
| -------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------- |
| `ExecutionContext`         | context موقت یک session یا Run                                          | retention محدود؛ memory نیست                   |
| `OperationalEvent`         | trace خام UI، Core یا Runtime برای audit/replay                         | می‌تواند پرحجم باشد و دانش نیست                |
| `SemanticRecord`           | checkpoint immutable از observation، decision، result یا output معنادار | پس از capture rule تولید می‌شود                |
| `EpisodicRecord`           | روایت ساختاریافتهٔ یک Work/Run با context و outcome                     | reusable candidate، نه fact قطعی               |
| `KnowledgeClaim`           | گزارهٔ قابل‌بررسی استخراج‌شده از evidence یا execution                  | تا review candidate است                        |
| `KnowledgeReview`          | تصمیم human/authorized agent دربارهٔ claim یا record                    | approve، reject، correct یا supersede          |
| `KnowledgePromotion`       | ثبت انتقال یک candidate معتبر به memory item                            | mutation کنترل‌شده و auditشده                  |
| `VerifiedFact`             | واقعیت تأییدشده با evidence، scope و validity                           | قابل‌استفاده در retrieval مجاز                 |
| `OperationalProcedure`     | دستورالعمل تأییدشده برای انجام کار در شرایط مشخص                        | باید version و owner داشته باشد                |
| `GovernedDecision`         | تصمیم دارای rationale، actor، evidence و اعتبار زمانی                   | قابل‌اصلاح از طریق lineage است                 |
| `PolicyRule`               | قاعدهٔ سازمانی که execution یا retrieval را محدود می‌کند                | می‌تواند deny یا require-review باشد           |
| `ValidatedPattern`         | الگوی تکرارشونده با شواهد outcome و validation                          | تا زمانی که supersede نشده معتبر است           |
| `OrganizationalMemoryItem` | واحد reusable دانش سازمانی تأییدشده و scopeدار                          | تنها لایهٔ memory معتبر برای retrieval سازمانی |
| `KnowledgeRelation`        | رابطهٔ typed مانند supports، derived_from، supersedes یا contradicts    | رابطه باید tenant-scoped باشد                  |
| `Provenance`               | زنجیرهٔ actor، source، process، زمان و transformation                   | برای explainability و audit اجباری است         |
| `GovernedRetrieval`        | retrieval پس از permission، scope، validity، freshness و explanation    | similarity هرگز اولین فیلتر نیست               |

## وضعیت‌ها و lifecycle

`ProcessRun` از `queued` به `running` و سپس یکی از `succeeded`، `failed`، `cancelled` یا `expired` می‌رود. بعد از terminal state، تغییر مستقیم مجاز نیست و correction با event یا record جدید انجام می‌شود.

`KnowledgeClaim` از `candidate` به `pending_review` و سپس `approved`، `rejected`، `corrected` یا `superseded` می‌رود. فقط claim approved که با `KnowledgePromotion` و provenance کامل ثبت شده، می‌تواند به `OrganizationalMemoryItem` منتهی شود.

`OrganizationalMemoryItem` می‌تواند `published`، `superseded` یا `deprecated` شود. deprecated یا superseded item نباید بدون policy صریح در Governed Retrieval ظاهر شود.

## واژه‌های ممنوع یا محدود

| اصطلاح ممنوع/محدود           | جایگزین canonical                       | دلیل                                      |
| ---------------------------- | --------------------------------------- | ----------------------------------------- |
| Branch                       | FlowVersion یا lineage                  | مدل Git branching برای دامنه لازم نیست    |
| Pull Request                 | KnowledgeReview یا PublicationReview    | review دامنه‌ای با PR یکی نیست            |
| Merge                        | KnowledgePromotion یا supersession      | دو شاخهٔ source code نداریم               |
| Repository                   | Organization، Workspace یا Flow Catalog | storage و domain model متفاوت‌اند         |
| Commit به‌عنوان entity حافظه | SemanticRecord یا outcome snapshot      | Commit فقط برچسب تعاملی محدود است         |
| Agent memory بدون scope      | OrganizationalMemoryItem                | memory باید governed و tenant-scoped باشد |
| RAG chunk                    | SemanticRecord یا EvidenceSource        | chunk فنی، نوع دانش نیست                  |
| Runtime owner                | Core/API                                | runtime فقط executor و event producer است |

## قاعدهٔ استفاده در کد و UI

نام class، table، endpoint و schema باید از ستون canonical استفاده کند. اگر در UI از «ثبت نتیجه» یا «نسخهٔ کاری» استفاده می‌شود، mapping آن به `SemanticRecord` و `FlowVersion` باید در copy یا documentation روشن باشد. هیچ alias تعاملی نباید در migration یا authorization boundary به entity جدید تبدیل شود.

## منابع

[1]: ./MVP_CHARTER_FA.md 'MVP Charter Casioplus'
[2]: ./MEMORY_TAXONOMY_FA.md 'Memory Taxonomy Casioplus'
[3]: https://cacm.acm.org/research/reexamining-organizational-memory/ 'Reexamining Organizational Memory — Communications of the ACM'
