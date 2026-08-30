# یافته‌های بازبینی بصری مرحلهٔ ۱۶

## Checkpoint ۱ — Console authenticated

در viewport دسکتاپ، سلسله‌مراتب Console حفظ شده و Governance Control پس از کنترل سازمان و Integration Gateway در همان سطح اصلی صفحه قرار گرفته است. سه lane مجزای **Approval Inbox**، **Action targets و policy** و **Runtime metering و economics** بدون کارت‌های تزئینی تو‌در‌تو نمایش داده می‌شوند. تمام مقدارهای اقتصادی در Organization تازه به‌درستی `—` هستند و هیچ metric ساختگی نمایش داده نمی‌شود.

ثبت‌نام Organization و Workspace disposable پس از استفاده از `CORS_ORIGINS` رسمی repository موفق بود. session در cookie باقی ماند و route اصلی، scope و role را از Core نشان داد. کنترل‌های target، policy، planning assumption و meter binding فقط برای role مدیریتی ظاهر شدند؛ Approval Inbox مستقل و default-deny باقی ماند.

در screenshot اولیه، header و summary بالای صفحه خوانا هستند و اضافه‌شدن panel جدید initial hierarchy را تغییر نداده است. برای حکم نهایی هنوز لازم است ایجاد planning assumption، binding، target و policy، مسیر Forge Run Control، approval decision، responsive state و accessibility شش‌حالته اجرا شوند.

## Checkpoint ۲ — فرم‌های Governance

در viewport دسکتاپ، پنل سه‌ستونه بدون overflow افقی نمایش داده شد. Approval Inbox در سمت راست، policy در میانه و economics در سمت چپ خوانا هستند. فرم‌های target و planning assumption با state واقعی پر شدند؛ دکمه‌های ثبت تنها با دادهٔ لازم فعال شدند و meter binding تا وجود pricing version فعال fail-closed باقی ماند. اکنون باید submitها، refresh state و ارتباط آن‌ها با Forge بررسی شود.

## Checkpoint ۳ — Action target

انتخاب status فعال برای planning assumption و ثبت target `operations-primary` از Console انجام شد. target پس از refresh داخلی با status `active` و executor reference سروری نمایش داده شد و انتخاب‌گر policy فقط پس از persistence واقعی آن فعال شد. فرم target پس از موفقیت پاک شد و notice مستقل ثبت گردید؛ هیچ secret یا مقصد اجرایی خام در Console نگه‌داری نشد.

## Checkpoint ۴ — Planning assumption

Planning assumption با key و version صریح، status فعال و JSON ثبت‌شده از Console persisted شد و در فهرست نسخه‌ها ظاهر گردید. انتخاب‌گر runtime metering تنها نسخهٔ active را ارائه کرد و شناسهٔ pricingVersion از پاسخ سرور استفاده شد. مقدارها planning-only هستند و UI آن‌ها را به‌عنوان price list یا قیمت hard-coded معرفی نمی‌کند.

## Checkpoint ۵ — Runtime meter binding

فرم meter binding برای runtime مدل با resource key نسخهٔ منتشرشونده و نرخ‌های input/output token بر پایهٔ pricingVersion فعال تکمیل و submit شد. کنترل ثبت تا انتخاب pricingVersion و resource key فعال نبود. گام بعدی بررسی record persisted، ساخت Flow در Forge و اثبات fail-closed یا queue شدن اجرای واقعی است.

## Checkpoint ۶ — Meter binding و Forge Run Control

Meter binding با runtime `open-webui`، resource `casioplus-general`، pricingVersion فعال و payer مشخص persisted شد و با status `active` در Console نمایش داده شد. سپس Forge با همان cookie session باز شد. Run Control به‌صورت lazy در inspector ظاهر شد، در نبود version منتشرشده fail-closed ماند و پیام دقیق «ابتدا version را منتشر کنید» نمایش داد. initial workspace و hierarchy Forge تغییری نکرده است.

## Checkpoint ۷ — Flow creation در Forge

Flow با نام و key پایدار از Forge ثبت شد و بلافاصله در catalog و heading scope نمایش داده شد. version history و Run Control همچنان به‌درستی خالی و fail-closed ماندند. مسیر بعدی انتخاب Open WebUI، ثبت version immutable، انتشار و اجرای همان version فعال است.

## Checkpoint ۸ — Runtime definition gap و اصلاح

