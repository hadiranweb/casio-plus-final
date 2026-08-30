import { publicRuntimeConfigSchema } from '@casioplus/contracts';
import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from '@remix-run/react';
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

export default function AppRoot() {
  return (
    <html lang="fa" dir="rtl">
      <head>
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
