/** Pure geometry for the timeline: domain (zoom/pan) maths and lane packing. */

export interface Domain {
	start: number;
	end: number;
}

/**
 * Keep the visible domain inside the auto-fit bounds and within the zoom limits.
 * Zooming out past the fit range is clamped, as is panning off either end.
 */
export function clampDomain(view: Domain, fit: Domain, minSpan: number): Domain {
	const fitSpan = fit.end - fit.start;
	if (fitSpan <= 0) return { start: fit.start, end: fit.start };

	const span = Math.min(Math.max(view.end - view.start, Math.min(minSpan, fitSpan)), fitSpan);

	let start = view.start;
	if (start + span > fit.end) start = fit.end - span;
	if (start < fit.start) start = fit.start;

	return { start, end: start + span };
}

/**
 * Zoom by `factor` (>1 zooms out) keeping the time under the cursor fixed.
 * `cursorRatio` is the cursor's horizontal position as a 0..1 fraction of the plot.
 */
export function zoomDomain(
	view: Domain,
	fit: Domain,
	cursorRatio: number,
	factor: number,
	minSpan: number
): Domain {
	const fitSpan = fit.end - fit.start;
	const span = view.end - view.start;
	if (fitSpan <= 0 || span <= 0) return view;

	const anchor = view.start + cursorRatio * span;
	const nextSpan = Math.min(Math.max(span * factor, Math.min(minSpan, fitSpan)), fitSpan);

	return clampDomain(
		{ start: anchor - cursorRatio * nextSpan, end: anchor - cursorRatio * nextSpan + nextSpan },
		fit,
		minSpan
	);
}

/**
 * Widen a shape's pixel extent to reserve room for its label. Lane packing works on the
 * reserved extent so a label never overlaps the next item along, while only the shape
 * itself is drawn to the original extent.
 */
export function reserveLabel(
	shape: [number, number],
	labelWidth: number,
	gap: number
): [number, number] {
	if (labelWidth <= 0) return shape;
	return [shape[0], shape[1] + gap + labelWidth];
}

export interface Box {
	width: number;
	height: number;
}

export interface PlacedBox extends Box {
	left: number;
	top: number;
}

/**
 * Place the hover card against an item rather than against the cursor, so it does
 * not move while the pointer travels toward it. Preference is centred above the
 * item; it flips below only when there is room there, and is always kept inside
 * the view by `pad`.
 *
 * `item` is expressed in coordinates relative to the view.
 */
export function anchorCard(
	view: Box,
	item: PlacedBox,
	card: Box,
	gap: number,
	pad: number
): { left: number; top: number } {
	let left = item.left + item.width / 2 - card.width / 2;
	const maxLeft = Math.max(view.width - card.width - pad, pad);
	left = Math.min(Math.max(left, pad), maxLeft);

	let top = item.top - card.height - gap;
	if (top < pad) {
		const below = item.top + item.height + gap;
		top = below + card.height <= view.height - pad ? below : pad;
	}

	return { left, top };
}

/**
 * Greedy lane assignment. `extents` are [x0, x1] pixel spans, which must be sorted
 * ascending by x0. Each item takes the first lane it does not collide in, else a new
 * lane is opened. Returns the lane index for each input, parallel to `extents`.
 */
export function packLanes(extents: Array<[number, number]>, gap: number): number[] {
	const laneEnds: number[] = [];
	const lanes: number[] = [];

	for (const [x0, x1] of extents) {
		let lane = -1;
		for (let i = 0; i < laneEnds.length; i++) {
			if (laneEnds[i] + gap <= x0) {
				lane = i;
				break;
			}
		}
		if (lane === -1) {
			lane = laneEnds.length;
			laneEnds.push(x1);
		} else {
			laneEnds[lane] = Math.max(laneEnds[lane], x1);
		}
		lanes.push(lane);
	}

	return lanes;
}
