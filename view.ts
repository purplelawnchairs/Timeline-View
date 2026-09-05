import {
	BasesEntry,
	BasesPropertyId,
	BasesView,
	HoverParent,
	HoverPopover,
	Keymap,
	QueryController,
	Value,
} from 'obsidian';

import { buildTicks, parseAxisInterval } from './axis';
import { formatPoint, resolveSpan, TimePoint, todayMs, toTimePoint } from './dates';
import {
	anchorCard,
	clampDomain,
	Domain,
	LabelSide,
	labelSide,
	packLanes,
	reserveLabel,
	zoomDomain,
} from './layout';

export const TIMELINE_VIEW_TYPE = 'timeline';

export const KEY_DATE = 'dateProperty';
export const KEY_START = 'startProperty';
export const KEY_END = 'endProperty';
export const KEY_CATEGORY = 'categoryProperty';
export const KEY_AXIS_INTERVAL = 'axisInterval';
export const KEY_SHOW_AXIS = 'showAxis';
export const KEY_SHOW_LABELS = 'showLabels';
export const KEY_LABEL = 'labelProperty';
export const KEY_EXTEND_OPEN = 'extendOpenRanges';
export const KEY_SHOW_GROUPS = 'showGroups';

export const DEFAULT_DATE: BasesPropertyId = 'note.date';
export const DEFAULT_START: BasesPropertyId = 'note.date_start';
export const DEFAULT_END: BasesPropertyId = 'note.date_end';
export const DEFAULT_CATEGORY: BasesPropertyId = 'note.category';
export const DEFAULT_LABEL: BasesPropertyId = 'file.name';

/** Obsidian's built-in accent colours, cycled in first-seen category order. */
const PALETTE = [
	'var(--color-blue)',
	'var(--color-orange)',
	'var(--color-green)',
	'var(--color-purple)',
	'var(--color-red)',
	'var(--color-cyan)',
	'var(--color-yellow)',
	'var(--color-pink)',
];
const UNCATEGORISED_COLOR = 'var(--text-muted)';

const LANE_HEIGHT = 22;
const ITEM_HEIGHT = 14;
const DOT_SIZE = 14;
const MIN_RANGE_WIDTH = 14;
const LANE_GAP_PX = 6;
const TOP_PADDING = 10;
const CULL_MARGIN = 200;
/** Floor for the plot area, so an embedded base with one or two lanes is not a sliver. */
const MIN_PLOT_HEIGHT = 120;

/** Must match --timeline-label-gap in styles.css. */
const LABEL_GAP_PX = 6;
/**
 * Slack beneath lane 0, mirroring --timeline-baseline-offset in styles.css. Label text
 * boxes are taller than the 14px item under some themes' font sizes, and anything that
 * spills below the plot creates scroll overflow — which shows a scrollbar on every
 * embedded base. This absorbs it without depending on the theme's font metrics.
 */
const BASELINE_OFFSET_PX = 3;
/** Labels are truncated rather than left to consume unbounded lane width. */
const MAX_LABEL_CHARS = 60;

const MS_DAY = 86400000;
const MIN_SPAN_MS = MS_DAY;
const FIT_PADDING_RATIO = 0.04;

/** Height of a group's title row, and the gap between one band and the next. */
const GROUP_HEADER_HEIGHT = 20;
const GROUP_GAP_PX = 10;
/** A band with a single lane still needs room for its header and baseline. */
const MIN_BAND_HEIGHT = 44;

const MIDDLE_BUTTON = 1;
const DRAG_THRESHOLD_PX = 6;
/**
 * A finger is blunter than a mouse, and a tap almost always drifts a pixel or two.
 * Judging touch by the mouse threshold turns taps into pans and swallows the open.
 */
const TOUCH_DRAG_THRESHOLD_PX = 12;
const CARD_HIDE_DELAY_MS = 220;
/** Gap between an item and its card, and the card's minimum inset from the view edge. */
const CARD_ANCHOR_GAP = 8;
const CARD_EDGE_PAD = 6;

/**
 * A property the user has pointed at but which does not exist on an entry (or which
 * evaluates to an error) must not take down the whole view.
 */
function readValue(entry: BasesEntry, prop: BasesPropertyId): Value | null {
	try {
		return entry.getValue(prop);
	} catch (e) {
		return null;
	}
}

/**
 * Read a property as a single line of display text. Whitespace is collapsed because a
 * multi-line property value would otherwise break the single-line lane layout.
 */
function readText(entry: BasesEntry, prop: BasesPropertyId): string {
	const value = readValue(entry, prop);
	if (!value) return '';
	try {
		if (!value.isTruthy()) return '';
		return value.toString().replace(/\s+/g, ' ').trim();
	} catch (e) {
		return '';
	}
}

