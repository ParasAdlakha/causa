// Builds the Causa deck: each rendered slide PNG full-bleed, with the spoken script in the notes.
//   node build-deck.cjs <slides png dir> <out.pptx>
const pptxgen = require("pptxgenjs");
const path = require("path");
const [dir, out] = process.argv.slice(2);

const NOTES = [
  "Hi, we're Paras and Harshita. This is Causa, for the Open Agent Hackathon, track two: the agent that can explain why. You ask why a number moved, and you get an answer you can check. Four agents investigate revenue changes across an ERP and a CRM, and every claim cites the SQL behind it.",
  "Every month someone asks: why did this number move? The FP&A Trends survey of more than 2,400 finance practitioners found only 35 percent of FP&A time goes on insights. The rest is mostly collecting and validating data. And the answer always spans two systems: the ERP knows what moved, the CRM knows why. Dashboards show the what. The why is a day of manual work, or a guess.",
  "Here is a real run. I ask why revenue in Germany dropped in Q3 1996. Minutes later, with every step logged: revenue fell 15.1 percent, almost all lost volume in the Automobile segment. Three accounts went to zero. The CRM shows they lost their annual fleet-parts tender to a cheaper competitor on 28 June. Every number carries a citation, and each one opens the exact SQL and rows.",
  "Four agents do it. The Planner recalls past findings from H-MEM and ranks hypotheses. The Analyst tests each one with SQL in Zetaris: totals, a price and volume split, a company baseline, breakdowns, a drill-down, and the CRM events. The Critic recomputes every figure and sends the Analyst back with new queries until the draft holds. The Reporter writes the cited answer with a confidence score. It's a loop, not a chain, and every step is traced.",
  "The sponsor technology does real work. Zetaris is the data layer: the ERP and CRM are registered as two data sources, and the CRM step is one federated query across both. H-MEM is the engine behind investigation memory: findings are stored and recalled to reorder the next plan, and feedback updates the trust ledger. Nightshift is the only AI provider, and NVIDIA Nemotron does the reasoning: Lightning plans, drafts and critiques, and Ultra writes the report. The trace logs which model answered every call.",
  "These are real runs on Zetaris and Nemotron. Germany: the lost tender. France: a discount programme that cut revenue per unit. The United States: two new machinery customers. And a control question, Japan, where nothing is planted: Causa reports the drop, but says the cause is not established, and its confidence drops. Nine tests check that totals match independent SQL and that memory changes the plan.",
  "What's different: every number survives a recount. The answer joins the what and the why from two systems. It learns which explanations work. And it's honest when it doesn't know.",
  "Next: more metrics than revenue, real sources like SAP and Salesforce through Zetaris connectors, a faster local critic, and scheduled investigations before every monthly review. Causa: ask why a number moved, and get an answer you can check. Thank you.",
];

const pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.title = "Causa";
pres.author = "Paras Adlakha";
pres.subject = "Open Agent Hackathon 2026, Track 2";
NOTES.forEach((note, i) => {
  const slide = pres.addSlide();
  slide.addImage({ path: path.join(dir, `s${i + 1}.png`), x: 0, y: 0, w: 10, h: 5.625, altText: `Causa slide ${i + 1}` });
  slide.addNotes(note);
});
pres.writeFile({ fileName: out }).then((f) => console.log("wrote", f));