آزمون browser نشان داد runtime selector به‌تنهایی model یا target لازم برای اجرای Open WebUI/OpenClaw را در FlowVersion definition ثبت نمی‌کرد؛ بنابراین یک version می‌توانست منتشر شود ولی در execute fail شود. Forge اصلاح شد تا برای Open WebUI فیلدهای model، max tokens و system prompt اختیاری و برای OpenClaw target key اجباری داشته باشد. definition برای n8n و Native نیز صریح شد. format، typecheck، unit tests و build Forge پس از اصلاح موفق بودند. build جدید اکنون برای تکرار آزمون end-to-end فعال است.

## Checkpoint ۹ — Open WebUI definition

Build اصلاح‌شده فیلدهای model key، max tokens و system prompt اختیاری را فقط هنگام انتخاب Open WebUI نشان داد. قرارداد ورودی با `prompt` اجباری تعریف شد و یادداشت version ثبت گردید. layout فیلدهای runtime در desktop بدون overlap و با focus hierarchy موجود Forge نمایش داده شد. اکنون version immutable و publication boundary باید آزمون شوند.

## Checkpoint ۱۰ — Version و انتشار

FlowVersion v1 با definition کامل Open WebUI و schema ورودی typed به‌صورت immutable ساخته و سپس منتشر شد. history، runtime label و status فعال از Core refresh شدند. Run Control فقط پس از publication ظاهر شد و اکنون Work title، intent و input JSON را برای اجرای version فعال دریافت می‌کند.

## Checkpoint ۱۱ — ProcessRun Open WebUI

Run Control یک Work واقعی با input منطبق بر schema ایجاد کرد و execution version منتشرشده را از Core درخواست داد. ProcessRun با status `running` ثبت و پیام UI صریحاً اعلام کرد که queue و result فقط از ledger canonical خوانده می‌شوند. در محیط disposable عمداً Dispatcher و Open WebUI runtime اجرا نشده‌اند؛ بنابراین توقف run در `running` مرز درست پیش از deployment است، نه موفقیت ساختگی. outbox و runtime completion پیش‌تر در integration testهای PostgreSQL و adapter testها پوشش دارند.

## Checkpoint ۱۲ — OpenClaw definition

برای OpenClaw، Forge فقط target key server-resolved و schema ورودی `message` را درخواست کرد و توضیح داد target و policy باید در Console ثبت شوند. action در definition به `send_message` محدود است و target key با target فعال مرحلهٔ QA هم‌راستا شد. اکنون version دوم برای آزمون policy و approval ساخته می‌شود.

## Checkpoint ۱۳ — OpenClaw version و Console handoff

FlowVersion v2 با runtime `openclaw` و target key معتبر ساخته شد و در حالت unpublished باقی ماند. بازگشت به Console نشان داد Flow در policy selector موجود است، target فعال persisted است و run قبلی Open WebUI در Work queue و Run Timeline با وضعیت واقعی `running` نمایش داده می‌شود. برای ادامه باید v2 در policy selector انتخاب، policy ثبت، meter binding OpenClaw فعال و سپس v2 منتشر شود.

## Checkpoint ۱۴ — Governance composition پس از ایجاد Flow

پس از بازگشت از Forge، Console run در حال اجرای Open WebUI را در Decision Queue و Run Timeline نشان داد. در پایین صفحه، Governance Control با Flow تازه و target فعال refresh شد. چیدمان سه lane در viewport دسکتاپ فشرده اما بدون overflow است؛ فرم policy هنوز تا انتخاب FlowVersion غیرفعال است و Approval Inbox صفر باقی مانده است.

## Checkpoint ۱۵ — Policy scope

Console پس از انتخاب Flow فقط versionهای OpenClaw آن Flow را بارگذاری کرد و v2 انتخاب شد. target و risk جدا باقی مانده‌اند و policy هنوز submit نشده است. این رفتار از اتصال اتفاقی policy به version مدل یا runtime دیگری جلوگیری می‌کند.

## Checkpoint ۱۶ — OpenClaw policy

Policy v2 با target فعال و risk `medium` ثبت شد. record persisted با Flow/version/target/status نمایش داده شد و endpoint آن را `approval-required` اعلام کرد. policy فقط پس از انتخاب Flow، version OpenClaw و target فعال قابل submit بود؛ بازنشستگی نیز به‌عنوان lifecycle fail-closed در همان فهرست موجود است.

## Checkpoint ۱۷ — OpenClaw metering setup

Runtime `openclaw` و resource `send_message` در meter form انتخاب شدند و direct unit cost برنامه‌ریزی وارد شد. binding هنوز submit نشده و تا انتخاب pricingVersion فعال fail-closed باقی مانده است. policy v2 در همان panel با status active قابل مشاهده است.

## Checkpoint ۱۸ — OpenClaw meter binding

