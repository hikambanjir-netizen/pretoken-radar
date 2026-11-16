// PreToken Radar — the program.
//
// Reads the sealed DefiLlama snapshot, classifies every protocol in it, prices each
// pre-token candidate with the peer-multiple model in lib/model.ts, and writes:
//   board.json   the ranked board the gate reads
//   data.js      the same radar in the form the dashboard page loads
//   dashboard/   the static page (copied from this repository)
//   screenshots/ the three renders the judge sees first
//   dossier.json the judge's dossier, built by the vendored make.fun library
//
// Node 22, standard library only, no network. Two runs over the same snapshot write
// the same bytes: the model is pure arithmetic over the snapshot and slug hashes.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's caps, mirrored so a bad build fails here instead of at the gate. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> (or --name=<value>) out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf('--' + name);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith('--' + name + '='));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`pretoken radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`pretoken radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), JSON.stringify({ rows: board }) + '\n');
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`pretoken radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`pretoken radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

// The run report: one glance at what the model did, in the build log where a human
// (or a transcript reader) can audit it without opening the outputs.
const top = board[0]!;
const v = radar.validation;
process.stdout.write(
  `pretoken radar: ${snapshot.protocols.length} protocols as of ${snapshot.as_of}: ` +
    `${radar.counts.candidates} pre-token candidates ranked, ${radar.counts.live} already tokenised set aside, ` +
    `${radar.counts.aside} wrapped/staked/exchange products set aside, all ${snapshot.watchlist.length} watchlist protocols covered\n` +
    `pretoken radar: model validated leave-one-out on ${v.peers} traded peers: median actual/predicted ${v.medianRatio}, ` +
    `median absolute error ${v.medianAbsErrorPct}%, Spearman rank correlation ${v.spearman}, value band x${v.bandLow} to x${v.bandHigh}\n` +
    `pretoken radar: rank 1 is ${top.name} at $${top.implied_value_usd.toLocaleString('en-US')} implied ` +
    `(TVL $${top.tvl_usd.toLocaleString('en-US')} x ${top.multiple} ${top.multiple_level} multiple from ${top.multiple_peers} peers)\n` +
    `pretoken radar: wrote board.json (${board.length} rows), data.js, dashboard/, screenshots/ (${shots.length} images) and dossier.json under ${out}\n`,
);
