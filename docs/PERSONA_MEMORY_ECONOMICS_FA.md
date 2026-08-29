# مدل اقتصادی پرسونا و حافظهٔ سازمانی Casioplus

**وضعیت:** مدل برنامه‌ریزی داخلی برای طراحی packaging، metering و unit economics
**تاریخ مبنا:** 2026-08-27
**واحد:** USD/month مگر آنکه خلاف آن ذکر شود
**قابلیت commercial:** فرضیه؛ نه price list، quote فروشنده، forecast فروش یا تعهد margin

## ۱. هدف و مرز مدل

این مدل economics را در دو محور مستقل ثبت می‌کند: **پرسونا/سطح مشتری** و **کانال مصرف**. فرد، تیم/استارتاپ و سازمان از یک App، Studio، Core/API، runtime boundary و Memory Control Plane استفاده می‌کنند. تفاوت اقتصادی باید از seat، workspace، ظرفیت، governance، حجم مصرف، SLA، سطح پشتیبانی و اتصال چندمحصولی بیاید؛ صرفاً برچسب «سازمان» نباید بدون ظرفیت یا سرویس متمایز قیمت را افزایش دهد.

بسته‌بندی پیشنهادی سه لایه دارد:

```text
Platform subscription
+ Memory entitlement / storage governance
+ Usage metering
```

`External Studio/Gateway` یک add-on یا capability قابل‌فعال‌سازی است و نباید با ساختن محصول یا Studio جداگانه پیاده شود. context مدل، retrieval overage، storage overage و external sync باید جداگانه قابل‌اندازه‌گیری باشند.

## ۲. پرسونا و ظرفیت استاندارد

| پرسونا        | تجربهٔ اصلی                                   | seat | workspace | حافظهٔ canonical | projection کاسیو |   audit | retrieval/month | write/month | promotion/month | context/retrieval |
| ------------- | --------------------------------------------- | ---: | --------: | ---------------: | ---------------: | ------: | --------------: | ----------: | --------------: | ----------------: |
| فرد / Solo    | App و Studio شخصی، self-service               |    1 |         1 |             1 GB |             1 GB | 0.25 GB |           2,000 |         300 |              20 |       1,500 token |
| تیم / Startup | همکاری، shared workspace و review پایه        |    5 |         2 |             5 GB |             6 GB |  0.5 GB |          10,000 |       1,500 |             100 |       2,000 token |
| سازمان        | چندتیمی، policy، audit، SLA و اتصال چند محصول |   25 |         5 |            20 GB |            24 GB |    1 GB |          30,000 |       5,000 |             500 |       2,500 token |

در مدل Hybrid، projection به‌ترتیب 0.5، 2 و 6 GB و sync ماهانه به‌ترتیب 300، 1,500 و 5,000 event فرض شده است. این مقادیر planning assumption هستند و تا زمان telemetry واقعی نباید quota قطعی یا تعهد SLA محسوب شوند.

## ۳. اجزای قیمت پیشنهادی سناریویی

| جزء                            | فرد | تیم/Startup | سازمان | توضیح                                            |
| ------------------------------ | --: | ----------: | -----: | ------------------------------------------------ |
| Platform fee                   | $19 |         $79 |   $299 | App و Studio control plane                       |
| Casio-managed Memory Add-on    |  $9 |         $39 |   $129 | ظرفیت، governance و operations                   |
| Hybrid Memory Add-on           | $15 |         $59 |   $199 | projection، remote retrieval و sync              |
| External Studio/Gateway add-on |  $0 |         $29 |    $99 | endpoint، signing، callback، rate limit و policy |

در unit economics، `configured_core_price` باید به‌صورت شفاف از `platform_fee + memory_fee + external_gateway_fee` ساخته شود. نام مبهم `core_price` نباید بین مدل «Memory Add-on تنها» و مدل «کل بستهٔ platform + memory + gateway» مشترک استفاده شود.

## ۴. فرمول‌های canonical

