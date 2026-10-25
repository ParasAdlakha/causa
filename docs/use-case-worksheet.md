# Use Case Decision Worksheet: Causa

## Problem

| | |
|---|---|
| **Selected track** | Track 2: The Agent That Can Explain Why |
| **Problem statement** | When revenue moves, finance and sales-ops analysts spend a day pulling ERP orders, slicing them by segment, product and customer, and then searching the CRM for what happened to the accounts behind the change. Dashboards show *what* moved but not *why*, so the explanation is often a guess. |
| **Target user** | FP&A analysts, sales-operations and revenue-operations managers, and the finance business partner who has to answer "why is this number different?" in the monthly review |
| **Decision supported** | Where to act on a revenue change: which accounts, segments or prices to address, and whether the change is a one-off (a lost tender) or structural (pricing) |
| **Final output** | A cited answer: the size of the change, the driver(s), the CRM events behind them, a price-vs-volume split, the company-wide comparison, what was ruled out, a confidence score with reasons, and the suggested next step. Every figure links to the SQL and rows it came from. |

## Scope

| | |
|---|---|
| **What we will build in 144 hours** | A four-agent investigator (Planner, Analyst, Critic, Reporter) over a federated ERP + CRM in Zetaris, with H-MEM memory, Nemotron through Nightshift, a web UI that streams agent steps live, `POST /run`, a CLI, JSONL traces, tests, and a sample mode |
| **What we will not build** | Metrics other than revenue, forecasting, write-back to the CRM, user accounts, connectors to real customer systems |
| **Main demo scenario** | "Why did revenue in Germany drop in Q3 1996?" The agents find the Automobile segment and three accounts. The Critic forces a drill-down and a CRM check. The answer cites the lost tender on 28 June 1996. A follow-up question then recalls that finding from H-MEM. |
| **Pre-existing components to declare** | `vendor/hmem`: the Meterless H-MEM reference implementation and conformance suite (Apache-2.0), unchanged. Everything else was written 25–27 Oct 2026. |

## Data

| | |
|---|---|
| **Primary data source** | A synthetic wholesale distributor (TPC-H schema), 1995–1997: an ERP database (7 tables) and a CRM database (2 tables), with three planted stories as ground truth |
| **How it is registered in Zetaris** | `docker compose up -d` loads both into the `causa-db` Postgres container on the Zetaris network. `npm run zetaris:register` runs `scripts/register_zetaris_sources.sql`, which creates the `causa_erp` and `causa_crm` data sources and registers their tables |
| **Static data size estimate** | 187,679 rows; 2.3 MB compressed |
| **Runtime API required?** | No (data is local) |
| **Fallback sample mode?** | Yes: `SAMPLE_MODE=true` (SQLite, same seed) and `CAUSA_OFFLINE=true` (rule-based agents) |
| **Licensing or sensitivity concerns** | None. The data is generated, contains no real people or companies, and is released under Apache-2.0 |

## Sponsor technology

| Sponsor | Requirement | Where it fits in our build |
|---|---|---|
| Zetaris | Required: data layer | Every live query goes through `POST /sql-editor/sqls/run`. The CRM step is a federated join across `causa_crm` and `causa_erp` |
| Meterless Engine | Required: at least one in a working feature | H-MEM investigation memory: findings stored, recalled to reorder the next plan's hypotheses, with feedback from the UI |
| Meterless Nightshift | Required: primary AI provider | The only AI provider: `/v1/chat/completions` with the `meterless-app` and `meterless-scope` headers |
| NVIDIA | Where it contributes, through Nightshift | Nemotron 3.5 Lightning (plan, draft, critique) and Nemotron 3 Ultra (report). The trace logs the model for every call |
| AI coding tool | Your choice | Claude Code |

## Agents

| Agent | Role | Input | Output | Collaborates with |
|---|---|---|---|---|
| Planner | Scope the question; rank hypotheses using memory | Question, H-MEM recall | Periods, focus, ordered hypotheses with reasons | Analyst (delegates), H-MEM |
| Analyst | Run SQL in Zetaris; draft claims | Plan, the Critic's requests | Queries with rows; claims citing query ids | Critic (submits, revises) |
| Critic | Validate and challenge the draft | Draft, queries | 8 checks, issues, new query requests; approve or revise | Analyst (loop), Reporter (approves) |
| Reporter | Write the cited answer; score confidence; remember | Approved claims, queries, critiques | Report, confidence, H-MEM record | H-MEM, user (feedback) |

## Collaboration

- [x] Delegation: Planner → Analyst
- [x] Critique: Critic checks every claim against its query
- [x] Revision loop: Critic ↔ Analyst, up to 2 rounds, with new queries
- [x] Shared memory: H-MEM across runs; a shared context within a run
- [x] Branching: hypothesis order depends on memory; drill-down depends on the dominant driver
- [x] Retry: a model call with invalid JSON retries with the error; a failed model step falls back to computed claims
- [ ] Escalation
- [x] Confidence scoring: with listed reasons
- [x] Human-in-the-loop: Helpful / Wrong feedback updates H-MEM

## Constraints

- [x] Runs from a clean setup with no manual steps (`npm ci`, `docker compose up -d`, `npm run zetaris:register`, `npm start`; or sample mode with no services)
- [x] Runs quickly and predictably (≈15 s rule-based; 7–9 min with hosted Nemotron)
- [x] Repository is light (≈5 MB of data, no binaries beyond the compressed seed)
- [x] No hardcoded outputs (tests compare report figures with independent SQL; runtime never reads `output_examples/`)
- [x] No committed API keys (`.env` is git-ignored; the git history was scanned)
- [x] Logs show how the agent worked (`logs/*.jsonl`; example traces committed)
- [x] Sample inputs and outputs included (4 each)
- [x] Zetaris is the data layer, a Meterless Engine works in a feature, Nightshift is the AI provider, and NVIDIA use is documented

## Self-score (0–2 each)

| Question | Score |
|---|---|
| Can we explain the problem clearly in 30 seconds? | 2 |
| Do we know who the user is? | 2 |
| Do we have accessible data we can serve through Zetaris? | 2 |
| Can we build a working version in 144 hours? | 2 (built) |
| Can it run quickly and predictably? | 1 (live runs take 7–9 minutes, because of hosted reasoning models) |
| Do Zetaris and a Meterless Engine have a real role in the build? | 2 |
| Do agents interact more than once? | 2 |
| Is there critique, validation, or retry? | 2 |
| Can we show useful output in a 1–4 minute demo? | 2 |
| Can we document limitations clearly? | 2 |
| **Total** | **19 / 20: strong candidate** |