function truncate(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

interface TimelineItem {
	path: string;
	title: string;
	isRange: boolean;
	/** The end is unknown and the bar runs to today; see resolveSpan(). */
	isOpen: boolean;
	start: TimePoint;
	end: TimePoint;
	category: string | null;
	color: string;
	/** Empty when labels are off or the label property is empty for this entry. */
	label: string;
	lane: number;
	/** Index into `this.groups`. */
	group: number;
	side: LabelSide;
	el: HTMLElement;
	labelEl: HTMLElement;
}

/**
 * One horizontal band of the timeline, holding the entries of a single Bases groupBy
 * key. Bands share the x axis and stack vertically, so overlaps within a band and
 * alignment across bands are both readable. With no groupBy configured there is a
 * single unnamed band, which renders exactly as the ungrouped view always did.
 */
interface TimelineGroup {
	key: string;
	items: TimelineItem[];
	laneCount: number;
	el: HTMLElement;
	headerEl: HTMLElement;
}

export class TimelineView extends BasesView implements HoverParent {
	type = TIMELINE_VIEW_TYPE;
	hoverPopover: HoverPopover | null = null;

	containerEl: HTMLElement;

	private rootEl: HTMLElement;
	private canvasEl: HTMLElement;
	private scrollEl: HTMLElement;
	private plotEl: HTMLElement;
	private axisEl: HTMLElement;
	private emptyEl: HTMLElement;
	private cardEl: HTMLElement;

	private items: TimelineItem[] = [];
	private groups: TimelineGroup[] = [];
	/** True when Bases has a groupBy configured, so bands carry titles and separators. */
	private grouped = false;
	private itemsByPath = new Map<string, TimelineItem>();
	private elCache = new Map<string, HTMLElement>();
	private categoryColors = new Map<string, string>();
	private labelWidths = new Map<string, number>();
	private measureEl: HTMLElement;

	/** Visible domain, in epoch milliseconds. */
	private viewStart = 0;
	private viewEnd = 0;
	/** Auto-fit bounds across all plotted entries; also the zoom-out and pan clamp. */
	private fitStart: number | null = null;
	private fitEnd: number | null = null;

	private plotWidth = 0;
	private lastPlotHeight = 0;

	private dragging = false;
	private dragMoved = false;
	private dragPointerId = -1;
	private dragOriginX = 0;
	private dragOriginY = 0;
	private dragOriginStart = 0;
	private dragOriginScrollTop = 0;

	/**
	 * Live pointers on the canvas, keyed by pointerId. Touch needs the full set rather
	 * than a single drag pointer: two fingers is a pinch, and a second finger landing
	 * mid-pan has to end the pan cleanly rather than fight it.
	 */
	private pointers = new Map<number, { x: number; y: number }>();
	private pinching = false;
	private pinchDistance = 0;

	private cardItem: TimelineItem | null = null;
	private cardHideTimer: number | null = null;
	private cardLinkEl: HTMLAnchorElement;
	private cardDateEl: HTMLElement;
	private cardCategoryEl: HTMLElement;
	private cardSwatchEl: HTMLElement;
	private cardCategoryTextEl: HTMLElement;
	private resizeObserver: ResizeObserver | null = null;

	constructor(controller: QueryController, containerEl: HTMLElement) {
		super(controller);
		this.containerEl = containerEl;

		this.rootEl = containerEl.createDiv({ cls: 'timeline-view' });
		this.canvasEl = this.rootEl.createDiv({ cls: 'timeline-canvas' });
		this.scrollEl = this.canvasEl.createDiv({ cls: 'timeline-scroll' });
		this.plotEl = this.scrollEl.createDiv({ cls: 'timeline-plot' });
		this.axisEl = this.rootEl.createDiv({ cls: 'timeline-axis' });
		this.emptyEl = this.rootEl.createDiv({
			cls: 'timeline-empty',
			text: 'No dated notes match this Base',
		});

		// The card is built once and its contents swapped per item, so its listeners
		// are registered a single time rather than on every hover.
		this.cardEl = this.rootEl.createDiv({ cls: 'timeline-card' });
		this.cardLinkEl = this.cardEl.createEl('a', { cls: 'internal-link timeline-card-title' });
		this.cardDateEl = this.cardEl.createDiv({ cls: 'timeline-card-date' });
		this.cardCategoryEl = this.cardEl.createDiv({ cls: 'timeline-card-category' });
		this.cardSwatchEl = this.cardCategoryEl.createSpan({ cls: 'timeline-card-swatch' });
		this.cardCategoryTextEl = this.cardCategoryEl.createSpan();
		this.cardEl.hide();

		// Offscreen sizing box for label text; see measureLabels().
		this.measureEl = this.rootEl.createDiv({ cls: 'timeline-measure' });

		this.registerInteractions();
	}

	onload(): void {
		this.resizeObserver = new ResizeObserver(() => this.layout());
		this.resizeObserver.observe(this.canvasEl);
		this.register(() => {
			this.resizeObserver?.disconnect();
			this.resizeObserver = null;
		});
	}

	onunload(): void {
		this.clearCardTimer();
		this.pointers.clear();
		this.pinching = false;
		this.rootEl.detach();
	}

	// -------------------------------------------------------------------------
	// Data
	// -------------------------------------------------------------------------

	onDataUpdated(): void {
		this.rebuildItems();
		this.syncElements();
		this.updateFitRange();
		this.layout();
	}

	private propId(key: string, fallback: BasesPropertyId): BasesPropertyId {
		return this.config.getAsPropertyId(key) ?? fallback;
	}

	private rebuildItems(): void {
		const dateProp = this.propId(KEY_DATE, DEFAULT_DATE);
		const startProp = this.propId(KEY_START, DEFAULT_START);
		const endProp = this.propId(KEY_END, DEFAULT_END);
		const categoryProp = this.propId(KEY_CATEGORY, DEFAULT_CATEGORY);
		const labelProp = this.readShowLabels() ? this.propId(KEY_LABEL, DEFAULT_LABEL) : null;
		const extendOpen = this.readExtendOpen();
		// Sampled once per data update rather than per entry, so every open period in a
		// rebuild shares one end and they line up exactly.
		const now = todayMs();

		const items: TimelineItem[] = [];
		const byPath = new Map<string, TimelineItem>();
		const buckets: Array<{ key: string; items: TimelineItem[] }> = [];
		let anyKeyed = false;

		const sourceGroups = this.data.groupedData;
		for (let g = 0; g < sourceGroups.length; g++) {
			const source = sourceGroups[g];
			const bucket = { key: this.groupKeyText(source), items: [] as TimelineItem[] };
			if (this.hasGroupKey(source)) anyKeyed = true;

			for (const entry of source.entries) {
				const item = this.buildItem(
					entry,
					dateProp,
					startProp,
					endProp,
					categoryProp,
					labelProp,
					extendOpen,
					now
				);
				if (!item) continue;
				// One entry per file; a duplicate path would collide in the element cache.
				if (byPath.has(item.path)) continue;
				item.group = buckets.length;
				items.push(item);
				bucket.items.push(item);
				byPath.set(item.path, item);
			}
			buckets.push(bucket);
		}

		// A groupBy that yields one band adds a title and a separator but no structure,
		// so only treat the view as grouped when Bases actually keyed the data.
		this.grouped = anyKeyed && this.readShowGroups();
		this.items = items;
		this.itemsByPath = byPath;
		this.syncGroups(buckets);
		this.measureLabels(items);
	}

	/** The groupBy key as display text; blank keys become an explicit bucket name. */
	private groupKeyText(source: { key?: Value; hasKey?: () => boolean }): string {
		if (!this.hasGroupKey(source)) return 'Ungrouped';
		try {
			const text = String(source.key).replace(/\s+/g, ' ').trim();
			return text === '' ? 'Ungrouped' : text;
		} catch (e) {
			return 'Ungrouped';
		}
	}

	private hasGroupKey(source: { key?: Value; hasKey?: () => boolean }): boolean {
		try {
			if (typeof source.hasKey === 'function') return source.hasKey();
		} catch (e) {
			// Fall through to the key check below.
		}
		return source.key !== null && source.key !== undefined;
	}

	/**
	 * Bands are recreated only when the group keys change, so a plain data refresh does
	 * not detach and rebuild every item element underneath them.
	 */
	private syncGroups(buckets: Array<{ key: string; items: TimelineItem[] }>): void {
		const sameShape =
			this.groups.length === buckets.length &&
			this.groups.every((g, i) => g.key === buckets[i].key);

		if (!sameShape) {
			for (const group of this.groups) group.el.detach();
			this.groups = buckets.map((bucket) => {
				const el = this.plotEl.createDiv({ cls: 'timeline-group' });
				const headerEl = el.createDiv({ cls: 'timeline-group-header', text: bucket.key });
				el.createDiv({ cls: 'timeline-baseline' });
				return { key: bucket.key, items: [], laneCount: 1, el, headerEl };
			});
		}

		for (let i = 0; i < this.groups.length; i++) {
			this.groups[i].items = buckets[i].items;
			this.groups[i].headerEl.toggle(this.grouped);
		}
		this.plotEl.toggleClass('is-grouped', this.grouped);
	}

	private buildItem(
		entry: BasesEntry,
		dateProp: BasesPropertyId,
		startProp: BasesPropertyId,
		endProp: BasesPropertyId,
		categoryProp: BasesPropertyId,
		labelProp: BasesPropertyId | null,
		extendOpen: boolean,
		now: number
	): TimelineItem | null {
		const span = resolveSpan(
			toTimePoint(readValue(entry, startProp)),
			toTimePoint(readValue(entry, endProp)),
			toTimePoint(readValue(entry, dateProp)),
			now,
			extendOpen
		);
		if (!span) return null;

		const categoryText = readText(entry, categoryProp);
		const category = categoryText === '' ? null : categoryText;

		return {
			path: entry.file.path,
			title: entry.file.basename,
			isRange: span.isRange,
			isOpen: span.isOpen,
			start: span.start,
			end: span.end,
			category,
			color: this.colorFor(category),
			label: labelProp === null ? '' : truncate(readText(entry, labelProp), MAX_LABEL_CHARS),
			lane: 0,
			group: 0,
			side: 'right',
			el: null as unknown as HTMLElement,
			labelEl: null as unknown as HTMLElement,
		};
	}

	/**
	 * Label widths feed into lane packing, which reruns on every pan and zoom frame.
	 * Measuring in that path would force a reflow per frame, so all label text is
	 * measured once per data update in a single batch and cached by string.
	 */
	private measureLabels(items: TimelineItem[]): void {
		this.labelWidths.clear();

		const texts = new Set<string>();
		for (const item of items) {
			if (item.label) texts.add(item.label);
		}
		if (texts.size === 0) return;

		const unique = Array.from(texts);
		this.measureEl.empty();
		const spans = unique.map((text) =>
			this.measureEl.createSpan({ cls: 'timeline-item-label', text })
		);
		// Every write above happens before the first read below, so this costs one reflow.
		unique.forEach((text, i) => this.labelWidths.set(text, spans[i].offsetWidth));
		this.measureEl.empty();
	}

	private labelWidth(item: TimelineItem): number {
		return item.label ? this.labelWidths.get(item.label) ?? 0 : 0;
	}

	private colorFor(category: string | null): string {
		if (category === null) return UNCATEGORISED_COLOR;
		let color = this.categoryColors.get(category);
		if (!color) {
			color = PALETTE[this.categoryColors.size % PALETTE.length];
			this.categoryColors.set(category, color);
		}
		return color;
	}

	// -------------------------------------------------------------------------
	// Element reuse
	// -------------------------------------------------------------------------

	private syncElements(): void {
		for (const item of this.items) {
			let el = this.elCache.get(item.path);
			if (!el) {
				el = this.createItemEl(item.path);
				this.elCache.set(item.path, el);
			}
			item.el = el;
			item.labelEl = el.querySelector('.timeline-item-label') as HTMLElement;

			// An entry can move between bands when the groupBy property is edited.
			const band = this.groups[item.group]?.el ?? this.plotEl;
			if (el.parentElement !== band) band.appendChild(el);

			el.toggleClass('is-range', item.isRange);
			el.toggleClass('is-point', !item.isRange);
			el.toggleClass('is-open', item.isOpen);
			el.style.setProperty('--timeline-item-color', item.color);
			el.setAttribute('aria-label', item.title);

			item.labelEl.setText(item.label);
			item.labelEl.toggle(item.label !== '');
		}

		const stale: string[] = [];
		this.elCache.forEach((el, path) => {
			if (!this.itemsByPath.has(path)) {
				el.detach();
				stale.push(path);
			}
		});
		for (const path of stale) this.elCache.delete(path);

		if (this.cardItem && !this.itemsByPath.has(this.cardItem.path)) this.hideCard();
	}

	private createItemEl(path: string): HTMLElement {
		// Interaction is delegated to the canvas, so items carry no listeners of their
		// own and can be created and discarded freely as the filtered set changes.
		// The parent band is assigned in syncElements(), which knows the item's group.
		const el = createDiv({ cls: 'timeline-item' });
		el.dataset.path = path;

		// The shape is a child rather than the item itself so that the bar's opacity and
		// the hover filter apply to the dot or bar alone, leaving the label crisp.
		const shape = el.createDiv({ cls: 'timeline-shape' });
		shape.createDiv({ cls: 'timeline-cap is-start' });
		shape.createDiv({ cls: 'timeline-cap is-end' });

		el.createSpan({ cls: 'timeline-item-label' });
		return el;
	}

	/** Resolve the timeline item under an event target, if any. */
	private itemAt(target: EventTarget | null): TimelineItem | null {
		if (!(target instanceof Element)) return null;
		const el = target.closest('.timeline-item');
		if (!(el instanceof HTMLElement)) return null;
		const path = el.dataset.path;
		return path ? this.itemsByPath.get(path) ?? null : null;
	}

	// -------------------------------------------------------------------------
	// Domain & layout
	// -------------------------------------------------------------------------

	private updateFitRange(): void {
		if (this.items.length === 0) {
			this.fitStart = this.fitEnd = null;
			return;
		}

		let min = Infinity;
		let max = -Infinity;
		for (const item of this.items) {
			if (item.start.ms < min) min = item.start.ms;
			if (item.end.ms > max) max = item.end.ms;
		}

		const span = max - min;
		const pad = span > 0 ? span * FIT_PADDING_RATIO : 182 * MS_DAY;
		const nextStart = min - pad;
		const nextEnd = max + pad;

		const changed = nextStart !== this.fitStart || nextEnd !== this.fitEnd;
		this.fitStart = nextStart;
		this.fitEnd = nextEnd;

		if (changed || this.viewEnd <= this.viewStart) {
			// Data span moved: re-fit rather than stranding the user off-range.
			this.viewStart = nextStart;
			this.viewEnd = nextEnd;
		} else {
			this.clampView();
		}
	}

	private fitDomain(): Domain | null {
		if (this.fitStart === null || this.fitEnd === null) return null;
		return { start: this.fitStart, end: this.fitEnd };
	}

	private applyDomain(domain: Domain): void {
		this.viewStart = domain.start;
		this.viewEnd = domain.end;
	}

	private clampView(): void {
		const fit = this.fitDomain();
		if (!fit) return;
		this.applyDomain(clampDomain({ start: this.viewStart, end: this.viewEnd }, fit, MIN_SPAN_MS));
	}

	private xOf(ms: number): number {
		const span = this.viewEnd - this.viewStart;
		if (span <= 0) return 0;
		return ((ms - this.viewStart) / span) * this.plotWidth;
	}

	private timeAt(x: number): number {
		if (this.plotWidth <= 0) return this.viewStart;
		return this.viewStart + (x / this.plotWidth) * (this.viewEnd - this.viewStart);
	}

	private layout(): void {
		const isEmpty = this.items.length === 0;
		this.emptyEl.toggle(isEmpty);
		this.canvasEl.toggle(!isEmpty);

		const showAxis = this.readShowAxis();
		this.axisEl.toggle(showAxis && !isEmpty);

		if (isEmpty) return;

		this.plotWidth = this.canvasEl.clientWidth;
		if (this.plotWidth <= 0) return;

		// Order matters: which side a label sits on decides the extent it reserves, the
		// reserved extents decide lane packing, and the lane counts decide band heights.
		this.assignSides();
		this.assignLanes();
		const height = this.layoutBands();
		this.positionItems();

		// Sized from the lanes alone. The canvas's own height must not feed back in here:
		// when the view has no definite height, the canvas takes its height from this
		// element, so measuring it would make the plot unable to ever shrink again.
		// `.timeline-plot { min-height: 100% }` grows it to fill a definite parent.
		this.plotEl.style.height = `${height}px`;
		if (height !== this.lastPlotHeight) {
			this.lastPlotHeight = height;
			// Ungrouped, lanes grow upward from the baseline, so the bottom is the
			// interesting end. Grouped, the first band is, and it is at the top.
			this.scrollEl.scrollTop = this.grouped ? 0 : this.scrollEl.scrollHeight;
		}

		if (showAxis) this.renderAxis();
	}

	/** Decide each label's side before anything measures the space it reserves. */
	private assignSides(): void {
		for (const item of this.items) {
			item.side = labelSide(
				this.shapeExtentOf(item),
				this.labelWidth(item),
				LABEL_GAP_PX,
				this.plotWidth
			);
		}
	}

	/**
	 * Greedy lane packing in pixel space, recomputed per zoom level and run per band so
	 * a crowded group cannot push a sparse one down into extra lanes.
	 */
	private assignLanes(): void {
		for (const group of this.groups) {
			// packLanes requires ascending start order, and a left-hand label moves an
			// item's reserved start, so sort on the reserved extent rather than on time.
			const ordered = group.items
				.map((item) => ({ item, extent: this.extentOf(item) }))
				.sort((a, b) => a.extent[0] - b.extent[0]);

			const lanes = packLanes(
				ordered.map((o) => o.extent),
				LANE_GAP_PX
			);

			let laneCount = 1;
			for (let i = 0; i < ordered.length; i++) {
				ordered[i].item.lane = lanes[i];
				laneCount = Math.max(laneCount, lanes[i] + 1);
			}
			group.laneCount = laneCount;
		}
	}

	/**
	 * Stack the bands and return the total plot height. Bands with nothing plotted in
	 * them are hidden rather than left as dead space — a Base can easily group on a
	 * property that only some notes date.
	 */
	private layoutBands(): number {
		const headerHeight = this.grouped ? GROUP_HEADER_HEIGHT : 0;
		const floor = this.grouped ? MIN_BAND_HEIGHT : MIN_PLOT_HEIGHT;

		let top = TOP_PADDING;
		let last: TimelineGroup | null = null;
		let lastTop = top;

		for (const group of this.groups) {
			const visible = group.items.length > 0;
			group.el.toggle(visible);
			if (!visible) continue;

			if (last) top += GROUP_GAP_PX;
			const height = Math.max(
				group.laneCount * LANE_HEIGHT + BASELINE_OFFSET_PX + headerHeight,
				floor
			);
			group.el.style.top = `${top}px`;
			group.el.style.height = `${height}px`;

			lastTop = top;
			top += height;
			last = group;
		}

		// Short content is padded by growing the final band, not by leaving a gap under
		// it, so the baseline stays on the floor of the plot exactly as it did before.
		if (last && top < MIN_PLOT_HEIGHT) {
			last.el.style.height = `${MIN_PLOT_HEIGHT - lastTop}px`;
			top = MIN_PLOT_HEIGHT;
		}

		return top;
	}

	/** The drawn dot or bar, without its label. */
	private shapeExtentOf(item: TimelineItem): [number, number] {
		if (!item.isRange) {
			const x = this.xOf(item.start.ms);
			return [x - DOT_SIZE / 2, x + DOT_SIZE / 2];
		}
		const x0 = this.xOf(item.start.ms);
		const x1 = Math.max(this.xOf(item.end.ms), x0 + MIN_RANGE_WIDTH);
		return [x0, x1];
	}

	/**
	 * The space an item actually occupies, label included. Lane packing and culling use
	 * this so labels never overlap a neighbouring item; only the shape is drawn to it.
	 */
	private extentOf(item: TimelineItem): [number, number] {
		return reserveLabel(this.shapeExtentOf(item), this.labelWidth(item), LABEL_GAP_PX, item.side);
	}

	private positionItems(): void {
		const min = -CULL_MARGIN;
		const max = this.plotWidth + CULL_MARGIN;

		for (const item of this.items) {
			const el = item.el;
			const [cullStart, cullEnd] = this.extentOf(item);

			if (cullEnd < min || cullStart > max) {
				el.hide();
				continue;
			}
			const [x0, x1] = this.shapeExtentOf(item);
			el.show();
			el.toggleClass('has-label-left', item.side === 'left');
			el.style.left = `${x0}px`;
			el.style.width = `${Math.max(x1 - x0, DOT_SIZE)}px`;
			el.style.bottom = `${BASELINE_OFFSET_PX + item.lane * LANE_HEIGHT}px`;
		}
	}

	private renderAxis(): void {
		const interval = parseAxisInterval(this.config.get(KEY_AXIS_INTERVAL));
		const ticks = buildTicks(this.viewStart, this.viewEnd, interval);

		this.axisEl.empty();
		let lastLabelEnd = -Infinity;

		for (const tick of ticks) {
			const x = this.xOf(tick.ms);
			if (x < 0 || x > this.plotWidth) continue;

			const tickEl = this.axisEl.createDiv({ cls: 'timeline-tick' });
			tickEl.style.left = `${x}px`;
			tickEl.createDiv({ cls: 'timeline-tick-mark' });

			// Suppress labels that would collide; the tick mark still renders.
			const estimatedHalfWidth = tick.label.length * 3.6;
			if (x - estimatedHalfWidth > lastLabelEnd) {
				tickEl.createDiv({ cls: 'timeline-tick-label', text: tick.label });
				lastLabelEnd = x + estimatedHalfWidth;
			}
		}
	}

	private readShowAxis(): boolean {
		const raw = this.config.get(KEY_SHOW_AXIS);
		return raw === undefined || raw === null ? true : Boolean(raw);
	}

	private readShowLabels(): boolean {
		return Boolean(this.config.get(KEY_SHOW_LABELS));
	}

	private readExtendOpen(): boolean {
		const raw = this.config.get(KEY_EXTEND_OPEN);
		return raw === undefined || raw === null ? true : Boolean(raw);
	}

	private readShowGroups(): boolean {
		const raw = this.config.get(KEY_SHOW_GROUPS);
		return raw === undefined || raw === null ? true : Boolean(raw);
	}

	// -------------------------------------------------------------------------
	// Zoom, pan, hover, open
	// -------------------------------------------------------------------------

	private registerInteractions(): void {
		this.registerDomEvent(this.canvasEl, 'wheel', (ev: WheelEvent) => this.onWheel(ev), {
			passive: false,
		});
		this.registerDomEvent(this.canvasEl, 'pointerdown', (ev: PointerEvent) => this.onPointerDown(ev));
		this.registerDomEvent(this.canvasEl, 'pointermove', (ev: PointerEvent) => this.onPointerMove(ev));
		this.registerDomEvent(this.canvasEl, 'pointerup', (ev: PointerEvent) => this.onPointerUp(ev));
		this.registerDomEvent(this.canvasEl, 'pointercancel', (ev: PointerEvent) => this.onPointerUp(ev));

		// Obsidian mobile runs its own swipe gestures — sidebar open, tab switch — from
		// touch events on an ancestor. `touch-action: none` only stops the browser's
		// native scrolling, not a JS handler further up the tree, so a pan would be
		// stolen halfway through. The gesture is consumed here instead, which is why
		// the plot's own vertical scrolling is driven by hand in onPointerMove().
		this.registerDomEvent(
			this.canvasEl,
			'touchmove',
			(ev: TouchEvent) => {
				if (ev.cancelable) ev.preventDefault();
				ev.stopPropagation();
			},
			{ passive: false }
		);
		// Pinch is handled through pointer events; this stops the webview from also
		// applying its own page zoom to the whole app. `gesturestart` is WebKit-only and
		// absent from the DOM event map, so it is wired up without registerDomEvent.
		const onGestureStart = (ev: Event) => ev.preventDefault();
		this.canvasEl.addEventListener('gesturestart', onGestureStart, { passive: false });
		this.register(() => this.canvasEl.removeEventListener('gesturestart', onGestureStart));

		this.registerDomEvent(this.canvasEl, 'mousemove', (ev: MouseEvent) => this.onCanvasMouseMove(ev));
		this.registerDomEvent(this.canvasEl, 'mouseleave', () => this.scheduleHideCard());
		this.registerDomEvent(this.canvasEl, 'click', (ev: MouseEvent) => {
			// A pan that started on an item must not also open it.
			if (this.dragMoved) return;
			const item = this.itemAt(ev.target);
			if (item) this.openItem(item, ev);
		});
		// `click` only fires for the primary button, so middle-click arrives as `auxclick`.
		// Keymap.isModEvent() reports a middle click as 'tab', so openItem needs no special case.
		this.registerDomEvent(this.canvasEl, 'auxclick', (ev: MouseEvent) => {
			if (ev.button !== MIDDLE_BUTTON || this.dragMoved) return;
			const item = this.itemAt(ev.target);
			if (!item) return;
			ev.preventDefault();
			this.openItem(item, ev);
		});
		this.registerDomEvent(this.canvasEl, 'mousedown', (ev: MouseEvent) => {
			// Chromium starts its autoscroll gesture on middle mousedown, which leaves the
			// scroll cursor stuck over the view. preventDefault on pointerdown does not
			// suppress it; it has to be done on mousedown.
			if (ev.button === MIDDLE_BUTTON) ev.preventDefault();
		});

		this.registerDomEvent(this.cardEl, 'mouseenter', () => this.clearCardTimer());
		this.registerDomEvent(this.cardEl, 'mouseleave', () => this.scheduleHideCard());
		this.registerDomEvent(this.cardLinkEl, 'click', (ev: MouseEvent) => {
			ev.preventDefault();
			ev.stopPropagation();
			if (this.cardItem) this.openItem(this.cardItem, ev);
		});
		this.registerDomEvent(this.cardLinkEl, 'auxclick', (ev: MouseEvent) => {
			if (ev.button !== MIDDLE_BUTTON) return;
			// The anchor carries an href, so without this Chromium tries to open it as a URL.
			ev.preventDefault();
			ev.stopPropagation();
			if (this.cardItem) this.openItem(this.cardItem, ev);
		});
		this.registerDomEvent(this.cardLinkEl, 'mousedown', (ev: MouseEvent) => {
			if (ev.button === MIDDLE_BUTTON) ev.preventDefault();
		});
		this.registerDomEvent(this.cardLinkEl, 'mouseover', (ev: MouseEvent) => {
			if (!this.cardItem) return;
			this.app.workspace.trigger('hover-link', {
				event: ev,
				source: 'bases',
				hoverParent: this,
				targetEl: this.cardLinkEl,
				linktext: this.cardItem.path,
				sourcePath: this.cardItem.path,
			});
		});
	}

	private onCanvasMouseMove(ev: MouseEvent): void {
		if (this.dragging) return;
		const item = this.itemAt(ev.target);
		if (!item) {
			if (this.cardItem) this.scheduleHideCard();
			return;
		}
		this.showCard(item);
	}

	private onWheel(ev: WheelEvent): void {
		const fit = this.fitDomain();
		if (!fit || this.plotWidth <= 0) return;
		ev.preventDefault();

		// deltaMode 1 is lines, 2 is pages; normalise both to something pixel-ish.
		let delta = ev.deltaY;
		if (ev.deltaMode === 1) delta *= 16;
		else if (ev.deltaMode === 2) delta *= 100;

		const rect = this.canvasEl.getBoundingClientRect();
		const ratio = Math.min(Math.max((ev.clientX - rect.left) / this.plotWidth, 0), 1);

		const next = zoomDomain(
			{ start: this.viewStart, end: this.viewEnd },
			fit,
			ratio,
			Math.pow(1.0015, delta),
			MIN_SPAN_MS
		);
		if (next.start === this.viewStart && next.end === this.viewEnd) return;

		this.applyDomain(next);
		this.hideCard();
		this.layout();
	}

	/**
	 * How far the gesture has travelled from its origin. A mouse pan is horizontal only,
	 * so vertical mouse drift must not count against a click; a finger drags both axes.
	 */
	private gestureDelta(ev: PointerEvent): number {
		const dx = Math.abs(ev.clientX - this.dragOriginX);
		if (ev.pointerType === 'mouse') return dx;
		return Math.max(dx, Math.abs(ev.clientY - this.dragOriginY));
	}

	private gestureThreshold(ev: PointerEvent): number {
		return ev.pointerType === 'mouse' ? DRAG_THRESHOLD_PX : TOUCH_DRAG_THRESHOLD_PX;
	}

	private beginPan(pointerId: number, x: number, y: number): void {
		this.dragging = true;
		this.dragPointerId = pointerId;
		this.dragOriginX = x;
		this.dragOriginY = y;
		this.dragOriginStart = this.viewStart;
		this.dragOriginScrollTop = this.scrollEl.scrollTop;
	}

	private endPan(): void {
		const id = this.dragPointerId;
		this.dragging = false;
		this.dragPointerId = -1;
		this.canvasEl.removeClass('is-panning');
		if (id !== -1 && this.canvasEl.hasPointerCapture(id)) {
			this.canvasEl.releasePointerCapture(id);
		}
	}

	/** Distance and midpoint across the first two live pointers, for pinch zoom. */
	private pinchGeometry(): { distance: number; midX: number } | null {
		const live = Array.from(this.pointers.values());
		if (live.length < 2) return null;
		const [a, b] = live;
		return {
			distance: Math.hypot(a.x - b.x, a.y - b.y),
			midX: (a.x + b.x) / 2,
		};
	}

	private onPointerDown(ev: PointerEvent): void {
		// Any new press starts a fresh gesture, so the pan flag clears for every button.
		// Clearing it only for the primary button would leave a middle click after a pan
		// looking like the tail of that pan, and it would be swallowed.
		if (ev.pointerType === 'mouse' && ev.button !== 0) {
			this.dragMoved = false;
			return;
		}

		this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

		if (this.pointers.size === 1) {
			this.dragMoved = false;
			this.beginPan(ev.pointerId, ev.clientX, ev.clientY);
			return;
		}

		if (this.pointers.size === 2) {
			// A second finger turns the gesture into a pinch. The pan stops here, and the
			// gesture counts as moved so lifting off does not also open a note.
			this.endPan();
			this.dragMoved = true;
			this.hideCard();
			const geometry = this.pinchGeometry();
			if (geometry) {
				this.pinching = true;
				this.pinchDistance = geometry.distance;
			}
		}
	}

	private onPointerMove(ev: PointerEvent): void {
		const tracked = this.pointers.get(ev.pointerId);
		if (tracked) {
			tracked.x = ev.clientX;
			tracked.y = ev.clientY;
		}

		if (this.pinching) {
			this.updatePinch();
			return;
		}
		if (!this.dragging || ev.pointerId !== this.dragPointerId) return;

		if (!this.dragMoved && this.gestureDelta(ev) < this.gestureThreshold(ev)) return;
		if (!this.dragMoved) {
			this.dragMoved = true;
			this.hideCard();
			// Capture only once panning is real: capturing on pointerdown retargets the
			// subsequent click to the canvas, which would break click-to-open on an item.
			this.canvasEl.setPointerCapture(ev.pointerId);
			this.canvasEl.addClass('is-panning');
		}

		const dx = ev.clientX - this.dragOriginX;

		// Touch scrolling of the plot is suppressed so panning can own the gesture, so
		// the vertical half of a drag is applied by hand. A mouse keeps the wheel.
		if (ev.pointerType !== 'mouse') {
			this.scrollEl.scrollTop = this.dragOriginScrollTop - (ev.clientY - this.dragOriginY);
		}

		const fit = this.fitDomain();
		if (!fit || this.plotWidth <= 0) return;

		const span = this.viewEnd - this.viewStart;
		const start = this.dragOriginStart - (dx / this.plotWidth) * span;
		this.applyDomain(clampDomain({ start, end: start + span }, fit, MIN_SPAN_MS));
		this.layout();
	}

	private updatePinch(): void {
		const fit = this.fitDomain();
		const geometry = this.pinchGeometry();
		if (!fit || !geometry || this.plotWidth <= 0) return;
		if (geometry.distance <= 0 || this.pinchDistance <= 0) return;

		// Fingers spreading apart should zoom in, and zoomDomain reads a factor above 1
		// as zooming out, so the factor is the previous separation over the current one.
		const factor = this.pinchDistance / geometry.distance;
		this.pinchDistance = geometry.distance;

		const rect = this.canvasEl.getBoundingClientRect();
		const ratio = Math.min(Math.max((geometry.midX - rect.left) / this.plotWidth, 0), 1);

		const next = zoomDomain(
			{ start: this.viewStart, end: this.viewEnd },
			fit,
			ratio,
			factor,
			MIN_SPAN_MS
		);
		if (next.start === this.viewStart && next.end === this.viewEnd) return;

		this.applyDomain(next);
		this.layout();
	}

	private onPointerUp(ev: PointerEvent): void {
		this.pointers.delete(ev.pointerId);

		if (this.pinching) {
			if (this.pointers.size >= 2) return;
			this.pinching = false;
			this.pinchDistance = 0;

			// A finger still down after a pinch takes over the pan, re-anchored to where
			// it currently is. Without the re-anchor the view would jump by the distance
			// between the two fingers the moment the other one lifts.
			const remaining = this.pointers.entries().next();
			if (!remaining.done) {
				const [id, position] = remaining.value;
				this.beginPan(id, position.x, position.y);
			}
			return;
		}

		if (ev.pointerId !== this.dragPointerId) return;
		this.endPan();

		// Judge click-versus-pan on where the pointer ended up, not on whether it
		// ever crossed the threshold: a click with a little drift that comes back
		// to where it started is still a click, and must still open the note.
		if (this.gestureDelta(ev) < this.gestureThreshold(ev)) this.dragMoved = false;

		// Otherwise dragMoved deliberately survives until the next pointerdown, so the
		// click that follows this pointerup can still see that a pan happened.
	}

	/**
	 * The card is anchored to the item, not the cursor, and only moves when the
	 * hovered item changes. A card that tracks the pointer has to be chased to
	 * reach its link, and can end up under the cursor and swallow the click.
	 */
	private showCard(item: TimelineItem): void {
		if (this.dragging) return;
		this.clearCardTimer();
		if (this.cardItem === item) return;

		this.cardItem = item;
		this.renderCard(item);
		this.cardEl.show();
		this.positionCardForItem(item);
	}

	private renderCard(item: TimelineItem): void {
		this.cardLinkEl.setText(item.title);
		this.cardLinkEl.setAttribute('href', item.path);

		this.cardDateEl.setText(
			item.isRange
				? `${formatPoint(item.start)} – ${item.isOpen ? 'present' : formatPoint(item.end)}`
				: formatPoint(item.start)
		);

		this.cardCategoryEl.toggle(item.category !== null);
		if (item.category !== null) {
			this.cardSwatchEl.style.setProperty('--timeline-item-color', item.color);
			this.cardCategoryTextEl.setText(item.category);
		}
	}

	private positionCardForItem(item: TimelineItem): void {
		const rootRect = this.rootEl.getBoundingClientRect();
		const itemRect = item.el.getBoundingClientRect();
		const cardRect = this.cardEl.getBoundingClientRect();

		const { left, top } = anchorCard(
			{ width: rootRect.width, height: rootRect.height },
			{
				left: itemRect.left - rootRect.left,
				top: itemRect.top - rootRect.top,
				width: itemRect.width,
				height: itemRect.height,
			},
			{ width: cardRect.width, height: cardRect.height },
			CARD_ANCHOR_GAP,
			CARD_EDGE_PAD
		);

		this.cardEl.style.left = `${left}px`;
		this.cardEl.style.top = `${top}px`;
	}

	private scheduleHideCard(): void {
		this.clearCardTimer();
		this.cardHideTimer = window.setTimeout(() => this.hideCard(), CARD_HIDE_DELAY_MS);
	}

	private hideCard(): void {
		this.clearCardTimer();
		this.cardItem = null;
		this.cardEl.hide();
	}

	private clearCardTimer(): void {
		if (this.cardHideTimer !== null) {
			window.clearTimeout(this.cardHideTimer);
			this.cardHideTimer = null;
		}
	}

	private openItem(item: TimelineItem, ev: MouseEvent): void {
		this.app.workspace.openLinkText(item.path, '', Keymap.isModEvent(ev));
	}
}
