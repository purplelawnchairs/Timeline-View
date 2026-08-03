# Timeline

A custom [Bases](https://help.obsidian.md/bases) view for Obsidian. Notes matching a Base's
filters are plotted along a horizontal, zoomable time axis, single dates as dots, date
ranges as bars.

## Intention

This plugin is designed as a data visualization tool for structured notes about events on a 
linear time scale. I use it for history notes, and lifespans of historical figures.

## Usage

Create a `.base` file, then pick **Timeline** from the view switcher in the Bases toolbar.

Notes are plotted from their frontmatter:

```yaml
---
date: 1969-07-20
category: War
---
```

```yaml
---
date_start: 1961-05-25
date_end: 1972-12-19
category: War
---
```

A note with a start and end plots as a range bar. A note with only a single date, or only
one end of a range plots as a dot. 

Dates may be full ISO dates (`1969-07-20`), year and month (`1969-07`), or a bare year
(`1969`). A bare year is anchored to 1 January for plotting but displays as just the year.

## BC dates

BC years are supported. Write them with an era suffix or prefix:

```yaml
date: 44 BC
date_start: 509 BC
date_end: AD 476
```

`BC`, `BCE`, `AD`, `CE` and their dotted forms are accepted, in any case, before or after the
year. Axis ticks and hover cards render BC years as `753 BC` rather than as negatives.

For a precise BC date, use the ISO negative form, which is **astronomical**: it has no year
zero, so 1 BC is year `0000` and 44 BC is `-0043`.

```yaml
date: -0043-03-15   # 15 March 44 BC
```

## View options

| Option | Default | Purpose |
| --- | --- | --- |
| Date property | `date` | Property holding a single point in time |
| Range start property | `date_start` | Start of a range |
| Range end property | `date_end` | End of a range |
| Category property | `category` | Drives dot and bar colour |
| Show labels | off | Draw a text label beside each dot and bar |
| Label property | `file.name` | Which property the label shows |
| Axis interval (years) | `auto` | Years between tick labels; `auto` fits the zoom level |
| Show axis | on | Show or hide the axis and its labels |

Labels sit to the right of their dot or bar and are reserved space during lane packing, so a
label never runs over the next item. Any property can be used, including file properties, 
so `file.name` shows note titles. 

Colours are assigned from Obsidian's accent palette in first-seen category order, so a given
category keeps its colour as filters change. Notes with no category render in grey. I'm planning
to add colour selection based on tags or another variable similar to whats seen in the graph view. 

## License

MIT
