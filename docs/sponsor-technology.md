# Sponsor technology in Causa

## Zetaris: the data layer

Causa's question ("why did revenue move?") can only be answered by combining two systems that normally don't talk to each other. The ERP knows *what* changed: orders, customers, parts. The CRM knows *why*: tenders lost, prices renegotiated, contracts won.

- Both live in their own Postgres database (`erp` and `crm`) in the `causa-db` container, which joins the Zetaris Docker network.
- [`scripts/register_zetaris_sources.sql`](../scripts/register_zetaris_sources.sql) registers them as the Zetaris data sources `causa_erp` and `causa_crm` (`CREATE DATASOURCE … OPTIONS (jdbcurl …)`, then `REGISTER DATASOURCE TABLES FROM …`). `npm run zetaris:register` runs it with no manual steps.
- Every query in live mode goes to Zetaris' REST API, `POST /api/v1.0/sql-editor/sqls/run`, with the API key and org id ([`src/data/zetaris.ts`](../src/data/zetaris.ts)). Tables are addressed as `causa_erp.lineitem`, `causa_crm.account_events` and so on.
- **Federation is load-bearing:** the CRM step joins `causa_crm.account_events` to `causa_erp.customer` (and `nation`, for the focus country) in a single query. Without Zetaris, that would mean exporting and stitching two databases by hand.
- A live run sends 8–12 queries to Zetaris. Each one is in the trace and in the UI, with its SQL, rows and timing.

## Meterless H-MEM: investigation memory (the engine-powered feature)

**Feature: the agent learns which explanations work.**

- After each investigation, the Reporter writes the finding to H-MEM: *"Germany, Q3 1995 vs Q3 1996: −15.1% (−$3.73M). Explained by customer market segment (Automobile), individual customer (…). Not the cause: part brand, …"*. It is tagged `driver:customer_segment`, `weak:part_brand` and `focus:germany`, with provenance pointing at the trace and query ids.
- Before the next investigation, the Planner runs an H-MEM query on the new question. Dimensions that explained earlier changes are tested first, and ones that were ruled out are tested last as controls. The plan states the reason ("recalled from memory").
- The UI's *Helpful / Wrong* buttons call H-MEM `feedback`, which changes the memory's confidence through the trust ledger and so its future ranking.
- **Tests:**
  - `test/pipeline.test.ts` shows a Germany finding being stored, recalled by a follow-up question, and moving `customer_segment` to the first hypothesis. Feedback lowers the confidence, and the ledger records it. **Passing.**
  - `npm run conformance` runs the official H-MEM conformance suite against the engine Causa imports. **13/13 passing.**
- The engine is the Meterless reference implementation, vendored unchanged under Apache-2.0 ([`vendor/hmem`](../vendor/hmem)) and declared as pre-existing. The feature built on it ([`src/engines/hmem.ts`](../src/engines/hmem.ts), the Planner and the Reporter) is new.

## Meterless Nightshift: the primary AI provider

- Every model call goes to Nightshift's OpenAI-compatible endpoint, `POST http://127.0.0.1:8088/v1/chat/completions` ([`src/llm.ts`](../src/llm.ts)). There is no other AI provider in the code.
- Headers: `Authorization: Bearer <runtime token>`, `meterless-app: causa`, `meterless-scope: user`. Also `meterless-ttfb-ms: 240000`, because Nemotron reasons before its first token.
- The token is read from the runtime's own `proxy-token` file, so it never needs copying. `GET /v1/models` is the online check.
- If Nightshift is unreachable, Causa switches to its rule-based agents and logs `select_mode … fallback` in the trace. It never pretends a model answered.

## NVIDIA Nemotron: the models (DGX Spark award)

| Step | Model (through a Nightshift lane) |
|---|---|
| Planner: plan the investigation | `nvidia/nemotron-3.5-lightning-30b-a3b` |
| Analyst: draft and redraft claims | `nvidia/nemotron-3.5-lightning-30b-a3b` |
| Critic: challenge the draft | `nvidia/nemotron-3.5-lightning-30b-a3b` |
| Reporter: write the final answer | `nvidia/nemotron-3-ultra-550b-a55b` |

- **Logs show which model handled each request.** Every model step in the JSONL trace has a `model` field taken from the response Nightshift returns (or its `meterless-model` header), plus `duration_ms` and `retry_count`. See the `*.trace.jsonl` files in [`output_examples/`](../output_examples).
- **Nemotron-specific handling:**
  - Ultra returns its reasoning inline, so `stripReasoning` keeps only the text after `</think>` (tested).
  - The Reporter's guard rejects any figure that isn't in the approved claims or their queries, so a fluent model can't introduce a number.

## AI coding tool

Built with Claude Code.

## What's unique

1. **Every claim is checked before release.** The Critic recomputes each figure from its cited query and blocks the answer until it matches. The answer arrives with the evidence that survived review.
2. **"What" and "why" from two systems in one question.** Zetaris federation lets the agent go from an ERP revenue drop to the CRM events of the same accounts in one step.
3. **It gets better at investigating.** H-MEM turns each answer into a prior for the next plan, and user feedback adjusts those priors.
4. **Honest under uncertainty.** On a control question with no planted cause (Japan, Q2 1996), Causa reports the real drop and its largest accounts, but finds no contract, tender or pricing event in the CRM. So it says the cause is not established, and its confidence falls to 70% (Germany scores 95%).
