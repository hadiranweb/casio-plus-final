import { getLocale, type Locale } from './paraglide/runtime.js';

export type DateInput = Date | string | number;

function asDate(value: DateInput) {
  return value instanceof Date ? value : new Date(value);
}

export function formatDate(
  value: DateInput,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
  locale: Locale = getLocale(),
) {
  return new Intl.DateTimeFormat(locale, options).format(asDate(value));
}

export function formatDateTime(
  value: DateInput,
  options: Intl.DateTimeFormatOptions = {
    dateStyle: 'medium',
    timeStyle: 'short',
  },
  locale: Locale = getLocale(),
) {
  return new Intl.DateTimeFormat(locale, options).format(asDate(value));
}

export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions,
  locale: Locale = getLocale(),
) {
  return new Intl.NumberFormat(locale, options).format(value);
}

export function formatMoney(
  value: number,
  currency: string,
  options: Omit<Intl.NumberFormatOptions, 'currency' | 'style'> = {},
  locale: Locale = getLocale(),
) {
  return new Intl.NumberFormat(locale, {
    ...options,
    style: 'currency',
    currency,
  }).format(value);
}

export function formatRelativeTime(
  value: number,
  unit: Intl.RelativeTimeFormatUnit,
  options?: Intl.RelativeTimeFormatOptions,
  locale: Locale = getLocale(),
) {
  return new Intl.RelativeTimeFormat(locale, options).format(value, unit);
}
