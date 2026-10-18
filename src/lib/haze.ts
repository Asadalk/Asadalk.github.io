// Hero haze driven by real data: Delhi's daily PM2.5 from SmokeTrail. The
// street shows the same calendar day in autumn 2019 (the most recent season
// in the data); outside 15 Sep–15 Dec it uses the nearest in-season day.

export type PmDay = [date: string, pm25: number];

/** India's National AQI categories for 24-h PM2.5 (CPCB breakpoints, µg/m³). */
export function aqiCategory(pm: number): string {
  if (pm <= 30) return 'good';
  if (pm <= 60) return 'satisfactory';
  if (pm <= 90) return 'moderate';
  if (pm <= 120) return 'poor';
  if (pm <= 250) return 'very poor';
  return 'severe';
}

/** Haze opacity: clear-ish at good air, thick at severe. */
export function hazeLevel(pm: number): number {
  return Math.round((0.12 + 0.78 * Math.min(pm, 400) / 400) * 100) / 100;
}

const dayOfYear = (m: number, d: number) => Date.UTC(2019, m - 1, d) / 86_400_000 - Date.UTC(2019, 0, 1) / 86_400_000;

/** The season day matching `today`'s month/day, or the nearest one (cyclically). */
export function pickDay(days: PmDay[], today: Date, year = 2019): PmDay {
  const season = days.filter(([d]) => d.startsWith(`${year}-`));
  const t = dayOfYear(today.getMonth() + 1, today.getDate());
  let best = season[0];
  let bestGap = Infinity;
  for (const day of season) {
    const [, m, d] = day[0].split('-').map(Number);
    const raw = Math.abs(dayOfYear(m, d) - t);
    const gap = Math.min(raw, 365 - raw);
    if (gap < bestGap) {
      best = day;
      bestGap = gap;
    }
  }
  return best;
}

export function hazeCaption([date, pm]: PmDay): string {
  const when = new Date(date + 'T00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return `The haze is Delhi's real air on ${when}: PM2.5 ${Math.round(pm)} µg/m³ (${aqiCategory(pm)}), from CPCB data in my SmokeTrail project.`;
}
