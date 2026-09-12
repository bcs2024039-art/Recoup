# Where the recovery-probability numbers come from

This document exists because "illustrative, not measured from real data" was
a fair thing to call out. It wasn't good enough to just relabel the same
guesses as "validated" — so every number below now traces to a specific,
checkable public source, and every place I *couldn't* find a clean public
number says so instead of quietly making one up.

**What "validated" does and doesn't mean here:** there is no real business
behind this prototype, so there is no ground truth to check these numbers
against directly. What follows is the next best thing — grounding each
table in published industry benchmarks (dunning/payments vendors, AR
research, collections KPI literature, NPCI/RBI rules) rather than intuition,
being explicit about the spread between sources where they disagree, and
building `calibrate.py` (see below) so the moment real historical data
exists, these tables can be refit against *that* instead of against
someone else's aggregate.

All sources were checked August 2026. Vendor-published recovery-rate claims
have an obvious incentive bias — a dunning company citing an 80% recovery
rate is also selling dunning software — so where only vendor numbers exist,
that's noted and I calibrated toward the conservative end of the range.

---

## 1. Payment failure retry (`PAYMENT_SUCCESS`)

| Claim | Figure | Source |
|---|---|---|
| Fixed-schedule ("basic") retry recovers | ~10–25% of failed payments | Stuut.ai; Tagada glossary ("15–30% healthy, <10% signals misconfiguration") |
| Decline-reason-aware ("smart") retry recovers | ~45–80%, industry median ~50–55% | GR4VY (30%→50–65%); Finsi ("65–80% full program, median 50–55%"); Slicker ("45–60% across all decline types, up to 70% for soft declines specifically — not a blended rate") |
| Card network hard caps | Visa/Mastercard: ~15 attempts per 30 days | Slicker HQ |
| B2B recovers better than B2C, same decline reason | Directional, not quantified | Recurly, via Redux Payments |

