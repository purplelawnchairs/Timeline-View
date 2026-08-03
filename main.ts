import { BasesAllOptions, BasesViewConfig, Plugin } from 'obsidian';

import {
	DEFAULT_CATEGORY,
	DEFAULT_DATE,
	DEFAULT_END,
	DEFAULT_LABEL,
	DEFAULT_START,
	KEY_AXIS_INTERVAL,
	KEY_CATEGORY,
	KEY_DATE,
	KEY_END,
	KEY_LABEL,
	KEY_SHOW_AXIS,
	KEY_SHOW_LABELS,
	KEY_START,
	TIMELINE_VIEW_TYPE,
	TimelineView,
} from './view';

function viewOptions(config: BasesViewConfig): BasesAllOptions[] {
	return [
		{
			type: 'property',
			key: KEY_DATE,
			displayName: 'Date property',
			default: DEFAULT_DATE,
			placeholder: 'date',
		},
		{
			type: 'property',
			key: KEY_START,
			displayName: 'Range start property',
			default: DEFAULT_START,
			placeholder: 'date_start',
		},
		{
			type: 'property',
			key: KEY_END,
			displayName: 'Range end property',
			default: DEFAULT_END,
			placeholder: 'date_end',
		},
		{
			type: 'property',
			key: KEY_CATEGORY,
			displayName: 'Category property',
			default: DEFAULT_CATEGORY,
			placeholder: 'category',
		},
		{
			type: 'toggle',
			key: KEY_SHOW_LABELS,
			displayName: 'Show labels',
			default: false,
		},
		{
			type: 'property',
			key: KEY_LABEL,
			displayName: 'Label property',
			default: DEFAULT_LABEL,
			placeholder: 'file.name',
			// Choosing what the label says is meaningless while labels are switched off.
			shouldHide: () => !config.get(KEY_SHOW_LABELS),
		},
		{
			type: 'text',
			key: KEY_AXIS_INTERVAL,
			displayName: 'Axis interval (years)',
			default: 'auto',
			placeholder: 'auto',
		},
		{
			type: 'toggle',
			key: KEY_SHOW_AXIS,
			displayName: 'Show axis',
			default: true,
		},
	];
}

export default class TimelinePlugin extends Plugin {
	onload(): void {
		const registered = this.registerBasesView(TIMELINE_VIEW_TYPE, {
			name: 'Timeline',
			icon: 'lucide-move-horizontal',
			factory: (controller, containerEl) => new TimelineView(controller, containerEl),
			options: viewOptions,
		});

		if (!registered) {
			console.warn('Timeline: Bases is not enabled in this vault, the Timeline view was not registered.');
		}
	}
}
