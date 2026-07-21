function secondSundayOfMarch(year: number): number {
  const first = new Date(Date.UTC(year, 2, 1));
  const firstSunday = 1 + ((7 - first.getUTCDay()) % 7);
  return firstSunday + 7;
}

function firstSundayOfNovember(year: number): number {
  const first = new Date(Date.UTC(year, 10, 1));
  return 1 + ((7 - first.getUTCDay()) % 7);
}

export function isNewYorkDstDate(year: number, monthIndex: number, day: number): boolean {
  if (monthIndex < 2 || monthIndex > 10) return false;
  if (monthIndex > 2 && monthIndex < 10) return true;
  if (monthIndex === 2) return day >= secondSundayOfMarch(year);
  return day < firstSundayOfNovember(year);
}

export function newYorkWallTimeToUtcInstant(input: {
  readonly year: number;
  readonly monthIndex: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}): string {
  const hourUtc =
    input.hour + (isNewYorkDstDate(input.year, input.monthIndex, input.day) ? 4 : 5);
  return new Date(
    Date.UTC(
      input.year,
      input.monthIndex,
      input.day,
      hourUtc,
      input.minute,
      0,
    ),
  ).toISOString();
}