**What we did with it:** the previous tables cumulated to ~85% recovered
across a payment-failure case's full attempt budget — above even the
optimistic end of "smart retry" claims, because compounding four
independent attempts pushes a per-attempt rate up fast. Retuned so the
blended cumulative for retryable decline codes lands at **69.2%**
(averaged over 20 seeds / 4,000 simulated cases, to get past single-run
noise): above the "basic retry" ceiling (this pipeline *is*
decline-reason- and timing-aware, which is exactly the cited
differentiator) and inside the full "smart retry" range, toward its
upper-middle rather than the ~50–55% cited median — defensible given the
reason-aware timing is the specific lever the research says drives the
higher end of that range, but worth knowing this isn't the conservative
end of the citation. `processing_error` (transient, non-financial) is
calibrated toward the higher end of the per-decline-code range;
`insufficient_funds` and `do_not_honor` (both ultimately about the
customer's real-time bank balance) toward the lower end — see §4 for why
that specific choice matters for UPI.

## 2. Card-update / re-authentication click-through

| Claim | Figure | Source |
|---|---|---|
| Payment-failure dunning email open rate | 50–70% | emailcalculator.com |
| Click-through to the billing-update link | 20–40% | emailcalculator.com; Baremetrics |
| Each additional touch recovers, diminishing after 3–4 | ~5–15% of what's left per touch | emailcalculator.com |
| Multi-channel (not email-only) programs recover | 70%+ vs. <25% open rate on email-only | Braincuber |

**What we did with it:** full-funnel completion (open → click → actually
fix the card → charge succeeds) has to be *below* the raw 20–40%
click-through rate, not above it. `CARD_UPDATE_CLICK_THROUGH` moved from
0.50 to 0.32; `REAUTH_CLICK_THROUGH` (an extra authentication step, more
friction than a card-update form) sits a bit under that, at 0.27. The
"multi-channel beats email-only" finding is why high-value cases getting
`email+sms` now carry a small explicit bump (`MULTI_CHANNEL_BUMP`) rather
than just a cost difference with no modeled benefit.

## 3. Checkout abandonment recovery

| Claim | Figure | Source |
|---|---|---|
| Typical multi-email flow recovery | 8–15%, high performers 15–20% | StickyDigital; Stripo; Sender.net |
| Klaviyo's own measured placed-order rate (143k+ flows) | 3.33% average, 7.69% top performers | Klaviyo 2024 Benchmark Report |
| First-email open rate vs. third-email open rate | 62.9% → 46.1% (decays, but slowly) | Mailmend/Klaviyo |
| Weak/single-touch flows | 3–5% | Mailmend |

**What we did with it:** the previous tables cumulated to ~27% overall —
above even the "high performing" range. Retuned per-stage base rates down
substantially (`payment_details` 0.20→0.06, `shipping_details` 0.14→0.035,
`browsing_cart` 0.09→0.02) so the blended cumulative across up to three
touches lands at **19.5%** (20-seed average): right at the top edge of
the "high-performing, 15–20%" band rather than inside the more common
8–15% range — defensible since our flow includes a targeted incentive on
higher-value carts from the second touch on, which several sources
specifically cite as a recovery lever, but the honest read is this
calibration sits at the generous end, not the median. Note Klaviyo's own
directly-measured number (3.33% average, 7.69% top performers) is
considerably *lower* than the marketing-blog "8–20%" figures that
dominate search results for this topic — those blog posts often appear to
measure a narrower "recovered ÷ clicked" or "recovered ÷ opened" ratio
and call it "recovery rate," which inflates the headline number. We
calibrated toward the multi-source "8–20%" consensus rather than
Klaviyo's raw 3.33%, since our stopping rules assume a full multi-touch,
incentive-eligible flow, closer to what "high performing" describes — but
flag that Klaviyo's own measured baseline is meaningfully more
conservative than that.

**Not independently sourced:** the specific size of the discount-incentive
lift (`INCENTIVE_BUMP`). Every source that mentions incentives affecting
recovery does so qualitatively ("discounts help," "personalization lifts
conversion") without isolating the marginal effect of *just* the
incentive. Kept modest (0.05) and flagged here rather than backed into a
citation that doesn't actually isolate this variable.

## 4. B2B receivables recovery, by aging bucket

| Claim | Figure | Source |
|---|---|---|
| Current / 0–30 days, with proactive follow-up | >95% ultimately collected | Crestmont Capital |
| 31–60 days | ~85–90% | Crestmont Capital |
| 61–90 days | ~73–80% | Crestmont Capital; Eagle Rock CFO, citing the Commercial Collection Agency Association (CCAA) and NACM |
| 91–120 days | ~50–60% | Crestmont Capital |
| 6 months past due | ~45–55% | Eagle Rock CFO / CCAA–NACM |
| 12 months past due | ~20–30% | Eagle Rock CFO / CCAA–NACM |
| Standard aging-bucket action ladder | 1–30d automated reminder → 31–60d + account-manager cc → 61–90d AR-manager escalation → 90+ executive review | LedgerUp |

**Important distinction — read this one carefully:** the figures above are
*ultimate eventual collection probability*, however long that takes and by
whatever means (including a phone call, a payment plan, or handing the
account to collections). Our `RECEIVABLE_BASE_RATE` table models something
narrower: probability of recovery via *automated dunning alone, within the
attempt budget* — the cases that resolve *before* a human ever gets
involved. No public source isolates that specific sub-metric, so rather
than force a citation onto a number it doesn't actually support, we
treated the cited figures as an upper bound and a shape (monotonic
decline, roughly halving every one to two aging buckets) and set the
automated-only rates as a documented fraction of them: `early` 0.35,
`follow_up` 0.24, `firm` 0.15, `pre_collections` 0.07. Population-weighted
across our aging-bucket mix, the cited *ultimate* ceiling for these four
buckets works out to roughly 77%; our simulated automated-only rate lands
at **53.9%** (20-seed average) — about 70% of that ceiling captured by
automation alone, the rest presumably needing the human escalation this
pipeline already routes to. That 70%-of-ceiling split is a reasoned
assumption, not a cited one - flagged as such rather than dressed up as
sourced. The 90+ day ("collections") bucket is not given an automated
recovery probability at all — it routes straight to a human, which turns
out to match the real industry action ladder above almost exactly, not
just our own judgment call.

## 5. Promise-to-pay honored rate

| Claim | Figure | Source |
|---|---|---|
| "Strong AR performance" PTP conversion (kept) rate | >80% | insightsoftware |
| Top-decile clients (anecdotal, one firm) | 98% | Resolut |
| A specific weaker vertical (anecdotal, one firm) | 60% (40% break rate) | Resolut |
| Illustrative worked example in a tutorial | 60% | mooninvoice.com |

**What we did with it:** this is the one table that came back essentially
already correct. `PROMISE_HONOURED_RATE = 0.68` sits inside the ~60–85%
range every source that gave a number pointed to, so it's unchanged —
now cited instead of asserted.

## 6. India-specific grounding (recurring payments)

| Claim | Figure | Source |
|---|---|---|
| NPCI UPI Autopay retry cap | 1 original attempt + 3 retries = 4 total | Kiwi Credit Card; RocketPay |
| Recommended retry windows | 24h, then 72h, then 7 days | productgrowth.in |
| RBI e-mandate AFA-exempt ceiling | ₹15,000 (general); ₹1,00,000 for insurance/SIP/credit-card-bill categories | Razorpay; PhonePe Business; multiple |
| UPI Autopay failure rate vs. card mandates | 8–15% vs. 2–3% | productgrowth.in |
| **UPI Autopay-specific smart-retry recovery** | **~15–20%** | productgrowth.in |

**This last row matters and cuts against the rest of this document.**
UPI Autopay's own recovery literature reports a *much* lower ceiling
(~15–20%) than the general card-decline "smart retry" literature in §1
(45–80%) — because a UPI debit is a real-time bank-balance check with no
float, no BIN-routing tricks, and no alternate-PSP retry path the way a
card transaction has. Our synthetic decline-code taxonomy
(`insufficient_funds`, `do_not_honor`, etc.) follows card-network
convention, not UPI mandate-execution codes, so we calibrated §1 to the
broader card literature. **A business running primarily on UPI Autopay
rails should expect meaningfully lower payment-recovery numbers than
these tables produce** — this is flagged, not smoothed over. What *is*
directly reflected: our `MAX_AUTOMATED_ATTEMPTS[payment_failure] = 4`
turns out to sit exactly at NPCI's hard ceiling for UPI mandates (1 + 3
retries), not just comfortably under Visa/Mastercard's much looser
~15-per-30-days limit — a real constraint validated the design choice,
rather than the design choice happening to be conservative by luck.

---

## Getting past "industry average": `calibrate.py`

Industry benchmarks are the ceiling of what's honestly claimable for a
business that doesn't exist. For a *real* deployment, the right move is to
stop trusting any of the tables above and refit them from that business's
own historical outcomes instead.

`calibrate.py` does exactly that: point it at a CSV of past cases (decline
code, wait days, category, aging bucket, whether it recovered) and it
re-derives each probability table by empirical frequency — no assumptions,
just counting. `sample_historical_outcomes.csv` is a **synthetic
self-test**, generated by sampling from this document's own tables plus
noise, purely to prove the calibration math recovers sane estimates from
outcome data. It is not real data and shouldn't be read as validating
anything beyond "the calibration script works." Run:

```bash
python3 calibrate.py sample_historical_outcomes.csv
```

and compare the output against `executor.py`'s hardcoded tables — see the
tests in `tests/test_calibrate.py` for the check that this recovers a
known generating rate within sampling noise.

---

## A bug this exercise surfaced

Calibrating against the tables above required running the same category's
numbers repeatedly while adjusting them - and the results kept moving in
directions the changes didn't explain (tightening the checkout tables
moved the *payment-failure* recovery rate). The cause: `run_batch` drew
every case's random outcomes from one shared, sequentially-consumed RNG
stream. Change how many random draws an earlier checkout or receivables
case consumes, and every unrelated payment case processed after it in
that shuffled batch silently draws different numbers too - a real
correctness issue for calibration, not just a cosmetic one, since it means
a change to one category's assumptions was invisibly perturbing another
category's simulated outcomes. Fixed in `engine.py`: each case now gets
its own seed, deterministically derived from `(batch seed, case id)` via
`hashlib` rather than Python's process-randomised built-in `hash()`, so
outcomes are reproducible *and* mutually independent regardless of
processing order. All figures in this document were measured after that
fix, averaged over 20 seeds (4,000 simulated cases per category) rather
than trusted from a single run, since single-seed noise on a 200-case
batch was itself large enough to be misleading — checkout's rate alone
moved between 9% and 28% run-to-run before averaging, using the exact
same formulas each time.

