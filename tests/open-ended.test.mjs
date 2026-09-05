import assert from 'node:assert';
import { check, group } from './harness.mjs';
import { resolveSpan, todayMs, toTimePoint, utcFromParts } from '../build-test/dates.mjs';

const strVal = (s) => ({ toString: () => s, isTruthy: () => !!s });

const pt = (year, yearOnly = true) => ({ ms: utcFromParts(year), yearOnly });
const NOW = utcFromParts(2026, 8, 5);

group('resolveSpan — closed ranges are unchanged');
check('a start and a later end is a plain range', () => {
	const s = resolveSpan(pt(1914), pt(1918), null, NOW, true);
	assert.equal(s.isRange, true);
	assert.equal(s.isOpen, false);
	assert.equal(s.end.ms, pt(1918).ms);
});
check('an end at or before the start stays a point rather than becoming open', () => {
	// Bad data, not an ongoing period: extending it to today would invent a span.
	for (const end of [pt(1914), pt(1900)]) {
		const s = resolveSpan(pt(1914), end, null, NOW, true);
		assert.equal(s.isRange, false, 'should not be a range');
		assert.equal(s.isOpen, false);
		assert.equal(s.start.ms, s.end.ms);
	}
});
check('an end with no start plots as a point at the end', () => {
	const s = resolveSpan(null, pt(1918), null, NOW, true);
	assert.equal(s.isRange, false);
	assert.equal(s.start.ms, pt(1918).ms);
});
check('neither start nor end falls back to the date property', () => {
	const s = resolveSpan(null, null, pt(1969), NOW, true);
	assert.equal(s.isRange, false);
	assert.equal(s.start.ms, pt(1969).ms);
});
check('a point event with no end is not turned into a range to today', () => {
	// The fallback date property means "this happened", not "this began".
	const s = resolveSpan(null, null, pt(1969), NOW, true);
	assert.equal(s.isOpen, false);
	assert.equal(s.end.ms, pt(1969).ms);
});
check('nothing dated at all is skipped', () => {
	assert.equal(resolveSpan(null, null, null, NOW, true), null);
});

group('resolveSpan — open-ended periods run to today');
check('a start with a missing end extends to today', () => {
	const s = resolveSpan(pt(1993), null, null, NOW, true);
	assert.equal(s.isRange, true);
	assert.equal(s.isOpen, true);
	assert.equal(s.end.ms, NOW);
});
check('an end property that is present but blank extends to today', () => {
	// A blank property reads as null through toTimePoint, same as a missing one.
	assert.equal(toTimePoint(strVal('')), null);
	const s = resolveSpan(pt(1993), toTimePoint(strVal('')), null, NOW, true);
	assert.equal(s.isOpen, true);
	assert.equal(s.end.ms, NOW);
});
check('a placeholder end value extends to today', () => {
	for (const placeholder of ['present', 'ongoing', 'now', 'today', 'current', 'TBD', '?']) {
		assert.equal(toTimePoint(strVal(placeholder)), null, `${placeholder} should not parse`);
		const s = resolveSpan(pt(1993), toTimePoint(strVal(placeholder)), null, NOW, true);
		assert.equal(s.isOpen, true, placeholder);
		assert.equal(s.end.ms, NOW, placeholder);
	}
});
check('an open period still reports its real start', () => {
	const s = resolveSpan(pt(1993), null, null, NOW, true);
	assert.equal(s.start.ms, pt(1993).ms);
	assert.equal(s.start.yearOnly, true);
});
check('the extension can be switched off, leaving a point', () => {
	const s = resolveSpan(pt(1993), null, null, NOW, false);
	assert.equal(s.isRange, false);
	assert.equal(s.isOpen, false);
	assert.equal(s.end.ms, pt(1993).ms);
});
check('a future-dated start is not extended backwards to today', () => {
	const s = resolveSpan(pt(2400), null, null, NOW, true);
	assert.equal(s.isRange, false);
	assert.equal(s.isOpen, false);
});
check('a start today exactly is a point, not a zero-width range', () => {
	const s = resolveSpan({ ms: NOW, yearOnly: false }, null, null, NOW, true);
	assert.equal(s.isRange, false);
});
check('a BC start with no end runs all the way to today', () => {
	const s = resolveSpan(toTimePoint(strVal('27 BC')), null, null, NOW, true);
	assert.equal(s.isOpen, true);
	assert.ok(s.end.ms > s.start.ms);
});

group('todayMs');
check('is UTC midnight', () => {
	const d = new Date(todayMs());
	assert.equal(d.getUTCHours(), 0);
	assert.equal(d.getUTCMinutes(), 0);
	assert.equal(d.getUTCSeconds(), 0);
	assert.equal(d.getUTCMilliseconds(), 0);
});
check('matches the current UTC date', () => {
	const now = new Date();
	const d = new Date(todayMs());
	assert.equal(d.getUTCFullYear(), now.getUTCFullYear());
	assert.equal(d.getUTCMonth(), now.getUTCMonth());
	assert.equal(d.getUTCDate(), now.getUTCDate());
});

group('era markers from the merged pull request');
check('English BC and AD are unchanged', () => {
	assert.equal(toTimePoint(strVal('500 BC')).ms, utcFromParts(-499));
	assert.equal(toTimePoint(strVal('44 BCE')).ms, utcFromParts(-43));
	assert.equal(toTimePoint(strVal('1200 AD')).ms, utcFromParts(1200));
	assert.equal(toTimePoint(strVal('70 C.E.')).ms, utcFromParts(70));
});
check('a.C. is before Christ, not after — it must not be read as A.D.', () => {
	// The regex accepts it; the era test used to key on the first letter, which made
	// "500 a.C." land on AD 500 — a 999-year error in the wrong direction.
	for (const text of ['500 a.C.', '500 A.C.', '500 ac', '500 AC']) {
		assert.equal(toTimePoint(strVal(text)).ms, utcFromParts(-499), text);
	}
});
check('d.C. is after Christ', () => {
	for (const text of ['1200 d.C.', '1200 D.C.', '1200 dc', '1200 DC']) {
		assert.equal(toTimePoint(strVal(text)).ms, utcFromParts(1200), text);
	}
});
check('the era dots are literal, so a bare word is not read as a date', () => {
	// Unescaped dots in the pattern made "500 axcy" match as an era.
	for (const text of ['500 axcy', '500 dxcy', '500 abc', '500 xyz']) {
		assert.equal(toTimePoint(strVal(text)), null, text);
	}
});
