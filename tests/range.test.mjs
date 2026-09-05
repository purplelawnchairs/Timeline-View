import assert from 'node:assert';
import { check, group } from './harness.mjs';
import {
	centreDomain,
	clampDomain,
	densityBuckets,
	rangeWindow,
	resizeDomain,
} from '../build-test/layout.mjs';
import {
	endOfPoint,
	formatRangeBound,
	parseDateText,
	utcFromParts,
} from '../build-test/dates.mjs';

const FIT = { start: 0, end: 1000 };
const MIN = 10;
const WIDTH = 200;
const span = (d) => d.end - d.start;

group('rangeWindow');
check('the whole fit fills the track', () => {
	assert.deepEqual(rangeWindow(FIT, FIT, WIDTH), { left: 0, width: WIDTH });
});
check('a middle window maps to the middle of the track', () => {
	assert.deepEqual(rangeWindow({ start: 250, end: 500 }, FIT, WIDTH), { left: 50, width: 50 });
});
check('a window at the far end ends flush with the track', () => {
	const w = rangeWindow({ start: 900, end: 1000 }, FIT, WIDTH);
	assert.equal(w.left + w.width, WIDTH);
});
check('a zero-width track yields no window rather than NaN', () => {
	const w = rangeWindow({ start: 250, end: 500 }, FIT, 0);
	assert.ok(Number.isFinite(w.left) && Number.isFinite(w.width));
});
check('a degenerate fit does not divide by zero', () => {
	const w = rangeWindow({ start: 0, end: 0 }, { start: 5, end: 5 }, WIDTH);
	assert.ok(Number.isFinite(w.left) && Number.isFinite(w.width));
});
check('the window never runs past the track', () => {
	for (const view of [{ start: -500, end: 200 }, { start: 800, end: 5000 }]) {
		const w = rangeWindow(view, FIT, WIDTH);
		assert.ok(w.left >= 0, 'left');
		assert.ok(w.left + w.width <= WIDTH + 1e-9, 'right');
	}
});

group('resizeDomain');
check('dragging the start moves only the start', () => {
	const d = resizeDomain({ start: 200, end: 600 }, FIT, 'start', 350, MIN);
	assert.deepEqual(d, { start: 350, end: 600 });
});
check('dragging the end moves only the end', () => {
	const d = resizeDomain({ start: 200, end: 600 }, FIT, 'end', 800, MIN);
	assert.deepEqual(d, { start: 200, end: 800 });
});
check('a start dragged past the end stops a minimum span short', () => {
	const d = resizeDomain({ start: 200, end: 600 }, FIT, 'start', 900, MIN);
	assert.equal(d.end, 600);
	assert.equal(d.start, 590);
	assert.equal(span(d), MIN);
});
check('an end dragged past the start stops a minimum span short', () => {
	const d = resizeDomain({ start: 200, end: 600 }, FIT, 'end', 50, MIN);
	assert.equal(d.start, 200);
	assert.equal(span(d), MIN);
});
check('neither edge escapes the fit range', () => {
	assert.equal(resizeDomain({ start: 200, end: 600 }, FIT, 'start', -900, MIN).start, 0);
	assert.equal(resizeDomain({ start: 200, end: 600 }, FIT, 'end', 9000, MIN).end, 1000);
});
check('the domain never inverts, whatever is thrown at it', () => {
	for (const edge of ['start', 'end']) {
		for (const ms of [-5000, -1, 0, 200, 599, 600, 601, 1000, 5000]) {
			const d = resizeDomain({ start: 200, end: 600 }, FIT, edge, ms, MIN);
			assert.ok(d.end > d.start, `${edge} @ ${ms}: ${JSON.stringify(d)}`);
			assert.ok(d.start >= FIT.start && d.end <= FIT.end, `${edge} @ ${ms} escaped the fit`);
		}
	}
});

group('centreDomain');
check('the span is preserved when recentring', () => {
	const d = centreDomain({ start: 200, end: 400 }, FIT, 700, MIN);
	assert.equal(span(d), 200);
	assert.equal(d.start, 600);
});
check('recentring near an edge clamps without shrinking the span', () => {
	const d = centreDomain({ start: 200, end: 400 }, FIT, 990, MIN);
	assert.equal(span(d), 200);
	assert.equal(d.end, 1000);
});
check('recentring is equivalent to a clamped shift', () => {
	const view = { start: 100, end: 300 };
	assert.deepEqual(
		centreDomain(view, FIT, 500, MIN),
		clampDomain({ start: 400, end: 600 }, FIT, MIN)
	);
});

