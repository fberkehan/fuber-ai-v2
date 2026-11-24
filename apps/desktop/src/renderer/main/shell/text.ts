// Küçük metin yardımcıları (Türkçe büyük/küçük harf kuralıyla).

/** "hey jarvis" → "Hey Jarvis". */
export function capitalizeWords(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toLocaleUpperCase('tr-TR') + word.slice(1))
    .join(' ');
}

/** Cümlenin ilk harfini büyütür. */
export function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase('tr-TR') + text.slice(1);
}

/** Para: "0,42 $". */
export function formatUsd(value: number): string {
  const digits = value > 0 && value < 0.1 ? 3 : 2;
  return `${value.toLocaleString('tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits })} $`;
}

export function formatPercent(value: number): string {
  return `%${Math.round(value * 100)}`;
}
