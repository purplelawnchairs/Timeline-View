import assert from 'node:assert';
import { check, group } from './harness.mjs';
import { packLanes, reserveLabel } from '../build-test/layout.mjs';

const GAP = 6;
const LANE_GAP = 6;

group('reserveLabel');
check('no label leaves the extent untouched', () => {
	assert.deepEqual(reserveLabel([100, 114], 0, GAP), [100, 114]);
});
check('a label extends only the right edge', () => {
	assert.deepEqual(reserveLabel([100, 114], 40, GAP), [100, 160]);
});
check('the shape start is never moved', () => {
	const [x0] = reserveLabel([100, 114], 500, GAP);
	assert.equal(x0, 100);
});
check('a negative or zero width is ignored rather than shrinking the extent', () => {
	assert.deepEqual(reserveLabel([100, 114], -20, GAP), [100, 114]);
});
check('reserved extent is always at least the shape extent', () => {
	for (const w of [0, 1, 10, 250]) {
		const shape = [50, 64];
		const [x0, x1] = reserveLabel(shape, w, GAP);
		assert.ok(x0 <= shape[0] && x1 >= shape[1], `width ${w}`);
	}
});

group('labels and lane packing');
check('two dots that fit side by side share a lane when unlabelled', () => {
	const extents = [[0, 14], [40, 54]].map((e) => reserveLabel(e, 0, GAP));
	assert.deepEqual(packLanes(extents, LANE_GAP), [0, 0]);
});
check('a label long enough to reach the next dot forces a new lane', () => {
	// Dot at 0 with a 100px label runs to 120; the next dot starts at 40.
	const extents = [reserveLabel([0, 14], 100, GAP), reserveLabel([40, 54], 0, GAP)];
	assert.deepEqual(packLanes(extents, LANE_GAP), [0, 1]);
});
check('a label that stops short of the next dot still shares a lane', () => {
	const extents = [reserveLabel([0, 14], 10, GAP), reserveLabel([40, 54], 0, GAP)];
	assert.deepEqual(packLanes(extents, LANE_GAP), [0, 0]);
});
check('no label ever overlaps a following item in the same lane', () => {
	let seed = 7;
	const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
	for (let trial = 0; trial < 200; trial++) {
		const raw = [];
		for (let i = 0; i < 30; i++) {
			const x0 = Math.floor(rnd() * 700);
			const shape = [x0, x0 + 14 + Math.floor(rnd() * 60)];
			raw.push(reserveLabel(shape, Math.floor(rnd() * 140), GAP));
		}
		raw.sort((a, b) => a[0] - b[0]);
		const lanes = packLanes(raw, LANE_GAP);
		const byLane = new Map();
		raw.forEach((e, i) => {
			const list = byLane.get(lanes[i]) ?? [];
			list.push(e);
			byLane.set(lanes[i], list);
		});
		for (const list of byLane.values()) {
			for (let i = 1; i < list.length; i++) {
				assert.ok(list[i][0] >= list[i - 1][1] + LANE_GAP,
					`label overlap in trial ${trial}: ${JSON.stringify(list[i - 1])} then ${JSON.stringify(list[i])}`);
			}
		}
	}
});
