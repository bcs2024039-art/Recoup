# Revenue Recovery Agent

A working prototype for **Track 03: AI Revenue Recovery** — an agent that
detects revenue at risk, diagnoses why, decides the right (bounded,
compliant) intervention, executes it, and proves what it recovered with a
full audit trail.

It covers the three workflows the brief names explicitly:

| Category | What's detected | What "recovery" looks like |
|---|---|---|
| **Payment failure** | A subscription charge declines (Razorpay/Stripe/Cashfree-style decline codes) | Smart retry timing, card-update requests, or a fresh-authentication request for large mandates |
| **Checkout abandonment** | A cart is left before payment completes | Reminder, tiered by drop-off stage and cart value, with an incentive only where it's economically justified |
| **B2B receivable** | An invoice goes overdue | An escalating dunning ladder, with a promise-to-pay tracker and dispute/hardship detection that pulls a human in instead of auto-dunning |

Two smaller directions from the brief are folded in rather than built as
separate tracks: **promise-to-pay tracking** is the receivables workflow's
core loop, and **Hinglish recovery messaging** is one of the two message
locales the drafting step can write in. True voice/telephony (STT/TTS,
IVR) is out of scope for a code prototype — see *What's simulated* below.

There are two ways to look at this submission:

- **This folder** — the backend reference engine. Deterministic, tested,
  zero dependencies, produces a real audit log.
- **`revenue_recovery_dashboard.jsx`** (delivered alongside this zip) — an
  interactive front-end reimplementation of the same design that runs
  live in the browser and makes *real* calls to the Gemini API for the
  judgment-requiring steps.

They're independent implementations of the same design, not one calling
the other — see *Why two implementations* below.

## Quickstart

```bash
python3 run_batch.py --n 200 --seed 42
```

No install step — pure Python 3.10+ standard library, nothing to `pip
install`. That's a deliberate choice, not an oversight: fewer moving
parts to trust.

This writes `output/audit_log.jsonl`, `output/summary.json`, and
`output/cases.csv`. A sample run is committed in `output/` already so you
can inspect real results without running anything.

Run the tests:

```bash
python3 -m unittest discover -s tests -v
```

## The pipeline

```
 detect          diagnose            decide                execute            measure
┌────────┐    ┌────────────┐    ┌──────────────┐    ┌──────────────────┐    ┌─────────┐
│ synthetic│──▶│ rules first,│──▶│ policy engine │──▶│ simulated gateway/│──▶│ audit + │
│ event    │   │ LLM only if │   │ (deterministic,│   │ messaging + real  │   │ summary │
│(webhook- │   │ genuinely   │   │  bounded,     │   │ Gemini-drafted    │   │ export  │
│ shaped)  │   │ ambiguous)  │   │  compliant)   │   │ copy              │   │         │
└────────┘    └────────────┘    └──────────────┘    └──────────────────┘    └─────────┘
```

Each case loops through this cycle up to its category's attempt cap,
advancing its own simulated clock by whatever delay the policy engine
scheduled, until it resolves as **recovered**, **escalated to a human**,
**opted out**, or **closed unrecovered**.

## Where AI is used, and where it deliberately isn't

This is the question the evaluation bar cares about most, so it gets its
own section instead of a buried comment.

**Used (`src/llm_judgment.py`), because the input is genuinely
unstructured:**
- Diagnosing a *repeated, unexplained* decline (`do_not_honor` recurring
  across attempts) — is this a soft decline worth patience, or a
  signal worth a human look? No lookup table answers that well.
- Classifying a free-text reply on an overdue invoice into
  promise-to-pay / dispute / hardship / other — language understanding,
  not keyword matching, is what actually generalizes here.
- Drafting the outreach copy itself, in the requested tone tier and
  locale (English or Hinglish) — copywriting is a generation task.

**Deliberately not used, because a rule is faster, cheaper, and more
provably correct:**
- **Compliance gates** — quiet hours, attempt caps, opt-out, the RBI
  e-mandate re-authentication threshold. These are the rules a
  regulator or an auditor would ask about; they need to be guaranteed,
  not "usually right." `src/policy.py` has zero randomness in it.
- **Decline-code categorization** — `insufficient_funds`,
  `expired_card`, `stolen_card`, etc. are a small, stable, well-known
  enumeration. There's no ambiguity for a model to resolve.