```text
context_cost
= context_tokens_m × model_input_cost_per_million_tokens

context_revenue
= context_cost × (1 + context_markup)

configured_core_price
= platform_fee + memory_fee + external_gateway_fee

revenue_total
= configured_core_price + context_revenue

casio_cost_total
= core_cost + context_cost

ecosystem_cost_total
= casio_cost_total + product_side_cost

gross_profit_casio
= revenue_total − casio_cost_total

gross_profit_ecosystem
= revenue_total − ecosystem_cost_total

gross_margin
= gross_profit ÷ revenue_total
```

فرض baseline برای context markup برابر 50% و model input cost برابر $1.50/M token است. مقادیر زیر فقط فرض‌های internal planning هستند: canonical storage برابر $0.12/GB-month، projection برابر $0.08، audit برابر $0.10، Gateway retrieval برابر $0.0004/request، ingest برابر $0.001/event، promotion/reindex برابر $0.003/event، remote retrieval سمت کاسیو در Hybrid برابر $0.0012/request، sync هر سمت برابر $0.001/event و storage canonical سمت محصول ثالث برابر $0.06/GB-month.

## ۵. Unit economics در مصرف استاندارد

| پرسونا | mode            | configured core price | context cost | context revenue | revenue total | Casio cost | ecosystem cost | GP کاسیو | GM کاسیو |    GP ecosystem |    GM ecosystem |
| ------ | --------------- | --------------------: | -----------: | --------------: | ------------: | ---------: | -------------: | -------: | -------: | --------------: | --------------: |
| فرد    | `casio_managed` |                $28.00 |        $4.50 |           $6.75 |        $34.75 |     $13.19 |         $13.19 |   $21.56 |    62.1% |          $21.56 |           62.1% |
| فرد    | `hybrid`        |                $34.00 |        $4.50 |           $6.75 |        $40.75 |     $16.77 |         $20.12 |   $23.98 |    58.9% | _بازمحاسبه شود_ | _بازمحاسبه شود_ |
| تیم    | `casio_managed` |               $118.00 |       $30.00 |          $45.00 |       $163.00 |     $57.68 |         $57.68 |  $105.32 |    64.6% |         $105.32 |           64.6% |
| تیم    | `hybrid`        |               $138.00 |       $30.00 |          $45.00 |       $183.00 |     $66.71 |         $83.51 |  $116.29 |    63.5% |          $99.49 |           54.4% |
| سازمان | `casio_managed` |               $527.00 |      $112.50 |         $168.75 |       $695.75 |    $199.92 |        $199.92 |  $495.83 |    71.3% |         $495.83 |           71.3% |
| سازمان | `hybrid`        |               $597.00 |      $112.50 |         $168.75 |       $765.75 |    $221.08 |        $272.28 |  $544.67 |    71.1% |         $493.47 |           64.4% |

در ردیف فرد/Hybrid، مقادیر گزارش‌شدهٔ پیوست به‌علت گردکردن اجزای پایین‌دستی بین `ecosystem_cost_total`، `gross_profit_ecosystem` و margin اندکی ناهمخوان‌اند: با اعداد نمایش‌داده‌شده، $40.75 − $20.12 = $20.63 است، نه $20.62. این اختلاف باید با نگه‌داشتن precision داخلی و گردکردن فقط در presentation حل شود؛ عدد نمایش‌داده‌شده بدون formula chain canonical نیست.

## ۶. economics مستقل حافظه

مدل حافظه باید از قیمت کل Platform جدا گزارش شود. در پروفایل سازمانی با 75M context token در ماه:

| mode            | قیمت Memory Add-on | هزینهٔ هستهٔ حافظه | هزینهٔ context | درآمد context | درآمد کل مدل حافظه | هزینهٔ کاسیو | هزینهٔ سمت محصول | هزینهٔ کل ecosystem | GM کاسیو | GM ecosystem |
| --------------- | -----------------: | -----------------: | -------------: | ------------: | -----------------: | -----------: | ---------------: | ------------------: | -------: | -----------: |
| `casio_managed` |            $129.00 |             $44.42 |        $112.50 |       $168.75 |            $297.75 |      $156.92 |            $0.00 |             $156.92 |    47.3% |        47.3% |
| `hybrid`        |            $199.00 |             $68.58 |        $112.50 |       $168.75 |            $367.75 |      $181.08 |           $51.20 |             $232.28 |    50.8% |        36.8% |

