import assert from 'node:assert';
import { check, group } from './harness.mjs';
import { clampDomain, zoomedFit } from '../build-test/layout.mjs';
import { endOfPoint, parseDateText, utcFromParts } from '../build-test/dates.mjs';

const DATA = { start: 0, end: 1000 };
const MIN = 10;
const none = { start: null, end: null };

group('zoomedFit — a view pinned to a period');
check('no configured window leaves the data extent alone', () => {
	assert.deepEqual(zoomedFit(DATA, none, MIN), DATA);
});
check('both bounds replace the data extent outright', () => {
	assert.deepEqual(zoomedFit(DATA, { start: 200, end: 400 }, MIN), { start: 200, end: 400 });
});
check('a start on its own leaves the end at the data extent', () => {
	assert.deepEqual(zoomedFit(DATA, { start: 200, end: null }, MIN), { start: 200, end: 1000 });
});
check('an end on its own leaves the start at the data extent', () => {
	assert.deepEqual(zoomedFit(DATA, { start: null, end: 400 }, MIN), { start: 0, end: 400 });
});
check('a configured window is taken literally, with no fit padding', () => {
	// The caller pads the data extent before passing it in; the window must not be padded.
	const padded = { start: -40, end: 1040 };
	assert.deepEqual(zoomedFit(padded, { start: 200, end: 400 }, MIN), { start: 200, end: 400 });
});
check('a window outside the data is honoured rather than clipped to it', () => {
	// A "Bronze Age" view of a base that happens to hold nothing yet should still show
	// the Bronze Age, empty, rather than silently snapping back to the data.
	assert.deepEqual(zoomedFit(DATA, { start: 5000, end: 6000 }, MIN), { start: 5000, end: 6000 });
});

group('zoomedFit — bad or half-typed windows fall back');
check('an inverted window reverts to the data extent', () => {
	assert.deepEqual(zoomedFit(DATA, { start: 400, end: 200 }, MIN), DATA);
});
check('an empty window reverts to the data extent', () => {
	assert.deepEqual(zoomedFit(DATA, { start: 300, end: 300 }, MIN), DATA);
});
check('a window narrower than the minimum span reverts', () => {
	assert.deepEqual(zoomedFit(DATA, { start: 300, end: 305 }, MIN), DATA);
});
check('a window exactly the minimum span is kept', () => {
	assert.deepEqual(zoomedFit(DATA, { start: 300, end: 310 }, MIN), { start: 300, end: 310 });
});
check('a lone start past the data end reverts rather than blanking the view', () => {
	// Mid-edit state: the start is typed before the end has been widened to match.
	assert.deepEqual(zoomedFit(DATA, { start: 2000, end: null }, MIN), DATA);
});
check('a lone end before the data start reverts', () => {
	assert.deepEqual(zoomedFit(DATA, { start: null, end: -500 }, MIN), DATA);
});
check('the result is never inverted, whatever is configured', () => {
	const values = [null, -500, 0, 300, 305, 1000, 5000];
	for (const start of values) {
		for (const end of values) {
			const d = zoomedFit(DATA, { start, end }, MIN);
			assert.ok(d.end - d.start >= MIN, `${start}..${end} -> ${JSON.stringify(d)}`);
		}
	}
});

group('zoom bounds parsed from the view options');
check('the note date parser backs the option fields', () => {
	assert.equal(parseDateText('3300 BC').ms, utcFromParts(-3299));
	assert.equal(parseDateText('1969').ms, utcFromParts(1969));
	assert.equal(parseDateText('1969-07-20').ms, utcFromParts(1969, 6, 20));
});
check('a blank or unreadable option yields no bound', () => {
	for (const text of ['', '   ', 'sometime', 'the 1960s']) {
		assert.equal(parseDateText(text), null, text);
	}
});
check('a year-only end covers the whole of that year', () => {
	assert.equal(endOfPoint(parseDateText('1969')), utcFromParts(1970));
});
check('a year-only BC end runs to the end of that BC year', () => {
	// 1200 BC is astronomical -1199, so its end is the start of 1199 BC, astronomical -1198.
	assert.equal(endOfPoint(parseDateText('1200 BC')), utcFromParts(-1198));
});
check('a dated end covers the whole of that day', () => {
	assert.equal(endOfPoint(parseDateText('1969-07-20')), utcFromParts(1969, 6, 21));
});
check('an end bound is always after its own start', () => {
	for (const text of ['3300 BC', '1 BC', '1', '1969', '1969-07', '1969-07-20']) {
		const p = parseDateText(text);
		assert.ok(endOfPoint(p) > p.ms, text);
	}
});

group('a Bronze Age view, end to end');
check('3300 BC to 1200 BC becomes the fit, and clamps pan and zoom to itself', () => {
	const start = parseDateText('3300 BC').ms;
	const end = endOfPoint(parseDateText('1200 BC'));
	const fit = zoomedFit({ start: utcFromParts(-14000), end: utcFromParts(2026) }, { start, end }, MIN);

	assert.equal(fit.start, utcFromParts(-3299));
	assert.equal(fit.end, utcFromParts(-1198));

	// Panning and zooming out both stay inside the named period.
	assert.deepEqual(clampDomain({ start: fit.start - 1e12, end: fit.end + 1e12 }, fit, MIN), fit);
	const panned = clampDomain({ start: fit.start + 1e11, end: fit.end + 1e11 }, fit, MIN);
	assert.ok(panned.end <= fit.end, 'pan escaped the configured window');
});
check('the whole of 1200 BC is inside the window, but 1199 BC is not', () => {
	const end = endOfPoint(parseDateText('1200 BC'));
	assert.ok(utcFromParts(-1199) < end, '1200 BC itself should be included');
	assert.ok(utcFromParts(-1198) >= end, '1199 BC should be past the end');
});
