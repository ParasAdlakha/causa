// Records one real Causa investigation in the web UI (live Zetaris + Nemotron).
// Captures Chrome screencast frames with timestamps, marks key moments, and saves
// screenshots for the README and slides.
//   node record-live.mjs <base url> <work dir> <img dir>
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

const [base, work, img] = process.argv.slice(2);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
rmSync(`${work}/frames`, { recursive: true, force: true });
mkdirSync(`${work}/frames`, { recursive: true });
mkdirSync(img, { recursive: true });

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

const frames = [];
const marks = {};
const mark = (name) => { marks[name] = Date.now(); console.log(new Date().toISOString().slice(11, 19), name); };
const cdp = await page.createCDPSession();
cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
  const f = `${work}/frames/${String(frames.length).padStart(6, '0')}.jpg`;
  writeFileSync(f, Buffer.from(data, 'base64'));
  frames.push({ f, ts: metadata.timestamp * 1000 });
  cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});
// Chrome only sends frames on repaint: a near-invisible animated pixel keeps them flowing.
const keepAlive = () => page.evaluate(() => {
  if (document.getElementById('__tick')) return;
  const st = document.createElement('style');
  st.textContent = '@keyframes __t{from{opacity:.02}to{opacity:.05}}#__tick{position:fixed;right:0;bottom:0;width:2px;height:2px;background:#888;z-index:99999;animation:__t .2s infinite alternate}';
  const d = document.createElement('div'); d.id = '__tick';
  document.head.append(st); document.body.append(d);
});
const steps = () => page.$$eval('#timeline li', (lis) => lis.map((l) => l.textContent));
const shot = (name, opts = {}) => page.screenshot({ path: `${img}/${name}.png`, ...opts });
const shotEl = async (name, sel) => { const el = await page.$(sel); if (el) await el.screenshot({ path: `${img}/${name}.png` }); };

await page.goto(base, { waitUntil: 'networkidle0' });
await page.evaluateHandle('document.fonts.ready');
await keepAlive();
await wait(2500); // let the status pills load
await shot('home');
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: 1600, maxHeight: 900, everyNthFrame: 2 });
await wait(500);
mark('start');

// 1. Ask
const Q1 = 'Why did revenue in Germany drop in Q3 1996 compared with Q3 1995?';
await wait(2500);
await page.click('#question');
await page.type('#question', Q1, { delay: 28 });
mark('typed');
await wait(1200);
await page.click('#go');
mark('asked');

// 2. Watch the agents (minutes): mark the moments the edit cuts to.
const seen = new Set();
const watch = async (doneSel, timeout) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const s = (await steps()).join('\n');
    const once = (name, re) => { if (!seen.has(name) && re.test(s)) { seen.add(name); mark(name); return true; } return false; };
    once('plan', /delegate_plan/);
    if (once('first_query', /query_zetaris/)) await shot('running');
    once('draft', /submit_draft/);
    if (once('revision', /request_revision/)) await shotEl('timeline-critic', 'section');
    once('approve', /approve/);
    once('report', /write_report/);
    if (await page.$(doneSel)) return true;
    if (/investigation failed|Error:/i.test(await page.$eval('#status', (e) => e.textContent).catch(() => ''))) return false;
    await wait(500);
  }
  return false;
};
const ok = await watch('#report .lead', 20 * 60_000);
mark(ok ? 'answer' : 'timeout');
if (!ok) { await browser.close(); throw new Error('the investigation did not finish in 20 minutes'); }
await wait(1500);
await page.evaluate(() => document.querySelector('#timeline').scrollTo({ top: 0 }));
await shot('done');
await shotEl('answer', '.stack section');
await page.evaluate(() => document.querySelector('#timeline').scrollTo({ top: 1e6, behavior: 'smooth' }));
await wait(1500);
await shotEl('timeline', 'section');

// 3. Read the answer and open the evidence behind it (real time).
mark('read');
await page.evaluate(() => window.scrollTo({ top: 260, behavior: 'smooth' }));
await wait(4000);
await page.evaluate(() => window.scrollTo({ top: 700, behavior: 'smooth' }));
await wait(4000);
// The CRM query: the citation in the "Why" section.
const crmId = await page.evaluate(() => {
  const h = [...document.querySelectorAll('#report h3')].find((x) => /CRM/.test(x.textContent));
  let n = h?.nextElementSibling;
  while (n && n.tagName !== 'H3') { const c = n.querySelector?.('.cite'); if (c) return c.dataset.q; n = n.nextElementSibling; }
  return document.querySelector('#report .cite')?.dataset.q;
});
mark('cite_crm');
await page.evaluate((id) => { document.querySelector(`.cite[data-q="${id}"]`)?.click(); document.getElementById('ev-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, crmId);
await wait(6000);
await shotEl('evidence-crm', `#ev-${crmId}`);
const breakdownId = await page.evaluate(() => [...document.querySelectorAll('#evidence details')].find((d) => /segment/i.test(d.querySelector('summary').textContent))?.id.slice(3));
if (breakdownId) {
  mark('cite_sql');
  await page.evaluate((id) => { const d = document.getElementById('ev-' + id); d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, breakdownId);
  await wait(6000);
  await shotEl('evidence-sql', `#ev-${breakdownId}`);
}
mark('meta');
await page.evaluate(() => document.querySelector('.meta')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
await wait(5000);
mark('feedback');
await page.evaluate(() => document.querySelector('.feedback button[data-kind="helpful"]')?.click());
await wait(4000);

// 4. A follow-up recalls the finding from H-MEM.
mark('followup');
await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
await wait(1500);
await page.click('#question', { clickCount: 3 });
await page.type('#question', 'Why did revenue in Germany change in Q4 1996 compared with Q4 1995?', { delay: 28 });
await wait(800);
await page.click('#go');
mark('followup_asked');
const t1 = Date.now();
while (Date.now() - t1 < 5 * 60_000 && !/delegate_plan/.test((await steps()).join('\n'))) await wait(500);
mark('recalled');
await wait(5000);
await shotEl('recall', 'section');
mark('end');
await wait(1000);
await cdp.send('Page.stopScreencast');
await browser.close();

frames.sort((a, b) => a.ts - b.ts);
writeFileSync(`${work}/recording.json`, JSON.stringify({ marks, frames }, null, 1));
console.log('frames', frames.length, 'over', ((marks.end - marks.start) / 1000).toFixed(0), 's');
