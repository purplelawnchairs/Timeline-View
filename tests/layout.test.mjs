import assert from 'node:assert';
import { check, group } from './harness.mjs';
import { clampDomain, zoomDomain, packLanes } from '../build-test/layout.mjs';


const FIT = { start: 0, end: 1000 };
const MIN = 10;
const span = (d) => d.end - d.start;

group('clampDomain');
check('a domain already inside the fit is untouched', () => {
	assert.deepEqual(clampDomain({ start: 200, end: 400 }, FIT, MIN), { start: 200, end: 400 });
});
check('cannot zoom out past the fit range', () => {
	assert.deepEqual(clampDomain({ start: -500, end: 5000 }, FIT, MIN), FIT);
});
check('panning off the left edge is clamped, span preserved', () => {
	const d = clampDomain({ start: -300, end: -100 }, FIT, MIN);
	assert.equal(span(d), 200);
	assert.equal(d.start, 0);
});
check('panning off the right edge is clamped, span preserved', () => {
	const d = clampDomain({ start: 1200, end: 1400 }, FIT, MIN);
	assert.equal(span(d), 200);
	assert.equal(d.end, 1000);
});
check('minimum span is enforced', () => {
	assert.equal(span(clampDomain({ start: 500, end: 500.5 }, FIT, MIN)), MIN);
});
check('minSpan larger than the whole fit does not overflow the fit', () => {
	const d = clampDomain({ start: 0, end: 1 }, { start: 0, end: 5 }, 100);
	assert.ok(d.start >= 0 && d.end <= 5, `${d.start}..${d.end} escaped a tiny fit`);
});
check('degenerate fit does not produce NaN', () => {
	const d = clampDomain({ start: 5, end: 9 }, { start: 3, end: 3 }, MIN);
	assert.ok(Number.isFinite(d.start) && Number.isFinite(d.end));
});

group('zoomDomain');
check('zooming in keeps the time under the cursor fixed', () => {
	const view = { start: 200, end: 600 };
	const ratio = 0.25;
	const anchorBefore = view.start + ratio * span(view); // 300
	const next = zoomDomain(view, FIT, ratio, 0.5, MIN);
	const anchorAfter = next.start + ratio * span(next);
	assert.ok(Math.abs(anchorAfter - anchorBefore) < 1e-9, `${anchorAfter} != ${anchorBefore}`);
	assert.ok(span(next) < span(view), 'should have zoomed in');
});
check('zoom in then out by the inverse returns to the start', () => {
	const view = { start: 200, end: 600 };
	const zoomed = zoomDomain(view, FIT, 0.5, 0.5, MIN);
	const back = zoomDomain(zoomed, FIT, 0.5, 2, MIN);
	assert.ok(Math.abs(back.start - view.start) < 1e-9 && Math.abs(back.end - view.end) < 1e-9,
		`${back.start}..${back.end}`);
});
check('zooming out is clamped to the fit and never escapes it', () => {
	let view = { start: 400, end: 500 };
	for (let i = 0; i < 60; i++) view = zoomDomain(view, FIT, 0.9, 1.4, MIN);
	assert.deepEqual(view, FIT);
});
check('zooming in repeatedly bottoms out at minSpan without inverting', () => {
	let view = { ...FIT };
	for (let i = 0; i < 100; i++) view = zoomDomain(view, FIT, 0.3, 0.7, MIN);
	assert.equal(span(view), MIN);
	assert.ok(view.start >= FIT.start && view.end <= FIT.end);
});
check('zoom at the far edge stays inside the fit', () => {
	const next = zoomDomain({ start: 900, end: 1000 }, FIT, 1, 2, MIN);
	assert.ok(next.end <= FIT.end && next.start >= FIT.start, `${next.start}..${next.end}`);
});

group('packLanes');
check('non-overlapping items all share lane 0', () => {
	assert.deepEqual(packLanes([[0, 10], [20, 30], [40, 50]], 6), [0, 0, 0]);
});
check('overlapping items stack into separate lanes', () => {
	assert.deepEqual(packLanes([[0, 100], [10, 50], [20, 60]], 6), [0, 1, 2]);
});
check('gap is respected — items closer than the gap do not share a lane', () => {
	assert.deepEqual(packLanes([[0, 10], [12, 20]], 6), [0, 1]);
	assert.deepEqual(packLanes([[0, 10], [16, 20]], 6), [0, 0]);
});
check('an item reuses the lowest free lane, not a new one', () => {
	// third item starts after the first ends, so it belongs back in lane 0
	assert.deepEqual(packLanes([[0, 10], [5, 100], [30, 40]], 6), [0, 1, 0]);
});
check('lane end tracks the furthest right edge in that lane', () => {
	// [50,60] must not reuse lane 0, whose true extent reaches 200
	const lanes = packLanes([[0, 200], [0, 10], [50, 60]], 6);
	assert.notEqual(lanes[0], lanes[2], 'item overlapping a long bar reused its lane');
});
check('identical points each get their own lane', () => {
	assert.deepEqual(packLanes([[0, 14], [0, 14], [0, 14]], 6), [0, 1, 2]);
});
check('empty input yields no lanes', () => {
	assert.deepEqual(packLanes([], 6), []);
});
check('no two items in the same lane ever overlap', () => {
	// randomised sweep
	let seed = 42;
	const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
	for (let trial = 0; trial < 200; trial++) {
		const extents = [];
		for (let i = 0; i < 40; i++) {
			const x0 = Math.floor(rnd() * 800);
			extents.push([x0, x0 + Math.floor(rnd() * 120)]);
		}
		extents.sort((a, b) => a[0] - b[0]);
		const lanes = packLanes(extents, 6);
		const byLane = new Map();
		extents.forEach((e, i) => {
			const list = byLane.get(lanes[i]) ?? [];
			list.push(e);
			byLane.set(lanes[i], list);
		});
		for (const list of byLane.values()) {
			for (let i = 1; i < list.length; i++) {
				assert.ok(list[i][0] >= list[i - 1][1] + 6,
					`overlap in trial ${trial}: ${JSON.stringify(list[i - 1])} vs ${JSON.stringify(list[i])}`);
			}
		}
	}
});

