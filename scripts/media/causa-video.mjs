// Edits one real recording (record-live.mjs) into the Causa videos.
//   node causa-video.mjs <2min|3min|captioned> <recording dir> <slides png dir> <out.mp4>
// Segments between recorded marks play in real time, or sped up (labelled "sped up N×")
// so each lasts as long as its narration. Captions are PNG overlays; voices are edge-tts.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import sharp from 'sharp';

const [cut, rec, slides, out] = process.argv.slice(2);
const { marks, frames } = JSON.parse(readFileSync(`${rec}/recording.json`, 'utf-8'));
const work = `${rec}/edit-${cut}`;
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const voiced = cut !== 'captioned';

// --- the edit --------------------------------------------------------------------
// from/to: recording marks. say: narration. cap: [tag, caption]. min: shortest output length (s).
const demo = [
  { from: 'start', to: 'asked', cap: ['01 · ASK', 'An analyst asks why revenue moved'],
    say: 'A finance analyst asks the question every monthly review starts with: why did revenue in Germany drop in the third quarter of 1996?' },
  { from: 'asked', to: 'first_query', cap: ['02 · PLAN', 'The Planner recalls H-MEM and ranks hypotheses on Nemotron'],
    say: 'The Planner checks its H-MEM memory for earlier findings, then plans on NVIDIA Nemotron through Meterless Nightshift: which periods, which hypotheses, in what order.' },
  { from: 'first_query', to: 'draft', cap: ['03 · TEST', 'The Analyst tests each hypothesis with SQL in Zetaris'],
    say: 'The Analyst tests each hypothesis with real SQL in Zetaris, which federates the ERP and the CRM: totals, a price and volume split, the company baseline, and a breakdown for every hypothesis.' },
  { from: 'draft', to: 'approve', cap: ['04 · CHALLENGE', 'The Critic recomputes every figure and asks for more evidence'],
    say: 'Then the Critic takes over. It recomputes every figure from its query, runs eight checks, and sends the Analyst back for more: drill into the driver, and check those accounts in the CRM.' },
  { from: 'approve', to: 'answer', cap: ['05 · ANSWER', 'Nemotron Ultra writes the report; a guard blocks unsupported numbers'],
    say: 'Once the draft holds up, Nemotron Ultra writes the report. A guard rejects any number that is not in the approved evidence.' },
  { from: 'answer', to: 'cite_crm', cap: ['06 · RESULT', 'Revenue fell 15.1%: three Automobile accounts went to zero'],
    say: 'The answer: revenue fell fifteen percent, almost all lost volume in the Automobile segment, where three accounts went to zero.' },
  { from: 'cite_crm', to: 'cite_sql', cap: ['07 · WHY', 'The CRM: the tender was lost to a cheaper competitor on 28 June'],
    say: 'And here is why. One federated query across both systems finds that all three lost their annual fleet parts tender to a cheaper competitor on the twenty eighth of June.' },
  { from: 'cite_sql', to: 'meta', cap: ['08 · EVIDENCE', 'Every [Q] citation opens the exact SQL and rows'],
    say: 'Every number carries a citation, and each one opens the exact SQL and rows behind it.' },
  { from: 'meta', to: 'feedback', cap: ['09 · TRACE', 'Confidence, queries, revisions, and the Nemotron model behind every call'],
    say: 'Confidence ninety five percent, with its reasons. Every step is in a trace, including which Nemotron model answered each call.' },
  { from: 'feedback', to: 'followup_asked', cap: ['10 · MEMORY', 'Feedback goes into H-MEM'],
    say: 'Marked helpful, the finding is stored in H-MEM.' },
  { from: 'followup_asked', to: 'end', cap: ['10 · MEMORY', 'A follow-up question recalls the finding and tests that dimension first'],
    say: 'Ask a follow-up, and the Planner recalls it, testing the dimension that explained the last change first.' },
];
const S = (n) => `${slides}/s${n}.png`;
const steps = cut === '3min'
  ? [
      { slide: S(1), say: 'Hi, we are Paras and Harshita. This is Causa, for the Open Agent Hackathon, track two: the agent that can explain why. You ask why a number moved, and you get an answer you can check.' },
      { slide: S(2), say: 'Finance teams spend most of their time collecting and validating data, not on insight. And the answer to why revenue moved spans two systems: the ERP knows what changed, the CRM knows why.' },
      ...demo,
      { slide: S(4), say: 'Four agents, and it is a loop, not a chain: the Critic can send the Analyst back for more evidence, and memory changes the next plan.' },
      { slide: S(6), say: 'On real runs it finds the lost tender in Germany, the discount programme in France, and two new customers in the United States. On a control question with no planted cause, it reports the drop but says the cause is not established.' },
      { slide: S(8), say: 'Causa. Ask why a number moved, and get an answer you can check. Thank you.', min: 6 },
    ]
  : cut === '2min'
    ? [...demo, { slide: S(1), say: 'Causa. Ask why a number moved, and get an answer you can check.', min: 4 }]
    : demo.map((d) => ({ ...d, say: undefined, min: Math.max(4.5, d.cap[1].length / 14) })).concat([{ slide: S(1), min: 4 }]);

