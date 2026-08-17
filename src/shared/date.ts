const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000;

export interface SeoulDate {
  date: string;
  compact: string;
}

export function toSeoulDate(value: string | number | Date): SeoulDate {
  const shifted = new Date(new Date(value).getTime() + SEOUL_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  const date = `${year}-${month}-${day}`;
  return { date, compact: `${String(year).slice(-2)}${month}${day}` };
}

export function nextSeoulMidnight(value: string | number | Date = new Date()): number {
  const shifted = new Date(new Date(value).getTime() + SEOUL_OFFSET_MS);
  return Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() + 1,
  ) - SEOUL_OFFSET_MS;
}
