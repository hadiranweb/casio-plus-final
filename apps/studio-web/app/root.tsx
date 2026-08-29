import { publicRuntimeConfigSchema } from '@casioplus/contracts';
import type { LinksFunction, LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from '@remix-run/react';
import stylesheet from './styles.css?url';

export const links: LinksFunction = () => [{ rel: 'stylesheet', href: stylesheet }];

export const meta: MetaFunction = () => [
  { title: 'Casioplus Studio' },
  {
    name: 'description',
    content: 'Casioplus Studio authoring and governance surface',
  },
];

export async function loader(_args: LoaderFunctionArgs) {
  return json(
    publicRuntimeConfigSchema.parse({
      coreApiUrl: process.env.CASIOPLUS_CORE_API_URL ?? 'http://localhost:8080',
      appUrl: process.env.CASIOPLUS_APP_URL ?? 'http://localhost:5173',
      studioUrl: process.env.CASIOPLUS_STUDIO_URL ?? 'http://localhost:5174',
    }),
  );
}

export default function StudioRoot() {
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