// --- voice -----------------------------------------------------------------------
steps.forEach((s, i) => {
  if (!voiced || !s.say) return;
  s.mp3 = `${work}/line-${String(i).padStart(2, '0')}.mp3`;
  execFileSync('python', ['-m', 'edge_tts', '--voice', 'en-US-AvaNeural', '--rate=+6%', '--text', s.say, '--write-media', s.mp3]);
  s.len = dur(s.mp3);
});

// --- caption overlays --------------------------------------------------------------
async function overlay(file, cap, speed) {
  const parts = [];
  if (cap) {
    const text = esc(cap[1]);
    const w = Math.min(1700, 140 + (cap[0].length + cap[1].length) * 15.5);
    const x = (1920 - w) / 2;
    parts.push(`<rect x="${x}" y="958" width="${w}" height="74" rx="18" fill="#1d1c1a" fill-opacity="0.94"/>`,
      `<text x="${x + 30}" y="1004" font-family="Consolas, monospace" font-weight="700" font-size="20" fill="#8cc4ae" letter-spacing="1.5">${esc(cap[0])}</text>`,
      `<text x="${x + 46 + cap[0].length * 12.2}" y="1006" font-family="Segoe UI, Arial, sans-serif" font-weight="600" font-size="28" fill="#f6f5f1">${text}</text>`);
  }
  if (speed > 1.2) {
    const label = `▶▶  sped up ${Math.round(speed)}× · real run`;
    parts.push(`<rect x="1572" y="28" width="320" height="52" rx="26" fill="#a3532a" fill-opacity="0.95"/>`,
      `<text x="1732" y="62" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-weight="700" font-size="22" fill="#fff">${esc(label)}</text>`);
  }
  await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">${parts.join('')}</svg>`)).png().toFile(file);
}

// --- clips -------------------------------------------------------------------------
const clips = [];
let t = 0;
for (const [i, s] of steps.entries()) {
  const want = Math.max(s.min ?? 0, (s.len ?? 0) + 0.7);
  const clip = `${work}/clip-${String(i).padStart(2, '0')}.mp4`;
  const ov = `${work}/ov-${i}.png`;
  if (s.slide) {
    await overlay(ov, null, 1);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-i', s.slide, '-t', want.toFixed(2), '-vf', 'fps=30,scale=1920:1080,format=yuv420p', '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', clip]);
  } else {
    const a = marks[s.from], b = marks[s.to];
    if (!a || !b) throw new Error(`missing mark ${s.from} or ${s.to}`);
    const raw = (b - a) / 1000;
    const speed = Math.max(1, raw / want);
    await overlay(ov, s.cap, speed);
    const shown = frames.filter((fr, k) => (frames[k + 1]?.ts ?? Infinity) > a && fr.ts < b);
    const lines = shown.map((fr, k) => {
      const from = Math.max(fr.ts, a), to = Math.min(shown[k + 1]?.ts ?? b, b);
      return `file '${fr.f.replace(/\\/g, '/')}'\nduration ${((to - from) / 1000 / speed).toFixed(4)}`;
    });
    // Narration longer than the real segment: hold the last frame.
    const extra = want - raw / speed;
    lines.push(`file '${shown.at(-1).f.replace(/\\/g, '/')}'\nduration ${Math.max(0.04, extra).toFixed(4)}`, `file '${shown.at(-1).f.replace(/\\/g, '/')}'`);
    writeFileSync(`${work}/list-${i}.txt`, lines.join('\n'));
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', `${work}/list-${i}.txt`, '-i', ov,
      '-filter_complex', '[0:v]fps=30,scale=1920:1080:flags=lanczos,format=yuv420p[v];[v][1:v]overlay=0:0,format=yuv420p', '-t', want.toFixed(2), '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', clip]);
    console.log(`${s.from}→${s.to}: ${raw.toFixed(0)}s real → ${want.toFixed(1)}s (${speed.toFixed(1)}×)`);
  }
  s.at = t;
  t += dur(clip);
  clips.push(clip);
}
writeFileSync(`${work}/clips.txt`, clips.map((c) => `file '${c.replace(/\\/g, '/')}'`).join('\n'));
const silent = `${work}/silent.mp4`;
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', `${work}/clips.txt`, '-c', 'copy', silent]);

// --- audio -------------------------------------------------------------------------
if (!voiced) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', silent, '-c', 'copy', '-movflags', '+faststart', out]);
} else {
  const v = steps.filter((s) => s.mp3);
  const inputs = ['-i', silent, ...v.flatMap((s) => ['-i', s.mp3])];
  const delays = v.map((s, k) => `[${k + 1}:a]adelay=${Math.round(s.at * 1000 + 250)}|${Math.round(s.at * 1000 + 250)}[a${k}]`).join(';');
  const mix = `${delays};${v.map((_, k) => `[a${k}]`).join('')}amix=inputs=${v.length}:normalize=0[aout]`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', mix, '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-t', t.toFixed(2), out]);
}
console.log('wrote', out, Math.round(dur(out)), 's');
