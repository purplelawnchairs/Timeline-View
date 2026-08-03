import assert from 'node:assert';
import { check, group } from './harness.mjs';
import { toTimePoint, formatPoint, formatYear, utcFromParts } from '../build-test/dates.mjs';
import { buildTicks, parseAxisInterval } from '../build-test/axis.mjs';

// Minimal stand-ins for the Value wrappers Bases hands to getValue().
const strVal = (s) => ({ toString: () => s, isTruthy: () => !!s });
const numVal = (n) => ({ toString: () => String(n), isTruthy: () => n !== 0 });
const dateVal = (iso) => ({ date: new Date(iso), toString: () => 'March 14, 2025', isTruthy: () => true });
const momentVal = (iso) => ({
	data: { isValid: () => true, toDate: () => new Date(iso) },
	toString: () => 'whatever',
	isTruthy: () => true,
});


group('date parsing');
check('ISO date parses to UTC midnight', () => {
	const p = toTimePoint(strVal('1969-07-20'));
	assert.equal(new Date(p.ms).toISOString(), '1969-07-20T00:00:00.000Z');
	assert.equal(p.yearOnly, false);
});
check('bare year string is year-only, anchored to Jan 1', () => {
	const p = toTimePoint(strVal('1947'));
	assert.equal(new Date(p.ms).toISOString(), '1947-01-01T00:00:00.000Z');
	assert.equal(p.yearOnly, true);
});
check('bare year as a number is year-only', () => {
	const p = toTimePoint(numVal(1900));
	assert.equal(p.yearOnly, true);
	assert.equal(new Date(p.ms).getUTCFullYear(), 1900);
});
check('year-month parses', () => {
	const p = toTimePoint(strVal('1969-07'));
	assert.equal(new Date(p.ms).toISOString(), '1969-07-01T00:00:00.000Z');
	assert.equal(p.yearOnly, false);
});
check('datetime string parses', () => {
	const p = toTimePoint(strVal('2025-12-31T23:59'));
	assert.equal(new Date(p.ms).getUTCFullYear(), 2025);
});
check('native Date on the wrapper wins over locale toString', () => {
	const p = toTimePoint(dateVal('2025-03-14T00:00:00Z'));
	assert.equal(new Date(p.ms).toISOString(), '2025-03-14T00:00:00.000Z');
});
check('moment-like wrapper is unwrapped', () => {
	const p = toTimePoint(momentVal('1999-01-05T00:00:00Z'));
	assert.equal(new Date(p.ms).toISOString(), '1999-01-05T00:00:00.000Z');
});
check('null / empty / junk yield null', () => {
	assert.equal(toTimePoint(null), null);
	assert.equal(toTimePoint(strVal('')), null);
	assert.equal(toTimePoint(strVal('not a date')), null);
	assert.equal(toTimePoint(strVal('null')), null);
});
check('years under 100 are not shifted into the 1900s', () => {
	const p = toTimePoint(strVal('79'));
	assert.equal(new Date(p.ms).getUTCFullYear(), 79);
	assert.equal(p.yearOnly, true);
});

group('formatting');
check('year-only point shows just the year', () => {
	assert.equal(formatPoint({ ms: utcFromParts(1947), yearOnly: true }), '1947');
});
check('full date point shows day/month/year', () => {
	assert.equal(formatPoint(toTimePoint(strVal('1969-07-20'))), '20 Jul 1969');
});
check('negative years render as BC', () => {
	assert.equal(formatYear(0), '1 BC');
	assert.equal(formatYear(-43), '44 BC');
});

group('axis ticks');
const yr = (y) => utcFromParts(y);
check('auto interval over ~100 years snaps to a round step', () => {
	const ticks = buildTicks(yr(1920), yr(2020), null);
	assert.ok(ticks.length >= 5 && ticks.length <= 12, `got ${ticks.length} ticks`);
	const step = new Date(ticks[1].ms).getUTCFullYear() - new Date(ticks[0].ms).getUTCFullYear();
	assert.ok([1, 2, 5, 10, 25].includes(step), `step ${step} not round`);
});
check('auto interval over 4000 years stays readable', () => {
	const ticks = buildTicks(yr(-2000), yr(2000), null);
	assert.ok(ticks.length <= 12, `got ${ticks.length} ticks`);
});
check('explicit interval is honoured', () => {
	const ticks = buildTicks(yr(1900), yr(2000), 25);
	const years = ticks.map((t) => new Date(t.ms).getUTCFullYear());
	assert.deepEqual(years, [1900, 1925, 1950, 1975, 2000]);
});
check('sub-2-year span falls back to month ticks', () => {
	const ticks = buildTicks(Date.UTC(2024, 0, 1), Date.UTC(2024, 8, 1), null);
	assert.ok(ticks.length >= 3, `got ${ticks.length}`);
	assert.ok(/^[A-Z][a-z]{2} \d{4}$/.test(ticks[0].label), `label "${ticks[0].label}"`);
});
check('sub-2-month span falls back to day ticks', () => {
	const ticks = buildTicks(Date.UTC(2024, 0, 1), Date.UTC(2024, 0, 20), null);
	assert.ok(ticks.length >= 3, `got ${ticks.length}`);
	assert.ok(/^\d{1,2} [A-Z][a-z]{2}$/.test(ticks[0].label), `label "${ticks[0].label}"`);
});
check('all ticks land inside the requested domain', () => {
	for (const [a, b] of [[yr(1900), yr(2000)], [yr(-500), yr(500)], [Date.UTC(2024,0,1), Date.UTC(2024,1,1)]]) {
		for (const t of buildTicks(a, b, null)) {
			assert.ok(t.ms >= a && t.ms <= b, `tick ${new Date(t.ms).toISOString()} outside domain`);
		}
	}
});
check('degenerate domains do not hang or throw', () => {
	assert.deepEqual(buildTicks(yr(2000), yr(2000), null), []);
	assert.deepEqual(buildTicks(yr(2000), yr(1900), null), []);
	assert.ok(buildTicks(yr(-50000), yr(50000), null).length <= 500);
	assert.ok(buildTicks(yr(1900), yr(2000), 0.0001).length <= 500);
});

group('axisInterval config parsing');
check('auto / blank / invalid all mean auto', () => {
	for (const v of ['auto', 'AUTO', '', '  ', null, undefined, 'abc', '0', '-5'])
		assert.equal(parseAxisInterval(v), null, `for ${JSON.stringify(v)}`);
});
check('numbers parse', () => {
	assert.equal(parseAxisInterval('25'), 25);
	assert.equal(parseAxisInterval(10), 10);
	assert.equal(parseAxisInterval(' 100 '), 100);
});

