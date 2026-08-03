import assert from 'node:assert';
import { check, group } from './harness.mjs';
import { toTimePoint, formatPoint, formatYear, utcFromParts } from '../build-test/dates.mjs';
import { buildTicks } from '../build-test/axis.mjs';

const v = (s) => ({ toString: () => String(s), isTruthy: () => true });
const parse = (s) => toTimePoint(v(s));
const yearOf = (p) => new Date(p.ms).getUTCFullYear();
const shown = (s) => formatPoint(parse(s));

group('BC era parsing');
check('"500 BC" is astronomical year -499', () => {
	// No year zero: 1 BC is astronomical 0, so 500 BC is -499.
	assert.equal(yearOf(parse('500 BC')), -499);
	assert.equal(parse('500 BC').yearOnly, true);
});
check('"1 BC" is astronomical year 0', () => {
	assert.equal(yearOf(parse('1 BC')), 0);
});
check('era spelling and case variants all parse alike', () => {
	const target = yearOf(parse('44 BC'));
	for (const s of ['44 BC', '44 bc', '44BC', '44 BCE', '44 bce', '44 B.C.', '44 B.C.E.']) {
		assert.equal(yearOf(parse(s)), target, `for "${s}"`);
	}
});
check('AD and CE parse as positive years, prefix or suffix', () => {
	for (const s of ['AD 500', '500 AD', 'CE 500', '500 CE', '500 A.D.', 'ad 500']) {
		assert.equal(yearOf(parse(s)), 500, `for "${s}"`);
	}
});
check('"AD 500" is no longer mis-read as 499 by the Date.parse fallback', () => {
	assert.equal(shown('AD 500'), '500');
});
check('year zero is rejected in either era', () => {
	assert.equal(parse('0 BC'), null);
	assert.equal(parse('0 AD'), null);
});

group('BC round-tripping and display');
check('BC years display as BC, not as negative numbers', () => {
	assert.equal(shown('500 BC'), '500 BC');
	assert.equal(shown('44 BCE'), '44 BC');
	assert.equal(shown('1 BC'), '1 BC');
});
check('a BC year parsed then formatted returns the same year', () => {
	for (const y of [1, 2, 44, 100, 500, 3000, 10000]) {
		assert.equal(shown(`${y} BC`), `${y} BC`, `for ${y} BC`);
	}
});
check('bare negatives follow ISO astronomical numbering', () => {
	// -500 is astronomical, i.e. 501 BC. "500 BC" is the unambiguous spelling.
	assert.equal(yearOf(parse('-500')), -500);
	assert.equal(shown('-500'), '501 BC');
});
check('negative ISO dates keep their era and their day', () => {
	assert.equal(shown('-0500-03-15'), '15 Mar 501 BC');
	// Short-form negative years are accepted too, and must not flip to AD.
	assert.equal(shown('-500-03-15'), '15 Mar 501 BC');
});
check('formatYear crossing the era boundary', () => {
	assert.equal(formatYear(1), '1');
	assert.equal(formatYear(0), '1 BC');
	assert.equal(formatYear(-1), '2 BC');
});

group('rejecting bad input rather than mis-plotting it');
check('a year beyond the representable Date range is skipped, not NaN', () => {
	// Previously produced { ms: NaN }, which poisoned the min/max fit range.
	for (const s of ['999999', '500000 BC', '-999999']) {
		const p = parse(s);
		assert.ok(p === null || Number.isFinite(p.ms), `"${s}" produced ${p && p.ms}`);
	}
});
check('out-of-range months and days are rejected', () => {
	assert.equal(parse('2024-13-01'), null);
	assert.equal(parse('2024-00-01'), null);
	assert.equal(parse('2024-03-32'), null);
	assert.equal(parse('2024-13'), null);
});
check('unparseable leading-minus strings are skipped, not guessed', () => {
	assert.equal(parse('-not a date'), null);
});
check('ordinary AD dates are unaffected', () => {
	assert.equal(shown('1969-07-20'), '20 Jul 1969');
	assert.equal(shown('1947'), '1947');
	assert.equal(shown('2024-03'), '1 Mar 2024');
});

group('BC axis ticks');
const yr = (y) => utcFromParts(y);
check('BC ticks land on round years, not on 501 BC', () => {
	const labels = buildTicks(yr(-2999), yr(1), 1000).map((t) => t.label);
	assert.deepEqual(labels, ['3000 BC', '2000 BC', '1000 BC', '1']);
});
check('a span crossing the era boundary labels both sides', () => {
	const labels = buildTicks(yr(-999), yr(2001), 1000).map((t) => t.label);
	assert.deepEqual(labels, ['1000 BC', '1', '1001', '2001']);
});
check('purely AD spans keep the zero-anchored grid', () => {
	const labels = buildTicks(yr(1900), yr(2000), 25).map((t) => t.label);
	assert.deepEqual(labels, ['1900', '1925', '1950', '1975', '2000']);
});
check('auto interval works across a BC span', () => {
	const ticks = buildTicks(yr(-3000), yr(-1000), null);
	assert.ok(ticks.length >= 4 && ticks.length <= 12, `got ${ticks.length}`);
	assert.ok(ticks.every((t) => t.label.endsWith('BC')), ticks.map((t) => t.label).join(', '));
});
check('every BC tick stays inside the requested domain', () => {
	for (const [a, b] of [[yr(-5000), yr(-1)], [yr(-500), yr(500)], [yr(-50), yr(50)]]) {
		for (const t of buildTicks(a, b, null)) {
			assert.ok(t.ms >= a && t.ms <= b, `tick ${t.label} outside domain`);
		}
	}
});