این جدول برای تصمیم architecture و metering مهم است: در Hybrid حاشیهٔ P&L کاسیو می‌تواند بالاتر از حاشیهٔ کل ecosystem باشد، چون هزینهٔ سمت محصول ثالث خارج از P&L کاسیو اما داخل TCO ecosystem است. این هزینه باید explicit، payer-aware و قراردادی باشد.

## ۷. هزینهٔ هر عملیات

| عملیات                           | `casio_managed` | `hybrid` سمت کاسیو | `hybrid` کل ecosystem |
| -------------------------------- | --------------: | -----------------: | --------------------: |
| retrieval با 2,500 context token |        $0.00415 |           $0.00495 |              $0.00645 |
| write/ingest                     |        $0.00100 |           $0.00100 |              $0.00100 |
| promotion/reindex                |        $0.00300 |           $0.00300 |              $0.00300 |
| sync event                       |               — |           $0.00100 |              $0.00200 |

فرمول retrieval در `casio_managed` برابر Gateway $0.00040 به‌علاوهٔ 2,500/1,000,000 × $1.50، یعنی $0.00415 است. در Hybrid، هزینهٔ سمت کاسیو $0.00120 Gateway به‌علاوهٔ $0.00375 context و هزینهٔ سمت محصول $0.00150 است؛ بنابراین TCO کل $0.00645 می‌شود.

## ۸. Cohort نمایشی 100 حساب

ترکیب cohort فقط illustrative است: 70 فرد، 25 تیم/Startup و 5 سازمان. این جدول forecast فروش نیست.

| mode            | درآمد ماهانه | هزینهٔ کاسیو |  GP کاسیو | GM کاسیو | هزینهٔ کل ecosystem | GP ecosystem | GM ecosystem |
| --------------- | -----------: | -----------: | --------: | -------: | ------------------: | -----------: | -----------: |
| `casio_managed` |    $9,986.25 |    $3,364.90 | $6,621.35 |    66.3% |           $3,364.90 |    $6,621.35 |        66.3% |
| `hybrid`        |   $11,256.25 |    $3,947.05 | $7,309.20 |    64.9% |           $4,857.55 |    $6,398.70 |        56.9% |

## ۹. Price floor و sensitivity

با فرض model cost برابر $1.50/M و target margin برابر 50%، floor تقریبی درآمد core در مصرف استاندارد چنین است:

| پرسونا      | `casio_managed` floor | `hybrid` floor | configured price مدل |
| ----------- | --------------------: | -------------: | -------------------: |
| فرد         |                $19.63 |         $26.79 |            $28 / $34 |
| تیم/Startup |                $70.36 |         $88.42 |          $118 / $138 |
| سازمان      |               $231.09 |        $273.41 |          $527 / $597 |

این floorها CAC، tax، payment processing، sales commission، R&D capitalisation، corporate overhead و هزینهٔ پشتیبانی کامل را شامل نمی‌شوند. در نتیجه، floor unit economics جایگزین contribution margin یا cash planning نیست.

Sensitivity نشان می‌دهد با افزایش model input cost از $0.30/M به $1.50/M و $3.00/M، سهم context در COGS بالا می‌رود. برای همین، Free/Individual باید context، storage و external endpoint cap روشن داشته باشد؛ تیم باید seat و shared usage را هم‌زمان meter کند؛ و سازمان باید SLA، retention، private runtime و اتصال چندمحصولی را جداگانه قیمت‌گذاری کند.

## ۱۰. Cost Attribution و payer policy

هر `UsageEvent` و `CostAttribution` باید immutable و به ابعاد زیر متصل باشد:

```text
organization_id
external_app_id
external_tenant_id
workspace_id
flow_id
flow_version_id
flow_run_id
memory_namespace_id
memory_item_id
operation_type
storage_mode
runtime
model_provider
model_name
input_tokens / output_tokens / context_tokens
bytes_read / bytes_written
latency_ms
unit_cost
allocated_shared_cost
billable_amount
payer_type
chargeback_policy
currency
pricing_version
occurred_at
```

`payer_type` می‌تواند `namespace_owner`، `consumer_org`، `sponsor_product` یا `platform` باشد و `chargeback_policy` می‌تواند `owner_pays`، `consumer_pays`، `sponsor_pays` یا `pass_through` باشد. در Hybrid، source storage و remote retrieval سمت محصول ثالث باید از P&L کاسیو جدا و در TCO کل ecosystem دیده شود.

