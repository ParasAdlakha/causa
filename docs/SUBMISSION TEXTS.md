# Submission texts

Copy-ready answers for the HackOS form, the demo script, the channel post and the social posts.

---

## HackOS form

**Project name:** Causa

**Tagline (one line):** Ask why a number moved: agents test each explanation in your data and answer with cited evidence.

**Track:** Track 2: The Agent That Can Explain Why

**Team:** Paras Adlakha

**Repository:** https://github.com/ParasAdlakha/causa *(fill in once published)*

**Demo video:** *(link)*

**Description:**

> When revenue moves, someone has to explain why. Today an analyst spends a day pulling ERP orders, slicing them a dozen ways and digging through the CRM for what happened to those accounts, and the answer is often still a guess.
>
> Causa does the investigation with four agents and shows its work. The **Planner** recalls past findings from Meterless **H-MEM** and ranks hypotheses. The **Analyst** tests each one with SQL in **Zetaris**, federating an ERP and a CRM database: totals, a price/volume split, a company-wide baseline, breakdowns scored against the trend, a drill-down, and the CRM events of the accounts behind the change. The **Critic** recomputes every figure from its cited query, runs eight checks, and sends the Analyst back with new queries until the draft holds up. The **Reporter** writes a cited answer with a confidence score, and stores what explained the change in H-MEM, so the next investigation tests that first.
>
> All model calls go through **Meterless Nightshift** to **NVIDIA Nemotron**: 3.5 Lightning for planning, drafting and critique, and 3 Ultra for the report. Every step, query and model is logged to a JSONL trace, and the web UI streams it live. Asked why German revenue fell in Q3 1996, Causa finds a −15.1% drop driven by three Automobile accounts. The CRM shows they lost a fleet-parts tender to a cheaper competitor on 28 June. Every number is cited to the SQL that produced it.

**How we used Zetaris:** It is the data layer for every live query (`POST /sql-editor/sqls/run`). Two Postgres databases are registered as the `causa_erp` and `causa_crm` data sources by an automated SQL script. The CRM step is a federated join across both. See `docs/sponsor-technology.md`.

**How we used Meterless:**
- **H-MEM** powers investigation memory: findings are stored with driver/ruled-out tags and recalled to reorder the next plan's hypotheses. UI feedback updates H-MEM's trust ledger. The official conformance suite passes 13/13, and so do our feature tests.
- **Nightshift** is the only AI provider: `/v1/chat/completions` with the `meterless-app` and `meterless-scope: user` headers.

**How we used NVIDIA:** Nemotron 3.5 Lightning 30B-A3B (planner, analyst, critic) and Nemotron 3 Ultra 550B-A55B (reporter), as Nightshift lanes. Each trace event records the model that answered.

**Pre-existing components:** `vendor/hmem`, the Meterless H-MEM reference implementation and its conformance suite (Apache-2.0, upstream commit recorded), used unchanged. All other code and the synthetic dataset were created during the hackathon (25–27 October 2026). No data was prepared before 22 October.

**AI coding tool:** Claude Code

---

## Agent Loop Spec (8 lines)

1. **Goal:** explain why revenue moved for one focus between two periods, with every claim cited to a query.
2. **Trigger:** a natural-language question (web UI, `POST /run` or CLI).
3. **Planner:** recalls H-MEM, sets the periods, focus and ranked hypotheses, and delegates to the Analyst.
4. **Executor (Analyst):** runs SQL in Zetaris (totals, baseline, breakdowns, drill-down, federated CRM events) and drafts cited claims.
5. **Evaluator (Critic):** recomputes every figure, runs 8 checks plus a Nemotron challenge, and either approves or requests new queries.
6. **Loop:** Analyst ↔ Critic for up to 2 revisions. An invalid model reply retries once, and an unreachable model falls back to computed claims.
7. **Memory:** the Reporter stores driver and ruled-out dimensions in H-MEM. The next plan recalls them, and user feedback adjusts their confidence.
8. **Evidence:** a JSONL trace of every step, handoff, query and model, plus a cited report with a confidence score and its reasons.

---

## Demo video script (about 3:30)

*Record a real run. Live runs take 7–9 minutes, so speed up the waiting and label it on screen ("sped up 8×"). Don't show `.env`, Nightshift's Providers page, or any key or token.*

