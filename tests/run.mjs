// Runs the unit tests for the pure modules (date parsing, axis ticks, layout geometry).
// The view itself needs a live Obsidian app and is verified by hand.
import './dates.test.mjs';
import './layout.test.mjs';
import './card.test.mjs';
import './label.test.mjs';
import './bc.test.mjs';
import { summary } from './harness.mjs';

process.exit(summary() ? 1 : 0);
