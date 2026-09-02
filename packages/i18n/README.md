# Casioplus i18n

`@casioplus/i18n` is the canonical static UI localization package for Casioplus Console and Casioplus Forge. English (`en`) is the base and default locale. Persian (`fa`) is supported with right-to-left document direction. Both Remix surfaces use the same `CASIOPLUS_LOCALE` cookie and the same `cookie -> baseLocale` resolution strategy.

| Path                                 | Role                                                       | Tracked in Git |
| ------------------------------------ | ---------------------------------------------------------- | -------------- |
| `messages/en.json`                   | Canonical English source messages                          | Yes            |
| `messages/fa.json`                   | Reviewed Persian translations                              | Yes            |
| `project.inlang/settings.json`       | Locales, message format and pinned modules                 | Yes            |
| `project.inlang/paraglide.config.js` | Compiler and runtime strategy                              | Yes            |
| `src/paraglide/`                     | Reproducible compiler output                               | No             |
| `src/formatters.ts`                  | Locale-aware date, number, money and relative-time helpers | Yes            |

Run `pnpm i18n:compile` from the repository root after changing either catalog. Run `pnpm validate:i18n` to verify locale policy, key parity, placeholder parity, pinned modules and the generated-output boundary. The normal root `check` and `build` commands compile the package before consuming it.

Static UI copy is changed through catalog pull requests. Runtime organizational or editorial content does not belong in these catalogs and must use its canonical domain API. Generated output must never be committed.