- **Checkout-abandonment diagnosis** — drop-off stage and cart value are
  already structured numeric/categorical fields. An LLM call here would
  add cost and latency for a decision a three-line rule already gets
  right (see `diagnose_checkout_abandonment`'s docstring for the
  explicit reasoning).
- **Retry/reminder scheduling, financial totals, the escalation
  trigger** — all deterministic arithmetic. Getting these wrong is a
  compliance or accounting bug, not a judgment call.

If `GEMINI_API_KEY` is set in the environment, `llm_judgment.py` calls
the real Gemini API (model `gemini-3.7-flash` — the Gemini lineup moves
fast, so check `ai.google.dev/gemini-api/docs/models` before relying on
that string long-term). Otherwise every one of those three functions
falls back to a heuristic that mimics the shape of the judgment call, so
the pipeline still runs end to end offline — and every fallback result is
tagged `llm_fallback_heuristic` in the audit trail so it's never confused
with a real model call. The sample run committed in `output/` was
generated in fallback mode (no key in this sandbox); wire in a key and
rerun to see real Gemini reasoning in the same audit log format.

## Validating the recovery-probability tables

`executor.py`'s success-rate tables used to be picked to feel plausible —
called out honestly as "illustrative, not measured from real data" and
left at that. That's no longer good enough on its own, so:

- **Every number now traces to a cited public benchmark** — dunning/
  payments vendor research, AR-aging and collections KPI literature, and
  NPCI's actual UPI Autopay retry rules. Full sourcing, the reasoning
  behind each figure, and — just as important — the places no clean
  public number exists (said outright, not smoothed over) are all in
  **`BENCHMARKS.md`**.
- **There's still no ground truth to check them against**, because there's
  no real business behind this prototype. Grounding in published
  benchmarks is the ceiling of what's honestly claimable here, not a
  substitute for the real thing.
