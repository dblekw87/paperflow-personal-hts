export function formatKrwTurnoverEok(
  value: string | null,
  fallback = "—",
): string {
  if (value === null || !/^\d+$/.test(value)) return fallback;
  const eokWon = BigInt(value) / 100_000_000n;
  return `${eokWon.toLocaleString("ko-KR")}억원`;
}
