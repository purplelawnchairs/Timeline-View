# Timeline

A custom [Bases](https://help.obsidian.md/bases) view for Obsidian. Notes matching a Base's
filters are plotted along a horizontal, zoomable time axis — single dates as dots, date
ranges as bars.

## Usage

Create a `.base` file, then pick **Timeline** from the view switcher in the Bases toolbar.

Notes are plotted from their frontmatter:

```yaml
---
date: 1969-07-20
category: Space
---
```

```yaml
---
date_start: 1961-05-25
date_end: 1972-12-19
category: Space
---
```

A note with a start and end plots as a range bar. A note with only a single date — or only
one end of a range — plots as a dot. A note with neither is skipped, not flagged as an error.

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

The same applies to a bare negative number: `-500` means astronomical year -500, which is
**501 BC**. If you mean 500 BC, write `500 BC` — the era spelling is unambiguous and is the
recommended form.

Two limits. Dates outside roughly ±271,821 years cannot be represented and are skipped rather
than plotted wrongly, so geological timescales are out of range. And the property must be a
**Text** property — Obsidian's Date type cannot hold a BC value. Property types are vault-wide,
so if a property already holds ISO dates elsewhere and Obsidian has typed it as Date, use a
separate property for BC notes.

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
label never runs over the next item — turning them on generally means more lanes. Any
property can be used, including file properties, so `file.name` shows note titles. Labels
longer than 60 characters are truncated with an ellipsis.

Colours are assigned from Obsidian's accent palette in first-seen category order, so a given
category keeps its colour as filters change. Notes with no category render in a muted grey.

## Interaction

- **Scroll** to zoom around the cursor. Zooming out stops at the full span of the data.
- **Drag** to pan.
- **Hover** a dot or bar for a card with the note title, its date, and its category. The card
  is anchored to the item, so the link stays where you can click it.
- **Click** a dot or bar to open the note. Cmd/Ctrl-click or middle-click opens it in a new
  tab. The same applies to the title link in the hover card.

Items that would overlap at the current zoom are stacked into lanes above the baseline, so
nothing is hidden behind anything else.

## Development

```bash
npm install
npm run dev     # watching build
npm run build   # type-check and produce a minified main.js
```

## License

MIT