group('densityBuckets');
check('an empty set gives an all-zero strip of the requested width', () => {
	const b = densityBuckets([], FIT, 10);
	assert.equal(b.length, 10);
	assert.ok(b.every((n) => n === 0));
});
check('a point lands in exactly one column', () => {
	const b = densityBuckets([[500, 500]], FIT, 10);
	assert.equal(b.reduce((a, n) => a + n, 0), 1);
	assert.equal(b[5], 1);
});
check('a range covers every column it touches', () => {
	const b = densityBuckets([[0, 1000]], FIT, 10);
	assert.ok(b.every((n) => n === 1), JSON.stringify(b));
});
check('overlapping items accumulate', () => {
	const b = densityBuckets([[0, 500], [400, 1000]], FIT, 10);
	assert.equal(b[0], 1);
	assert.equal(b[9], 1);
	assert.equal(b[4], 2);
});
check('the last column is reachable rather than rounding out of bounds', () => {
	const b = densityBuckets([[1000, 1000]], FIT, 10);
	assert.equal(b[9], 1);
});
check('items outside the fit are ignored, not clamped into the edges', () => {
	const b = densityBuckets([[-500, -400], [2000, 3000]], FIT, 10);
	assert.ok(b.every((n) => n === 0), JSON.stringify(b));
});
check('an item straddling the edge is counted only where it overlaps', () => {
	const b = densityBuckets([[-500, 200]], FIT, 10);
	assert.equal(b[0], 1);
	assert.equal(b[2], 1);
	assert.equal(b[3], 0);
});
check('a degenerate fit produces zeroes rather than NaN', () => {
	const b = densityBuckets([[0, 10]], { start: 5, end: 5 }, 10);
	assert.ok(b.every((n) => n === 0));
});

group('typed range bounds');
check('the note date parser is what backs the bound fields', () => {
	assert.equal(parseDateText('3000 BC').ms, utcFromParts(-2999));
	assert.equal(parseDateText('1969').ms, utcFromParts(1969));
	assert.equal(parseDateText('1969-07-20').ms, utcFromParts(1969, 6, 20));
});
check('unreadable text is rejected so the caller can revert', () => {
	for (const text of ['', '   ', 'sometime', 'the 1960s']) {
		assert.equal(parseDateText(text), null, text);
	}
});
check('a year-only end covers the whole of that year', () => {
	assert.equal(endOfPoint(parseDateText('1969')), utcFromParts(1970));
});
check('a year-only BC end runs to the end of that BC year', () => {
	// 1000 BC is astronomical -999, so its end is the start of 999 BC, astronomical -998.
	assert.equal(endOfPoint(parseDateText('1000 BC')), utcFromParts(-998));
});
check('a dated end covers the whole of that day', () => {
	assert.equal(endOfPoint(parseDateText('1969-07-20')), utcFromParts(1969, 6, 21));
});
check('an end bound is always after its own start', () => {
	for (const text of ['3000 BC', '1 BC', '1', '1969', '1969-07', '1969-07-20']) {
		const p = parseDateText(text);
		assert.ok(endOfPoint(p) > p.ms, text);
	}
});

group('formatRangeBound');
check('a span of centuries shows the year alone', () => {
	const span = 500 * 365 * 86400000;
	assert.equal(formatRangeBound(utcFromParts(1500), span), '1500');
	assert.equal(formatRangeBound(utcFromParts(-499), span), '500 BC');
});
check('a span of days shows the full date', () => {
	const span = 10 * 86400000;
	assert.equal(formatRangeBound(utcFromParts(1969, 6, 20), span), '20 Jul 1969');
});
check('a span of months shows month and year', () => {
	const span = 120 * 86400000;
	assert.equal(formatRangeBound(utcFromParts(1969, 6, 20), span), 'Jul 1969');
});
check('what is displayed for a wide span parses back to the same year', () => {
	const wide = 500 * 365 * 86400000;
	for (const year of [-2999, -499, 1, 1066, 1969, 2026]) {
		const text = formatRangeBound(utcFromParts(year), wide);
		assert.equal(parseDateText(text).ms, utcFromParts(year), text);
	}
});