## A second bug, found by the tests written for the next round of features

Adding a batch-wide rate limit (§7 below) required cases to be processed
in true chronological order via a shared priority queue, rather than one
case run to completion before the next starts - only that way does "no
more than N messages per shared hour" mean anything. That rewrite passed
every existing test. The rate limiter's own new test
(`test_rate_limit_push_never_lands_in_quiet_hours`, in `test_engine.py`)
still caught a real bug: when a rate-limited message needed to be pushed
forward, the code computed the precise, quiet-hours-safe timestamp
correctly, then overwrote it with an hour-truncated version used
internally for counting messages-per-hour. For any whole-hour timezone
offset this is harmless. IST is +5:30 - a precise "local 8:00am" instant
has a non-zero minute in the underlying reference frame, so truncating it
back to :00 silently shifted the *local* time backward by up to 30
minutes, occasionally back into the 9pm-8am window it had just been
pushed out of. Since roughly 80-90% of events in this dataset are IST,
this wasn't an edge case - it was reproducible on ordinary seeds. Fixed
by keeping the precise timestamp and the hour-truncated dict key used
for rate-counting strictly separate (see `_apply_rate_limit`'s docstring
in `engine.py`). Re-checked afterward across 30 seeds × 4 cap values
(~54,000 scheduled touches): zero violations.

