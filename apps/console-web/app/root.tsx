import { publicRuntimeConfigSchema } from '@casioplus/contracts';
import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from '@remix-run/react';
import { m } from '@casioplus/i18n/messages';
import { getLocale, getTextDirection, setLocale, type Locale } from '@casioplus/i18n/runtime';
import stylesheet from './styles.css?url';

export const links: LinksFunction = () => [{ rel: 'stylesheet', href: stylesheet }];

export const meta: MetaFunction = () => [
  { title: 'Casioplus Console' },
  {
    name: 'description',
    content: 'Casioplus Console control and consumption surface',
  },
];

export async function loader(_args: LoaderFunctionArgs) {
  return json(
    publicRuntimeConfigSchema.parse({
      coreApiUrl: process.env.CASIOPLUS_CORE_API_URL ?? 'http://localhost:8080',
      consoleUrl: process.env.CASIOPLUS_CONSOLE_URL ?? 'http://localhost:5173',
      forgeUrl: process.env.CASIOPLUS_FORGE_URL ?? 'http://localhost:5174',
    }),
  );
}

function LocaleSwitcher({ locale }: { locale: Locale }) {
  function changeLocale(nextLocale: Locale) {
    if (nextLocale !== locale) void setLocale(nextLocale);
  }

  return (
    <nav className="locale-switcher" aria-label={m.shared_locale_switch_aria()}>
      <span>{m.shared_locale_language()}</span>
      <button
        type="button"
        aria-label={m.shared_locale_english()}
        aria-pressed={locale === 'en'}
        onClick={() => changeLocale('en')}
      >
        <span className="locale-name-long" aria-hidden="true">
          {m.shared_locale_english()}
        </span>
        <bdi className="locale-name-short" aria-hidden="true" dir="ltr">
          EN
        </bdi>
      </button>
      <button
        type="button"
        aria-label={m.shared_locale_persian()}
        aria-pressed={locale === 'fa'}
        onClick={() => changeLocale('fa')}
      >
        <span className="locale-name-long" aria-hidden="true">
          {m.shared_locale_persian()}
        </span>
        <bdi className="locale-name-short" aria-hidden="true" dir="ltr">
          FA
        </bdi>
      </button>
    </nav>
  );
}

export default function AppRoot() {
  const locale = getLocale();
  const direction = getTextDirection(locale);

  return (
    <html lang={locale} dir={direction} data-locale={locale}>
      <head>
        <Meta />
        <Links />
      </head>
      <body>
        <LocaleSwitcher locale={locale} />
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