Meter binding برای `openclaw / send_message` با pricingVersion فعال و direct unit cost برنامه‌ریزی از Console submit شد. این binding مستقل از binding مدل است و هزینهٔ action را به resource، runtime، payer و pricingVersion متصل می‌کند. پیش از انتشار v2 باید record persisted بررسی شود.

## Checkpoint ۱۹ — آمادگی انتشار OpenClaw

OpenClaw meter binding با status active در Console تأیید شد و binding قبلی Open WebUI مستقل باقی ماند. Forge پس از بازگشت، v2 را unpublished و v1 را active نشان داد؛ بنابراین انتشار هنوز مرز صریح review است و policy/metering خارج از Forge تغییر نکرده‌اند.

## Checkpoint ۲۰ — انتشار و ورودی OpenClaw

پس از تکمیل policy و metering، v2 منتشر و v1 از حالت active خارج شد. Run Control به‌صورت خودکار input template را به `{ "message": "" }` تغییر داد. Work، intent و پیام QA تکمیل شدند؛ هنوز هیچ action اجرا نشده و submit باید صرفاً approval request بسازد.

## Checkpoint ۲۱ — Approval Inbox

درخواست اجرای OpenClaw از Forge هیچ side effectی ایجاد نکرد؛ ProcessRun در `queued` ماند و پیام UI صریحاً انتظار تصمیم انسانی را اعلام کرد. Console درخواست را با target، risk، payload قابل بازبینی و مهلت اعتبار نمایش داد. Approval Inbox count از صفر به یک تغییر کرد و دکمه‌های تأیید/رد همراه با reason اجباری در اختیار owner قرار گرفتند.

## Checkpoint ۲۲ — تصمیم انسانی

Reason اجباری در Approval Inbox وارد و درخواست در محیط disposable محلی تأیید شد؛ هیچ OpenClaw runtime یا کانال خارجی متصل نبود. درخواست بلافاصله از صف pending حذف و notice صریح نمایش داده شد که execution همچنان فقط از Core انجام می‌شود. ProcessRun خودکار dispatch نشد و برای ادامه به اقدام صریح Forge نیاز دارد.

## Checkpoint ۲۳ — ادامهٔ execution پس از approval

Forge پس از بازگشت همچنان run را `queued` و دارای کنترل «ادامهٔ اجرا» نشان داد؛ تصمیم انسانی به‌تنهایی dispatch انجام نداد. با اقدام صریح کاربر، request پذیرفته شد و outbox برای OpenClaw آماده شد، اما چون Dispatcher و runtime در محیط disposable اجرا نبودند، هیچ side effect خارجی رخ نداد و وضعیت به‌درستی queued ماند. این رفتار سه مرز publish، approval و dispatch را از هم جدا نگه می‌دارد.

## Checkpoint ۲۴ — defect در continuation

پس از انتظار و refresh، run همچنان `queued` باقی ماند. بررسی database متصل به Core نشان داد approval برابر `approved` است اما هنوز رکوردی در `integration_outbox` ساخته نشده است. console مرورگر نیز خطای JavaScript ثبت نکرد. بنابراین نتیجهٔ checkpoint ۲۳ اصلاح می‌شود: کلیک اولیه continuation به Core نرسیده یا handler UI اجرا نشده است و این مسیر قبل از freeze باید با آزمون مستقیم و رفع علت دوباره اثبات شود.

## Checkpoint ۲۵ — بستن defect موقت continuation

بررسی نهایی نشان داد کنترل React سالم است و failure اولیه از click harness مرورگر ناشی شده بود. فراخوانی مستقیم همان button، Core را اجرا کرد؛ database وضعیت run را `running`، approval را `approved` و outbox را `pending` با destination `openclaw` و operation `action.send_message` ثبت کرد. Forge نیز notice موفق و حذف کنترل continuation را نمایش داد. بنابراین تغییر production برای این مورد لازم نیست.

## جمع‌بندی ممیزی طراحی مرحلهٔ ۱۶

ممیزی مستقل screenshotها دو پیشنهاد اصلی داد. ادعای رقابت دو primary action رد شد، زیرا authoring و execution در task boundaryهای جدا قرار دارند؛ فضای خالی Approval Inbox نیز state واقعی صفر درخواست بود و با درخواست pending به‌درستی پر شد. تکرار copy کاهش یافت و defect مهم‌تری که با source تأیید شد اصلاح گردید: Flow Map دیگر برای همهٔ runtimeها Review gate و Artifact را ثابت نشان نمی‌دهد و اکنون lifecycle واقعی Native، n8n، Open WebUI و OpenClaw را بازتاب می‌دهد. گیت ماشینی accessibility و performance پس از build نهایی دوباره اجرا خواهد شد.
