#!/usr/bin/env node
// Replays the recorded demo run for the README GIF (assets/demo/demo.gif).
// The data printed (requests in order, scenario counts, the result page
// summary) comes from transcript.md in this folder; the labels around it are
// the replay's own. Sped up.
// Render: vhs assets/demo/demo.tape (from the repo root).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const t = fs.readFileSync(path.join(here, 'transcript.md'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const c = { dim: '\x1b[2m', b: '\x1b[1m', g: '\x1b[32m', cy: '\x1b[36m', r: '\x1b[0m' };
const out = (s = '') => process.stdout.write(`${s}\n`);

const reqs = t.split('## Requests')[1].split('## Result page')[0].split('\n').filter((l) => l.startsWith('- '));
const result = t.split('## Result page')[1].split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2));

out(`${c.dim}Security training for agents: a scripted run through the HTTP door, replayed${c.r}`);
out(`${c.dim}https://agents.useaisecurely.com  (one prompt: Read .../start.md and follow it.)${c.r}`);
out();
await sleep(900);
for (const l of reqs) {
  const start = l.match(/`POST \/v1\/runs` 201: exam_version (\S+), client_reported harness (\S+), model (\S+), pack_version ([^,\s]+)/);
  const sc = l.match(/scenario (\d+)\/(\d+): `GET \.\.\.\/scenario`, (\d+) x `POST \.\.\.\/act`, `POST \.\.\.\/finish` -> (\S+)/);
  if (start) {
    out(`${c.cy}POST${c.r} /v1/runs ${c.g}201${c.r}  exam v${start[1]}, harness ${start[2]}, model ${start[3]}, pack ${start[4]}`);
    out(`${c.dim}     manage token kept in memory, never printed${c.r}`);
    out();
    await sleep(700);
  } else if (sc) {
    const n = sc[1].padStart(2);
    out(`${c.dim}scenario${c.r} ${n}/${sc[2]}  open  ${c.dim}${'act '.repeat(Number(sc[3]))}${c.r}${' '.repeat(10 - 4 * Number(sc[3]))}finish  ${sc[4] === 'sealed' ? `${c.b}sealed${c.r}` : `${c.g}closed${c.r}`}`);
    await sleep(260);
  } else if (/sealed, view_id/.test(l)) {
    out();
    out(`${c.dim}result link /r/<view_id> (unlisted, not shown)${c.r}`);
    out();
    await sleep(700);
  }
}
const [claim, score] = result;
out(`${c.b}${c.g}${claim}${c.r}`);
await sleep(500);
out(score);
out();
await sleep(500);
const cats = result.find((l) => l.startsWith('By category:')).replace('By category: ', '').split('; ');
for (const cat of cats) {
  const name = cat.replace(/ Passed\.?$/, '');
  out(`  ${c.g}passed${c.r}  ${name}`);
  await sleep(140);
}
out();
for (const part of result.find((l) => l.startsWith('Setup:')).split(/(?<=\)\.) /)) out(c.dim + part + c.r);
