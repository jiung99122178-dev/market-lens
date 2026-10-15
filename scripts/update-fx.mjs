import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
export const FX_SOURCE = 'https://fred.stlouisfed.org/series/DEXCHUS';

export function parseFxCsv(text, now = new Date()) {
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  if (lines.shift() !== 'observation_date,DEXCHUS') throw Error('Unexpected FRED FX series/header');
  const rows = [], seen = new Set(), today = now.toISOString().slice(0, 10);
  for (const line of lines) {
    if (!line.trim()) continue;
    const cells = line.split(',');
    if (cells.length !== 2) throw Error('Invalid FX CSV row');
    const [date, value] = cells;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || date > today || seen.has(date)) throw Error('Invalid/duplicate FX observation date');
    seen.add(date);
    if (value === '.' || value === '') continue; // Holidays/missing releases are gaps, never zero or forward-filled.
    const rate = Number(value);
    if (!value.trim() || !Number.isFinite(rate) || rate <= 0) throw Error('Invalid USD/CNY rate');
    rows.push({ date, rate });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

export function buildFxSnapshot(rows, previous, now = new Date()) {
  if (rows.length < 1000) throw Error('Insufficient five-year FX history; previous data preserved');
  const latest = rows.at(-1).date, earliestRequired = new Date(latest + 'T00:00:00Z');
  earliestRequired.setUTCFullYear(earliestRequired.getUTCFullYear() - 5);
  earliestRequired.setUTCDate(earliestRequired.getUTCDate() + 7);
  if (rows[0].date > earliestRequired.toISOString().slice(0, 10)) throw Error('FX history is shorter than five years');
  if (previous && (previous.pair !== 'USD/CNY' || previous.series !== 'DEXCHUS')) throw Error('Existing FX identity mismatch');
  if (previous?.asOf > latest) throw Error('FX date regressed; previous data preserved');
  const oldOverlap = (previous?.rows ?? []).filter(row => row.date >= rows[0].date);
  const dates = new Set(rows.map(row => row.date));
  if (oldOverlap.length && oldOverlap.filter(row => dates.has(row.date)).length < oldOverlap.length * .97) throw Error('FX coverage dropped; previous data preserved');
  return { version: 1, pair: 'USD/CNY', series: 'DEXCHUS', unit: 'CNY per USD', source: 'Federal Reserve via FRED', sourceUrl: FX_SOURCE, observation: 'New York noon buying rate', updatedAt: now.toISOString(), asOf: latest, rows };
}

export async function updateFx({ file = path.resolve(import.meta.dirname, '../data/usd-cny.json'), now = new Date(), fetcher = fetch } = {}) {
  let previous = null;
  try { previous = JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const start = new Date(now); start.setUTCFullYear(start.getUTCFullYear() - 5); start.setUTCDate(start.getUTCDate() - 30);
  const url = new URL('https://fred.stlouisfed.org/graph/fredgraph.csv');
  url.searchParams.set('id', 'DEXCHUS'); url.searchParams.set('cosd', start.toISOString().slice(0, 10));
  const response = await fetcher(url, { signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw Error('FRED FX HTTP ' + response.status);
  const next = buildFxSnapshot(parseFxCsv(await response.text(), now), previous, now);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = file + '.tmp';
  await fs.writeFile(temporary, JSON.stringify(next)); await fs.rename(temporary, file);
  console.log(JSON.stringify({ fx: next.pair, asOf: next.asOf, latest: next.rows.at(-1).rate, rows: next.rows.length }));
  return next;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await updateFx(process.env.FX_OUTPUT ? { file: path.resolve(process.env.FX_OUTPUT) } : {});
