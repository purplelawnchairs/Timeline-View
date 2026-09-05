import assert from 'node:assert';
import { check, group } from './harness.mjs';
import { labelSide, packLanes, reserveLabel } from '../build-test/layout.mjs';

const GAP = 6;
const LANE_GAP = 6;
const WIDTH = 800;

group('labelSide');
check('a label with room on the right stays on the right', () => {
	assert.equal(labelSide([100, 114], 60, GAP, WIDTH), 'right');
});
check('an unlabelled item is always nominally right', () => {
	assert.equal(labelSide([790, 800], 0, GAP, WIDTH), 'right');
});
check('a label that would run past the right edge flips left', () => {
	// Shape ends at 780; a 60px label needs 786..846, past the 800px plot.
	assert.equal(labelSide([766, 780], 60, GAP, WIDTH), 'left');
});
check('a label that ends exactly at the right edge does not flip', () => {
	assert.equal(labelSide([700, 734], 60, GAP, WIDTH), 'right');
});
check('an item at the left edge keeps its label on the right', () => {
	assert.equal(labelSide([0, 14], 60, GAP, WIDTH), 'right');
});
check('a label too wide for either side picks the smaller overflow', () => {
	// Narrow plot: 40px wide label, shape hugging the right, no room either way.
	assert.equal(labelSide([30, 44], 400, GAP, 50), 'left');
	assert.equal(labelSide([2, 16], 400, GAP, 50), 'right');
});
check('every far-right item flips, across plot widths and label widths', () => {
	for (const width of [200, 400, 800, 1600]) {
		for (const label of [20, 60, 140]) {
			const shape = [width - 14, width];
			// There is room on the left in all these cases, so the flip must happen.
			assert.equal(labelSide(shape, label, GAP, width), 'left', `${width}/${label}`);
		}
	}
});

group('reserveLabel with a side');
check('a left label extends the start, not the end', () => {
	assert.deepEqual(reserveLabel([100, 114], 40, GAP, 'left'), [54, 114]);
});
check('an explicit right side matches the default', () => {
	assert.deepEqual(reserveLabel([100, 114], 40, GAP, 'right'), reserveLabel([100, 114], 40, GAP));
});
check('a left label on an unlabelled item is a no-op', () => {
	assert.deepEqual(reserveLabel([100, 114], 0, GAP, 'left'), [100, 114]);
});
check('the reserved extent always contains the shape, either side', () => {
	for (const side of ['left', 'right']) {
		for (const w of [0, 1, 10, 250]) {
			const shape = [50, 64];
			const [x0, x1] = reserveLabel(shape, w, GAP, side);
			assert.ok(x0 <= shape[0] && x1 >= shape[1], `${side} width ${w}`);
		}
	}
});

group('flipped labels and lane packing');
check('a left label is packed against what precedes it, not what follows', () => {
	// Dot at 200 with a 100px label on its left runs back to 94; a dot ending at 114
	// therefore collides and the two cannot share a lane.
	const extents = [
		reserveLabel([100, 114], 0, GAP, 'right'),
		reserveLabel([200, 214], 100, GAP, 'left'),
	].sort((a, b) => a[0] - b[0]);
	assert.deepEqual(packLanes(extents, LANE_GAP), [0, 1]);
});
check('flipped labels never overlap within a lane once sorted by reserved start', () => {
	let seed = 11;
	const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

	for (let trial = 0; trial < 200; trial++) {
		const raw = [];
		for (let i = 0; i < 30; i++) {
			const x0 = Math.floor(rnd() * (WIDTH - 20));
			const shape = [x0, x0 + 14 + Math.floor(rnd() * 60)];
			const labelWidth = Math.floor(rnd() * 140);
			const side = labelSide(shape, labelWidth, GAP, WIDTH);
			raw.push(reserveLabel(shape, labelWidth, GAP, side));
		}
		// This is the sort the view applies: on the reserved start, which a left-hand
		// label moves, rather than on the item's own time order.
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
				assert.ok(
					list[i][0] >= list[i - 1][1] + LANE_GAP,
					`overlap in trial ${trial}: ${JSON.stringify(list[i - 1])} then ${JSON.stringify(list[i])}`
				);
			}
		}
	}
});
