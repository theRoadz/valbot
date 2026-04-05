// Shared formatting helpers for financial numbers

const currencyFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const integerFormatter = new Intl.NumberFormat("en-US");

export function formatCurrency(value: number, showSign = false): string {
  const formatted = currencyFormatter.format(Math.abs(value));

  if (showSign && value > 0) return `+$${formatted}`;
  if (showSign && value < 0) return `-$${formatted}`;
  return `$${formatted}`;
}

export function formatInteger(value: number): string {
  return integerFormatter.format(value);
}

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

export function formatTime(timestamp: number): string {
  return timeFormatter.format(new Date(timestamp));
}