هزینهٔ shared با تقسیم ساده بر تعداد سازمان‌ها تخصیص نمی‌یابد. allocator اولیه باید storage و backup را بر GB-day، مدل را بر token، observability را بر log/trace volume، network را بر egress bytes و security/support را بر active organization و Run توزیع کند. weightها، markup، cost owner و منبع نرخ باید در `pricing_version` ثبت شوند.

## ۱۱. قوانین مدل‌سازی و audit

تمام assumptionهای hard-coded باید منبع، تاریخ، section/table و confidence داشته باشند. در workbook مالی، ورودی‌ها باید با رنگ آبی و comment منبع ثبت شوند؛ formulaهای همان sheet مشکی و linkهای بین sheetها سبز باشند. صفرها به‌صورت خط تیره، هزینه‌ها به‌صورت عدد منفی/پرانتز و marginها با precision یکنواخت نمایش داده شوند.

Workbookهای پیوست‌شده در audit اولیه sheetهای اقتصادی را داشتند، اما در بررسی programmatic برای sheetهای استخراج‌شده formula قابل‌مشاهده یافت نشد؛ بنابراین آن workbookها **values-only planning artifacts** هستند و formula chain قابل‌ممیزی محسوب نمی‌شوند. برای نسخهٔ canonical بعدی، assumptions، formulaها، source comments، check row، scenario toggle و sensitivity باید داخل workbook یا یک pipeline قابل‌بازسازی قرار گیرند.

ردیف‌های JSON و CSV از نظر مقادیر اصلی هم‌راستا بودند و cohort revenue با ترکیب 70/25/5 بازسازی شد. بااین‌حال، هر اختلاف ناشی از rounding باید با precision داخلی حل شود و هر عددی که از فایل values-only می‌آید تا زمان بازسازی formula، confidence محاسباتی دارد نه confidence تجاری.

## ۱۲. ممنوعیت‌های مالی

قیمت سناریویی نباید در route، UI، seed، entitlement یا billing به‌صورت hard-coded وارد شود. `pricing_version` و effective date اجباری‌اند. درآمد platform، Memory Add-on، context usage، retrieval overage، storage overage و external sync نباید در یک عدد غیرقابل‌تفکیک ادغام شوند.

هیچ margin کاسیو نباید به‌عنوان margin کل ecosystem معرفی شود. هیچ فرضی نباید با telemetry واقعی، quote provider، SLA یا قیمت نهایی بازار خلط شود. وقتی دادهٔ لازم وجود ندارد، مقدار باید `TBD` یا scenario assumption بماند؛ ساختن عدد برای پرکردن جدول ممنوع است.

## ۱۳. release gates اقتصادی

پیش از public pricing یا production billing باید این موارد برقرار باشند:

1. تمام pricing inputها version، source، reference date و owner دارند.
2. همهٔ UsageEventها به Run، operation، organization، namespace و payer متصل‌اند.
3. Casio P&L و ecosystem TCO در گزارش جداگانه قابل‌بازسازی‌اند.
4. Hybrid و Product-managed هزینهٔ سمت ثالث و deletion/retention responsibility روشن دارند.
5. cap و overage برای context، storage، retrieval، sync و export تعریف شده است.
6. formula chain، rounding policy، scenario sensitivity و anomaly flags تست شده‌اند.
7. مدل با telemetry staging و چند cohort واقعی دوباره محاسبه شده است.
8. قیمت نهایی با تصمیم تجاری و قراردادی جدا از این design input ثبت شده است.

## منابع ورودی

این سند بر مبنای مدل planning پرسونا، دادهٔ ساختاریافتهٔ unit economics، workbookهای persona و memory economics و اسناد معماری حافظه/Integration Gateway تهیه شده است. فایل اعلام‌شدهٔ اقتصادیِ بارگذاری‌نشده در این تحلیل استفاده نشده است. اعداد این سند فقط برای طراحی و audit داخلی‌اند و به‌تنهایی تصمیم قیمت‌گذاری یا توصیهٔ مالی ایجاد نمی‌کنند.
