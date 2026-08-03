import { formatDayMonth, formatMonthYear, formatYear, utcFromParts } from './dates';

export interface Tick {
	ms: number;
	label: string;
}

const MS_DAY = 86400000;
const MS_YEAR = 365.2425 * MS_DAY;

/** Round steps the auto interval snaps to, per the spec. */
const YEAR_STEPS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000];
const MONTH_STEPS = [1, 2, 3, 6];
const DAY_STEPS = [1, 2, 5, 10, 15];

/** Aim for roughly this many labelled ticks across the visible span. */
const TARGET_TICKS = 8;

/**
 * Pick the step whose resulting tick count lands closest to TARGET_TICKS.
 * Choosing the first step under a ceiling instead makes a span that only just
 * exceeds a round number fall through to the next step up, which is a big jump
 * (a 100-year span dropping from a 10-year to a 25-year step, say).
 */
function pickStep(steps: number[], span: number): number {
	let best = steps[0];
	let bestScore = Infinity;
	for (const step of steps) {
		const score = Math.abs(span / step - TARGET_TICKS);
		if (score < bestScore) {
			bestScore = score;
			best = step;
		}
	}
	return best;
}

function yearTicks(start: number, end: number, step: number): Tick[] {
	const ticks: Tick[] = [];
	const startYear = new Date(start).getUTCFullYear();
	const endYear = new Date(end).getUTCFullYear();

	// Historical reckoning has no year zero, so once BC years are on screen the grid is
	// anchored to year 1. That puts labels on round BC values — 500 BC, 1000 BC — where
	// a grid anchored at zero would land on 501 BC and 1001 BC instead. Purely AD spans
	// keep the zero anchor, so their labels are unchanged.
	const anchor = startYear < 1 ? 1 : 0;
	let year = anchor + Math.floor((startYear - anchor) / step) * step;
	// Guard against runaway loops if a caller passes an absurd span.
	let guard = 0;
	while (year <= endYear && guard++ < 500) {
		const ms = utcFromParts(year);
		if (ms >= start && ms <= end) ticks.push({ ms, label: formatYear(year) });
		year += step;
	}
	return ticks;
}

function monthTicks(start: number, end: number, step: number): Tick[] {
	const ticks: Tick[] = [];
	const d = new Date(start);
	let year = d.getUTCFullYear();
	let month = Math.floor(d.getUTCMonth() / step) * step;

	let guard = 0;
	while (guard++ < 500) {
		const ms = utcFromParts(year, month);
		if (ms > end) break;
		if (ms >= start) ticks.push({ ms, label: formatMonthYear(ms) });
		month += step;
		while (month > 11) {
			month -= 12;
			year += 1;
		}
	}
	return ticks;
}

function dayTicks(start: number, end: number, step: number): Tick[] {
	const ticks: Tick[] = [];
	const first = new Date(start);
	const cursor = utcFromParts(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate());

	let guard = 0;
	for (let ms = cursor; ms <= end && guard++ < 500; ms += step * MS_DAY) {
		if (ms >= start) ticks.push({ ms, label: formatDayMonth(ms) });
	}
	return ticks;
}

/**
 * Build axis ticks for the visible domain.
 * `intervalYears` forces a fixed year step; null means auto, which drops to
 * month and day granularity once the visible span is shorter than a couple of years.
 */
export function buildTicks(start: number, end: number, intervalYears: number | null): Tick[] {
	const span = end - start;
	if (span <= 0) return [];

	if (intervalYears !== null && intervalYears > 0) {
		return yearTicks(start, end, intervalYears);
	}

	const spanYears = span / MS_YEAR;
	if (spanYears >= 2) {
		return yearTicks(start, end, pickStep(YEAR_STEPS, spanYears));
	}

	const spanMonths = spanYears * 12;
	if (spanMonths >= 2) {
		return monthTicks(start, end, pickStep(MONTH_STEPS, spanMonths));
	}

	const spanDays = span / MS_DAY;
	return dayTicks(start, end, pickStep(DAY_STEPS, Math.max(spanDays, 1)));
}

/** Parse the `axisInterval` config value. Returns null for "auto" / blank / invalid. */
export function parseAxisInterval(raw: unknown): number | null {
	if (raw === null || raw === undefined) return null;
	const text = String(raw).trim().toLowerCase();
	if (!text || text === 'auto') return null;
	const n = Number(text);
	return isFinite(n) && n > 0 ? n : null;
}