- **`calibrate.py`** is the real thing's substitute: point it at a CSV of
  actual historical outcomes and it refits every table by empirical
  frequency. `sample_historical_outcomes.csv` is a synthetic self-test
  (sampled from `executor.py`'s own tables plus noise) proving the
  calibration math works — `tests/test_calibrate.py` checks it recovers
  known rates within sampling tolerance. Neither is real data.
- **A genuine bug surfaced while doing this**: cases used to share one
  sequential RNG stream, so retuning one category's numbers silently
  perturbed another category's simulated outcomes (documented, with the
  fix, in `BENCHMARKS.md`'s closing section). Worth knowing about if
  you're used to trusting a single simulation run — single-seed noise on
  a 200-case batch turned out to be large enough to be misleading on its
  own; the figures below and in `BENCHMARKS.md` are averaged over 20
  seeds where precision mattered.

## Compliant, bounded behaviour

All enforced in `src/policy.py` and `src/engine.py`, all covered by
`tests/test_policy.py` and `tests/test_engine.py`:

- **Attempt caps** — 4 automated touches for payment failures and
  receivables, 3 for checkout abandonment. Exceeding the cap blocks
  further automation on that attempt, logged as `max_attempts_exhausted`.
  4 also happens to be NPCI's own hard ceiling for UPI Autopay retries
  (1 original attempt + 3 retries) — a real network constraint, not just
  our own conservative choice, per `BENCHMARKS.md` §6.
- **Quiet hours** — nothing is scheduled between 9pm–8am in the
  customer's local time; a touch that would land there is pushed to the
  next 8am instead of just not sent.
- **Batch-wide rate limit** — a shared cap (default 15/hour, configurable,
  0 disables it) on outbound messages *across the whole batch combined*,
  not per case — protects sender reputation / provider throughput the
  way per-case rules can't. Enforced in `engine.py` rather than
  `policy.py`, because only the batch orchestrator has visibility across
  cases; everything else here is a per-case decision. Required switching
  from processing each case to completion before the next starts to a
  single priority queue ordered by real scheduled time across every case
  — see `engine.py`'s module docstring for why, and `BENCHMARKS.md`'s
  second bug writeup for a real timezone bug that rewrite surfaced.
- **Do-not-contact** — an opted-out customer is never touched again,
  checked first, every round.
- **Never-retry fraud signal** — a `stolen_card`/lost-card decline is
  never auto-retried, ever; it escalates immediately.
- **RBI e-mandate re-authentication threshold** — recurring-payment
  mandates above ₹15,000 (the AFA-exempt ceiling under the RBI's 2026
  Digital Payments E-mandate Framework) can't be silently auto-retried;
  the case is routed to a re-authentication request instead of a
  gateway retry.
- **Dispute/hardship auto-escalation** — if the reply-intent classifier
  flags a dispute or hardship, automated dunning stops immediately and
  the case is hard-routed to a human, on that same round.
- **High-value visibility** — cases above a per-category value
  threshold still run automatically, but are flagged for relationship-
  manager visibility rather than running unwatched.

Every one of the rules above is a *pacing or eligibility* rule with a
fixed answer. Compare that to `PolicyConfig` in `src/policy.py`, which
deliberately makes only the *pacing* rules (quiet hours, attempt caps,
the rate limit) configurable, for one purpose — measuring their cost, via
`compare_policies.py` below. There is no configuration path anywhere in
this codebase for the eligibility rules (fraud, opt-out, dispute/hardship
escalation), on purpose: those aren't a cost-benefit question.

## Measuring what these rules actually cost

Claiming a rule is "reasonable" isn't the same as knowing what it costs.
`compare_policies.py` runs the same batch under two policy configurations
and reports the difference, so the answer is measured, not assumed:

```bash
python3 compare_policies.py quiet_hours
python3 compare_policies.py rate_limit --cap 3
python3 compare_policies.py attempt_cap --extra-attempts 2
```

What running it actually found (20-seed averages, `n=200` — full detail
and caveats in `BENCHMARKS.md` §8):

| Rule | Cost of enforcing it |
|---|---|
| Quiet hours | ~0.003% of recovered value — effectively free |
| Batch rate limit | ~0% at any tested cap down to 3/hour — fires (verifiably, in the audit trail) but only shifts *when* messages go out, which the recovery model doesn't price in |
| Attempt caps | **Not free.** +2 attempts per category recovers 4.4pp more *and* costs less overall (fewer expensive human escalations) — see the NPCI caveat in `BENCHMARKS.md` §6 and §8 before treating that as a free lever for `payment_failure` specifically |

## Escalating to a human isn't free either

`ESCALATION_REVIEW_COST` in `executor.py` attaches a rough review cost
(₹40–120, varying by why a case escalated) to every hand-off to a human —
previously modeled as free, which understated the true cost of automation
stopping short. Structurally informed by cited cost-of-collection research
(labor-dominated, scales with investigation time); the specific rupee
figures are a reasoned estimate, not an independently sourced number —
flagged exactly like that distinction is flagged everywhere else in
`BENCHMARKS.md` §7. Shows up as `escalation_cost` on every `CaseResult`
and in the dashboard's Escalation Queue tab, so a disproportionate
escalation (a ₹120 review on a ₹2,000 case) is something you can actually
see, not something buried inside a lump "total cost" figure.

## Production integration seam

`src/adapters.py` defines the interfaces a real payment gateway
(`PaymentGatewayAdapter`) and messaging provider (`MessagingProviderAdapter`)
integration would implement — `executor.py` genuinely calls through them
(`SimulatedGatewayAdapter`, `SimulatedMessagingAdapter`), not just as
paper documentation. Swapping in `RazorpayAdapter()`/`TwilioAdapter()` in
place of the simulated ones is meant to be the only change needed to
point this pipeline at a real gateway — nothing in diagnosis, policy, or
the engine talks to a provider directly. `tests/test_adapters.py` checks
both that the simulated adapters genuinely satisfy the abstract
interfaces (so a real one really could be dropped in) and that
`executor.py` is actually delegating to them rather than keeping a
silently-drifting separate copy of the same probability logic.

## What it actually produced (n=200, seed=42, committed in `output/`)

```
Total at-risk value:      INR 31,486,083
Total recovered:          INR 17,850,223   (56.7%)
Escalated to human:       53   (review cost: INR 5,120.00)
Opted out (untouched):    2
Closed, unrecovered:      53
Total intervention cost:  INR 5,441.30   (incl. escalation review cost)
```

| Category | At risk | Recovered | Rate | Escalated | Escalation cost |
|---|---|---|---|---|---|
| Payment failure | ₹5,51,433 | ₹4,18,453 | 75.9% | 20/67 | ₹1,610 |
| Checkout abandonment | ₹3,07,650 | ₹77,770 | 25.3% | 0/67 | ₹0 |
| Receivable overdue | ₹3,06,27,000 | ₹1,73,54,000 | 56.7% | 33/66 | ₹3,510 |

A single 200-case run still carries real sampling noise — checkout's rate
alone swung between 9% and 28% across single-seed runs during
calibration, using identical formulas each time (see `BENCHMARKS.md`).
Averaged over 20 seeds (4,000 cases per category) rather than trusted
from one run, the underlying rates are closer to: payment failure 69.2%,
checkout abandonment 19.5%, receivables 53.9% — each now checked against
a specific cited range in `BENCHMARKS.md` rather than eyeballed. What
this run does prove regardless of noise: the pipeline executes end to
end on 200 realistic-shaped events, respects every compliance rule by
construction, and produces a complete, replayable audit trail for every
rupee.

## Why two implementations

The Python engine is the structured, tested reference implementation —
what you'd actually point a CI pipeline and a code reviewer at, and what
a real backend job would evolve from. The React dashboard is a live,
clickable demo shell: same conceptual design (same categories, same
policy constants, same pipeline shape), reimplemented in JS so it can run
entirely client-side with no server, and upgraded to call the *real*
Gemini API in the browser for the three judgment moments above, rather
than simulating them (the dashboard is bring-your-own-key: unlike this
Python engine's optional `GEMINI_API_KEY` env var, there's no server-side
key to inject into a client-side artifact, so the AI Judgment Lab tab
asks whoever opens the dashboard to paste their own key — kept in memory
for that session only). Treat the Python version as the one to trust for
the numbers, and the dashboard as the one to click through to see the
reasoning happen live.

## What's simulated vs what production would need

Being upfront about this is part of "would you trust it":

- **Time is a virtual clock**, advanced by the policy engine's own
  scheduling decision, not real wall-clock time. Production would run
  this as a scheduled job or a durable workflow (e.g. a cron task or
  Temporal) with real timestamps.
- **No real gateway/messaging integration** — but the seam for one now
  exists. `src/adapters.py` defines the interface; `execute()` calls
  through `SimulatedGatewayAdapter`/`SimulatedMessagingAdapter`, which
  still decide outcomes via the cited probability tables rather than a
  live API. Swapping in a real adapter is the intended path, not a
  rewrite - see "Production integration seam" above.
- **Message drafting, not sending.** The drafted copy is real (or
  really-Gemini-generated, if a key is present); nothing is actually
  delivered.
- **"Voice recovery" is represented as call-script text generation**,
  not real telephony (STT/TTS/IVR) — that needs infrastructure this
  prototype doesn't have.
- **The RBI e-mandate rule models one concrete threshold** (the general
  ₹15,000 AFA-exempt ceiling); it doesn't model the higher ₹1,00,000
  carve-out for insurance/SIP/credit-card-bill categories, since this
  prototype doesn't handle those categories. Real deployment needs a
  compliance review for the applicable jurisdiction — nothing here is
  legal advice.
- **Success-rate tables are grounded in cited industry benchmarks, not
  measured from this business's own data** — because this business
  doesn't exist. See `BENCHMARKS.md` for the full sourcing and
  `calibrate.py` for how to refit against real outcomes once they exist.

## Project layout

```
run_batch.py              CLI entry point
calibrate.py               refits probability tables from real historical outcomes
compare_policies.py         "cost of compliance" counterfactual (quiet hours / rate limit / attempt caps)
BENCHMARKS.md               sourcing for every recovery-probability number, plus every bug found along the way
sample_historical_outcomes.csv   synthetic self-test data for calibrate.py (not real data)
src/
  models.py                dataclasses: events, diagnosis, decisions, results
  data_generator.py        synthetic event generation (seeded, reproducible)
  diagnosis.py              root-cause diagnosis: rules + LLM trigger points
  policy.py                 compliance/bounded-behaviour decision engine + PolicyConfig
  llm_judgment.py            the one place that calls (or simulates) an LLM
  adapters.py                production integration seam (gateway + messaging interfaces)
  executor.py                simulated execution + outcome, via the adapters above
  audit.py                   JSONL audit trail writer
  engine.py                  global chronological scheduler + batch-wide rate limit
tests/
  test_policy.py             compliance-rule tests
  test_engine.py              rate-limit, escalation-cost, and PolicyConfig tests
  test_adapters.py            adapter-interface conformance tests
  test_calibrate.py           proves calibrate.py's math recovers known rates
output/                     a committed sample run (n=200, seed=42)
```
