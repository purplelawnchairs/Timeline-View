import { Value } from 'obsidian';

/**
 * A parsed point on the timeline. `yearOnly` is set when the source data carried no
 * month/day, so the hover card can show "1969" rather than a fabricated "1 Jan 1969".
 */
export interface TimePoint {
	ms: number;
	yearOnly: boolean;
}

const YEAR_ONLY = /^(-?\d{1,6})$/;
const YEAR_MONTH = /^(-?\d{1,6})-(\d{1,2})$/;
const ISO_DATE = /^(-?\d{1,6})-(\d{1,2})-(\d{1,2})/;
/** `500 BC`, `44 BCE`, `1200 AD`, `70 C.E.` */
const ERA_SUFFIX = /^(\d{1,6})\s*(bce|bc|b\.c\.e\.|b\.c\.|ce|ad|c\.e\.|a\.d\.|ac|AC|a.c.|A.C.|dc|DC|d.c.|D.C.)$/i;
/** `AD 1200`, `CE 70` */
const ERA_PREFIX = /^(ad|ce|a\.d\.|c\.e\.)\s*(\d{1,6})$/i;

/** Guards against dates outside the range JS Date can represent (roughly ±271,821). */
function point(ms: number, yearOnly: boolean): TimePoint | null {
	return Number.isFinite(ms) ? { ms, yearOnly } : null;
}

/** Date.UTC() maps years 0-99 into the 1900s; this does not. */
export function utcFromParts(year: number, month = 0, day = 1): number {
	const d = new Date(0);
	d.setUTCFullYear(year, month, day);
	d.setUTCHours(0, 0, 0, 0);
	return d.getTime();
}

/**
 * DateValue does not expose its underlying Date through the public API, and its
 * toString() honours the user's date-display setting (so it is not reliably parseable).
 * Probe the wrapper for a Date or a moment-like object before falling back to strings.
 */
function unwrapNativeDate(value: unknown): Date | null {
	const candidates: unknown[] = [value];
	const holder = value as Record<string, unknown>;
	if (holder && typeof holder === 'object') {
		for (const key of ['date', 'time', 'data', 'value', '_date', 'moment']) {
			if (key in holder) candidates.push(holder[key]);
		}
	}

	for (const candidate of candidates) {
		if (candidate instanceof Date) {
			return isNaN(candidate.getTime()) ? null : candidate;
		}
		const m = candidate as { isValid?: () => boolean; toDate?: () => Date };
		if (m && typeof m === 'object' && typeof m.toDate === 'function') {
			if (typeof m.isValid === 'function' && !m.isValid()) continue;
			const d = m.toDate();
			if (d instanceof Date && !isNaN(d.getTime())) return d;
		}
	}
	return null;
}

/**
 * `500 BC` and friends. Astronomical numbering has no year zero — 1 BC is astronomical
 * year 0, 500 BC is -499 — so an era year converts as `1 - year` rather than `-year`.
 */
function parseEra(input: string): TimePoint | null {
	let yearText: string;
	let era: string;

	const suffix = ERA_SUFFIX.exec(input);
	if (suffix) {
		yearText = suffix[1];
		era = suffix[2];
	} else {
		const prefix = ERA_PREFIX.exec(input);
		if (!prefix) return null;
		era = prefix[1];
		yearText = prefix[2];
	}

	const year = Number(yearText);
	// Neither era has a year zero.
	if (year < 1) return null;

	const isBc = era[0] === 'b' || era[0] === 'B';
	return point(utcFromParts(isBc ? 1 - year : year), true);
}

function parseString(raw: string): TimePoint | null {
	const input = raw.trim();
	if (!input) return null;

	const era = parseEra(input);
	if (era) return era;

	const yearMatch = YEAR_ONLY.exec(input);
	if (yearMatch) {
		return point(utcFromParts(Number(yearMatch[1])), true);
	}

	const ymMatch = YEAR_MONTH.exec(input);
	if (ymMatch) {
		const month = Number(ymMatch[2]);
		if (month < 1 || month > 12) return null;
		return point(utcFromParts(Number(ymMatch[1]), month - 1), false);
	}

	const isoMatch = ISO_DATE.exec(input);
	if (isoMatch) {
		const month = Number(isoMatch[2]);
		const day = Number(isoMatch[3]);
		if (month < 1 || month > 12 || day < 1 || day > 31) return null;
		return point(utcFromParts(Number(isoMatch[1]), month - 1, day), false);
	}

	// Last resort, for locale-formatted strings. Deliberately not applied to anything
	// starting with a minus: Date.parse reads "-500-03-15" as AD 500, and silently
	// plotting a date in the wrong era is worse than not plotting it at all.
	if (input.startsWith('-')) return null;
	return point(Date.parse(input), false);
}

/**
 * Coerce a Bases property value into a point on the timeline.
 * Returns null for empty values and anything that cannot be read as a date.
 */
export function toTimePoint(value: Value | null): TimePoint | null {
	if (value === null || value === undefined) return null;

	const native = unwrapNativeDate(value);
	if (native) {
		// A DateValue built from a bare year lands on 1 Jan; the string form below is
		// what tells us whether the source was year-only, so only trust the Date here.
		return point(native.getTime(), false);
	}

	let text: string;
	try {
		text = value.toString();
	} catch (e) {
		return null;
	}
	if (!text || text === 'null' || text === 'undefined') return null;

	return parseString(text);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatPoint(point: TimePoint): string {
	const d = new Date(point.ms);
	const year = d.getUTCFullYear();
	if (point.yearOnly) return formatYear(year);
	return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${formatYear(year)}`;
}

export function formatYear(year: number): string {
	return year < 1 ? `${Math.abs(year - 1)} BC` : String(year);
}

export function formatMonthYear(ms: number): string {
	const d = new Date(ms);
	return `${MONTHS[d.getUTCMonth()]} ${formatYear(d.getUTCFullYear())}`;
}

export function formatDayMonth(ms: number): string {
	const d = new Date(ms);
	return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