| Time | On screen | Narration |
|---|---|---|
| 0:00–0:20 | Title card, then a revenue chart with a drop | "Revenue in Germany fell fifteen percent last quarter. Why? Today that's a day of an analyst's time, pulling orders from the ERP, slicing them, digging through the CRM. Causa does it in minutes, and shows its work." |
| 0:20–0:40 | Causa UI. Status pills: Zetaris online, Nightshift online, Nemotron | "Causa has four agents. The data comes from Zetaris, which federates our ERP and CRM databases. The reasoning runs on NVIDIA Nemotron through Meterless Nightshift." |
| 0:40–1:00 | Click the Germany example, then Investigate. The Planner step appears with `nemotron-3.5-lightning` | "I ask why German revenue dropped in Q3 1996. The Planner first checks its H-MEM memory for past findings, then decides what to test: customer segment, brand, shipping mode." |
| 1:00–1:40 | Timeline fills with `query_zetaris Q1…Q6`. Open the Zetaris UI briefly to show `causa_erp` and `causa_crm` | "The Analyst tests each hypothesis with real SQL in Zetaris: totals and a price-versus-volume split, the company-wide baseline, and a breakdown for each hypothesis, each scored against the overall trend." |
| 1:40–2:15 | Critic: `request_revision … 2 new queries asked`, then Analyst Q7, Q8 and the redraft | "Here's the important part. The Critic recomputes every number from its query and checks the draft. It wants the dominant driver drilled into, and the accounts checked in the CRM. So the Analyst goes back for more evidence." |
| 2:15–2:50 | The answer renders. Click `[Q6]`: CRM rows with "Lost the annual fleet-parts tender…". Click `[Q3]`: the SQL | "The answer: the Automobile segment lost five and a half million, through three accounts that went to zero. The CRM says why: they lost their annual tender to a cheaper competitor on 28 June. Every number links to the SQL and the rows behind it." |
| 2:50–3:10 | Meta line: models (Lightning, Ultra), 8 queries on Zetaris, trace path. Briefly show a `.jsonl` trace with `"model": "nvidia/…"` | "Every step is logged: which agent, which query, and which Nemotron model answered. Lightning did the reasoning, and Ultra wrote the report." |
| 3:10–3:30 | Click Helpful. Ask a follow-up about Germany Q4. The plan shows "recalled from memory: test it first" | "And it learns. The finding was stored in H-MEM. Ask a follow-up, and the Planner tests customer segment first, because that's what explained the last change. Causa: answers you can check." |

---

## Channel post (team chat, project-ideas, use-case-help)

> **Causa: an agent that explains why revenue moved** (Track 2)
>
> Planner → Analyst ↔ Critic → Reporter, over an ERP + CRM federated in Zetaris. The Critic recomputes every figure from its cited SQL and sends the Analyst back for more evidence until the draft holds up. H-MEM remembers which dimensions explained past changes and reorders the next plan. All reasoning runs on Nemotron (3.5 Lightning, plus 3 Ultra for the report) through Nightshift, with the model logged per call.
>
> Agent Loop Spec ↓ *(paste the 8 lines above)*
>
> One lesson from Nightshift: reasoning models can take more than 45 s to their first token. Send `meterless-ttfb-ms` (up to 300000) on the request, or Nightshift stops the lane.

---

## LinkedIn post

> Why did revenue drop? That question costs finance teams a day every month. Someone pulls the ERP orders, slices them a dozen ways, then hunts through the CRM for what happened to those accounts.
>
> For the Open Agent Hackathon 2026 I built **Causa**, four AI agents that run that investigation and show their work:
>
> 🧭 A **Planner** recalls past findings and ranks hypotheses.
> 🔎 An **Analyst** tests each one with SQL in **Zetaris**, joining the ERP and CRM in a single federated query.
> ⚖️ A **Critic** recomputes every number from its query and sends the Analyst back for more evidence until the draft holds up.
> 📝 A **Reporter** writes an answer where every figure links to the SQL behind it, and remembers what explained the change (Meterless **H-MEM**), so the next investigation starts there.
>
> Everything runs on **NVIDIA Nemotron** through **Meterless Nightshift**, and every step is logged with the model that handled it.
>
> Asked why German revenue fell 15% in Q3 1996, Causa traced it to three automotive accounts. The CRM showed they lost a tender to a cheaper competitor on 28 June.
>
> What I learned: the critic loop is the product. A fluent answer is easy. An answer where every number survives a recount is what makes it usable.
>
> Code and demo: *(links)*
>
> #OpenAgentHackathon #AIAgents #Zetaris #Meterless #NVIDIA #Nemotron

---

## X posts

1. Built Causa for #OpenAgentHackathon: ask "why did revenue drop?" and 4 agents investigate in @Zetaris (ERP + CRM, federated), a critic recomputes every number, and the answer cites the SQL behind each claim. Runs on NVIDIA Nemotron via Meterless Nightshift. *(link)*
2. The critic is the product. Causa's Critic agent re-derives every figure from its cited query and sends the Analyst back for more evidence until it holds. Fluent is easy; checkable is useful. *(demo link)*
3. Causa remembers what explained past changes (Meterless H-MEM), so the next investigation tests that first, and 👍/👎 on an answer adjusts that memory. *(link)*
