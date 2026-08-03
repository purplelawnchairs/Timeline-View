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
import { formatPoint, TimePoint, toTimePoint } from './dates';
import { anchorCard, clampDomain, Domain, packLanes, reserveLabel, zoomDomain } from './layout';

export const TIMELINE_VIEW_TYPE = 'timeline';

export const KEY_DATE = 'dateProperty';
export const KEY_START = 'startProperty';
export const KEY_END = 'endProperty';
export const KEY_CATEGORY = 'categoryProperty';
export const KEY_AXIS_INTERVAL = 'axisInterval';
export const KEY_SHOW_AXIS = 'showAxis';
export const KEY_SHOW_LABELS = 'showLabels';
export const KEY_LABEL = 'labelProperty';

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

const MIDDLE_BUTTON = 1;
const DRAG_THRESHOLD_PX = 6;
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
	start: TimePoint;
	end: TimePoint;
	category: string | null;
	color: string;
	/** Empty when labels are off or the label property is empty for this entry. */
	label: string;
	lane: number;
	el: HTMLElement;
	labelEl: HTMLElement;
}

export class TimelineView extends BasesView implements HoverParent {
	type = TIMELINE_VIEW_TYPE;
	hoverPopover: HoverPopover | null = null;

	containerEl: HTMLElement;

	private rootEl: HTMLElement;
	private canvasEl: HTMLElement;
	private scrollEl: HTMLElement;
	private plotEl: HTMLElement;
	private baselineEl: HTMLElement;
	private axisEl: HTMLElement;
	private emptyEl: HTMLElement;
	private cardEl: HTMLElement;

	private items: TimelineItem[] = [];
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
	private dragOriginStart = 0;

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
		this.baselineEl = this.plotEl.createDiv({ cls: 'timeline-baseline' });
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

		const items: TimelineItem[] = [];
		const byPath = new Map<string, TimelineItem>();

		for (const group of this.data.groupedData) {
			for (const entry of group.entries) {
				const item = this.buildItem(entry, dateProp, startProp, endProp, categoryProp, labelProp);
				if (!item) continue;
				// One entry per file; a duplicate path would collide in the element cache.
				if (byPath.has(item.path)) continue;
				items.push(item);
				byPath.set(item.path, item);
			}
		}

		this.items = items;
		this.itemsByPath = byPath;
		this.measureLabels(items);
	}

	private buildItem(
		entry: BasesEntry,
		dateProp: BasesPropertyId,
		startProp: BasesPropertyId,
		endProp: BasesPropertyId,
		categoryProp: BasesPropertyId,
		labelProp: BasesPropertyId | null
	): TimelineItem | null {
		const startPoint = toTimePoint(readValue(entry, startProp));
		const endPoint = toTimePoint(readValue(entry, endProp));

		let start: TimePoint | null = null;
		let end: TimePoint | null = null;
		let isRange = false;

		if (startPoint && endPoint && endPoint.ms > startPoint.ms) {
			start = startPoint;
			end = endPoint;
			isRange = true;
		} else if (startPoint) {
			// Open-ended (or inverted) range falls back to a point, per spec.
			start = end = startPoint;
		} else if (endPoint) {
			start = end = endPoint;
		} else {
			const datePoint = toTimePoint(readValue(entry, dateProp));
			if (!datePoint) return null;
			start = end = datePoint;
		}

		const categoryText = readText(entry, categoryProp);
		const category = categoryText === '' ? null : categoryText;

		return {
			path: entry.file.path,
			title: entry.file.basename,
			isRange,
			start,
			end,
			category,
			color: this.colorFor(category),
			label: labelProp === null ? '' : truncate(readText(entry, labelProp), MAX_LABEL_CHARS),
			lane: 0,
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

			el.toggleClass('is-range', item.isRange);
			el.toggleClass('is-point', !item.isRange);
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
		const el = this.plotEl.createDiv({ cls: 'timeline-item' });
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

		const laneCount = this.assignLanes();
		this.positionItems();

		// Sized from the lanes alone. The canvas's own height must not feed back in here:
		// when the view has no definite height, the canvas takes its height from this
		// element, so measuring it would make the plot unable to ever shrink again.
		// `.timeline-plot { min-height: 100% }` grows it to fill a definite parent.
		const height = Math.max(
			laneCount * LANE_HEIGHT + TOP_PADDING + BASELINE_OFFSET_PX,
			MIN_PLOT_HEIGHT
		);
		this.plotEl.style.height = `${height}px`;
		if (height !== this.lastPlotHeight) {
			this.lastPlotHeight = height;
			// Lanes grow upward from the baseline; keep the baseline in view.
			this.scrollEl.scrollTop = this.scrollEl.scrollHeight;
		}

		if (showAxis) this.renderAxis();
	}

	/** Greedy lane packing in pixel space, recomputed per zoom level. */
	private assignLanes(): number {
		const ordered = this.items.slice().sort((a, b) => a.start.ms - b.start.ms);
		const extents = ordered.map((item) => this.extentOf(item));
		const lanes = packLanes(extents, LANE_GAP_PX);

		let laneCount = 1;
		for (let i = 0; i < ordered.length; i++) {
			ordered[i].lane = lanes[i];
			laneCount = Math.max(laneCount, lanes[i] + 1);
		}

		return laneCount;
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
		return reserveLabel(this.shapeExtentOf(item), this.labelWidth(item), LABEL_GAP_PX);
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

	private onPointerDown(ev: PointerEvent): void {
		// Any new press starts a fresh gesture, so the pan flag clears for every button.
		// Clearing it only for the primary button would leave a middle click after a pan
		// looking like the tail of that pan, and it would be swallowed.
		this.dragMoved = false;
		if (ev.button !== 0) return;
		this.dragging = true;
		this.dragPointerId = ev.pointerId;
		this.dragOriginX = ev.clientX;
		this.dragOriginStart = this.viewStart;
	}

	private onPointerMove(ev: PointerEvent): void {
		if (!this.dragging || ev.pointerId !== this.dragPointerId) return;

		const dx = ev.clientX - this.dragOriginX;
		if (!this.dragMoved && Math.abs(dx) < DRAG_THRESHOLD_PX) return;
		if (!this.dragMoved) {
			this.dragMoved = true;
			this.hideCard();
			// Capture only once panning is real: capturing on pointerdown retargets the
			// subsequent click to the canvas, which would break click-to-open on an item.
			this.canvasEl.setPointerCapture(ev.pointerId);
			this.canvasEl.addClass('is-panning');
		}

		const fit = this.fitDomain();
		if (!fit || this.plotWidth <= 0) return;

		const span = this.viewEnd - this.viewStart;
		const start = this.dragOriginStart - (dx / this.plotWidth) * span;
		this.applyDomain(clampDomain({ start, end: start + span }, fit, MIN_SPAN_MS));
		this.layout();
	}

	private onPointerUp(ev: PointerEvent): void {
		if (ev.pointerId !== this.dragPointerId) return;
		this.dragging = false;
		this.dragPointerId = -1;
		this.canvasEl.removeClass('is-panning');
		if (this.canvasEl.hasPointerCapture(ev.pointerId)) {
			this.canvasEl.releasePointerCapture(ev.pointerId);
		}

		// Judge click-versus-pan on where the pointer ended up, not on whether it
		// ever crossed the threshold: a click with a little drift that comes back
		// to where it started is still a click, and must still open the note.
		if (Math.abs(ev.clientX - this.dragOriginX) < DRAG_THRESHOLD_PX) this.dragMoved = false;

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
				? `${formatPoint(item.start)} – ${formatPoint(item.end)}`
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
