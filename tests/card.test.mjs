import assert from 'node:assert';
import { check, group } from './harness.mjs';
import { anchorCard } from '../build-test/layout.mjs';


const VIEW = { width: 800, height: 400 };
const CARD = { width: 200, height: 70 };
const GAP = 8;
const PAD = 6;
const place = (item, view = VIEW, card = CARD) => anchorCard(view, item, card, GAP, PAD);

// A dot sitting mid-canvas, well clear of every edge.
const midItem = { left: 400, top: 200, width: 14, height: 14 };

group('anchorCard');
check('card is centred horizontally on the item', () => {
	const p = place(midItem);
	assert.equal(p.left + CARD.width / 2, midItem.left + midItem.width / 2);
});
check('card sits above the item by the gap', () => {
	const p = place(midItem);
	assert.equal(p.top + CARD.height + GAP, midItem.top);
});
check('placement does not depend on the cursor — same item, same spot', () => {
	// The whole point of the fix: nothing but the item feeds into the position.
	assert.deepEqual(place(midItem), place({ ...midItem }));
});
check('card never overlaps the item it describes', () => {
	for (const top of [0, 5, 50, 200, 380, 395]) {
		const item = { left: 400, top, width: 14, height: 14 };
		const p = place(item);
		const overlapsVertically = p.top < item.top + item.height && p.top + CARD.height > item.top;
		const overlapsHorizontally = p.left < item.left + item.width && p.left + CARD.width > item.left;
		assert.ok(!(overlapsVertically && overlapsHorizontally), `overlap at item top=${top}`);
	}
});
check('flips below when there is no room above', () => {
	const item = { left: 400, top: 10, width: 14, height: 14 };
	const p = place(item);
	assert.equal(p.top, item.top + item.height + GAP, 'should sit below the item');
});
check('stays pinned inside the view when it fits neither above nor below', () => {
	const shortView = { width: 800, height: 90 };
	const item = { left: 400, top: 40, width: 14, height: 14 };
	const p = place(item, shortView);
	assert.ok(p.top >= PAD, `top ${p.top} escaped the view`);
});
check('clamped at the left edge', () => {
	const p = place({ left: 2, top: 200, width: 14, height: 14 });
	assert.equal(p.left, PAD);
});
check('clamped at the right edge', () => {
	const p = place({ left: 790, top: 200, width: 14, height: 14 });
	assert.equal(p.left + CARD.width, VIEW.width - PAD);
});
check('a card wider than the view still starts inside it', () => {
	const p = place(midItem, { width: 150, height: 400 }, { width: 300, height: 70 });
	assert.equal(p.left, PAD);
});
check('a wide range bar is centred on the bar, not its start', () => {
	const bar = { left: 100, top: 200, width: 400, height: 14 };
	const p = place(bar);
	assert.equal(p.left + CARD.width / 2, 300);
});
check('card always lands within the view bounds', () => {
	for (const left of [-50, 0, 10, 400, 780, 900]) {
		for (const top of [0, 30, 200, 390]) {
			const p = place({ left, top, width: 14, height: 14 });
			assert.ok(p.left >= PAD - 0.001, `left ${p.left}`);
			assert.ok(p.top >= PAD - 0.001, `top ${p.top}`);
			assert.ok(p.left + CARD.width <= VIEW.width - PAD + 0.001, `right ${p.left + CARD.width}`);
		}
	}
});