---

## 7. Cost of human escalation review

| Claim | Figure | Source |
|---|---|---|
| Collection cost is labor-dominated in the earliest aging stages | "labor charges constitute almost the entire collection cost" pre-30-days | HighRadius, "Unveiling the Cost of the Collection Journey" |
| A single collections call | ~$0.02/min, ~7 min average → ~$0.14/call | HighRadius |
| Cost per $1,000 collected roughly doubles per aging-bucket step | 0-30d baseline → 31-60d up ~200% → 61-90d up a further ~67% | HighRadius |

**What we did with it:** no public source gives a single "cost of one
escalation" figure - that's a business-specific mix of call time,
investigation time, and decision-making that isn't published anywhere we
could find. Rather than force a citation onto a number it doesn't
support, `ESCALATION_REVIEW_COST` in `executor.py` uses the *structure*
above (labor-dominated, cost scales with how much investigation a case
needs) to set three reasoned, India-context estimates - flagged exactly
like `INCENTIVE_BUMP` is, as an assumption built on cited structure
rather than a cited number itself: fraud signals (₹40 - often triaged by
a semi-automated trust & safety queue before a human ever looks at it),
dispute/hardship replies (₹120 - a real conversation), and exhausted
automated attempts (₹90 - a senior review weighing continued pursuit
against write-off).

## 8. What these tools found when actually run (not assumed)

Three counterfactuals became answerable once `PolicyConfig` made pacing
rules configurable and `compare_policies.py` could run the same batch
under two configs (20-seed averages, `n=200`):

- **Quiet hours cost ~nothing.** Recovered value differs by ~0.003%
  with enforcement on vs. off. The recovery-probability model is
  bucketed by day and attempt number, not hour of day, so respecting a
  9pm-8am window doesn't touch the numbers that drive outcomes.
- **The batch-wide rate limit also costs ~nothing** at any tested cap
  (down to 3/hour), for the same reason - it demonstrably fires
  (confirmed via the `batch_rate_limit` policy check in the audit trail)
  but only redistributes *when* messages go out, which this model
  doesn't price in.
- **Attempt caps are the one rule that isn't free.** +2 attempts per
  category moved recovered value from 53.9% to 58.3% of at-risk value,
  and *lowered* total cost - fewer expensive human escalations more than
  offsets a couple more cheap automated touches. Real caveat: for
  `payment_failure`, extending past 4 attempts isn't purely a business
  choice - NPCI's UPI Autopay framework caps recurring-payment mandates
  at exactly 4 (§6). Checkout and receivables have no equivalent
  external constraint, so that tradeoff is a real, undecided one, not
  something already settled by a regulator.
