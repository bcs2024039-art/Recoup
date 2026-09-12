import React, { useState, useMemo, useCallback, useEffect } from "react";
import heroBeachImg from "./assets/images/hero_beach_1788426747575.jpg";
import purpleBankImg from "./assets/images/purple_bank_1788426782788.jpg";
import { motion, AnimatePresence, useSpring, useTransform } from "motion/react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Cell,
} from "recharts";
import {
  AlertTriangle, CheckCircle2, ShieldAlert, Sparkles, X, Play, RefreshCw,
  IndianRupee, MessageSquare, CreditCard, ShoppingCart, Landmark, Loader2, Info, ChevronRight,
  Clock, Download, Search, ArrowUpDown, ListChecks, UserCheck, KeyRound, ExternalLink,
  FlaskConical, Scale, ArrowRight,
} from "lucide-react";

/* ======================================================================
   SEEDED RNG - mulberry32. Deterministic so a given seed always
   reproduces the same batch (mirrors the Python engine's random.Random).
   ====================================================================== */
function mulberry32(seed) {
  let s = seed;
  return function () {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
class RNG {
  constructor(seed) { this._r = mulberry32(seed); }
  random() { return this._r(); }
  randint(min, max) { return Math.floor(this.random() * (max - min + 1)) + min; }
  choice(arr) { return arr[Math.floor(this.random() * arr.length)]; }
  choices(arr, weights) {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = this.random() * total;
    for (let i = 0; i < arr.length; i++) { r -= weights[i]; if (r <= 0) return arr[i]; }
    return arr[arr.length - 1];
  }
  uniform(a, b) { return a + this.random() * (b - a); }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  gammaInt(k) { let s = 0; for (let i = 0; i < k; i++) s += -Math.log(1 - this.random()); return s; }
  betavariate(a, b) { const x = this.gammaInt(a), y = this.gammaInt(b); return x / (x + y); }
}

// Deterministic 32-bit FNV-1a string hash - used to give every case its
// own independent seed (see caseSeed below). Not cryptographic, doesn't
// need to be: just needs to be stable across runs and well-distributed,
// unlike relying on object/array iteration order for randomness.
function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function caseSeed(batchSeed, caseId) {
  return hashSeed(`${batchSeed}:${caseId}`);
}

/* ======================================================================
   SYNTHETIC DATA GENERATION - mirrors src/data_generator.py exactly:
   same categories, same decline codes, same weighting.
   ====================================================================== */
const PERSON_NAMES = ["Aarav", "Vivaan", "Aditya", "Ishaan", "Rohan", "Kabir", "Ananya", "Diya",
  "Saanvi", "Meera", "Priya", "Neha", "Karan", "Arjun", "Sanya", "Rhea"];
const COMPANY_NAMES = ["Global Traders", "Nimbus Retail", "BlueBridge Logistics", "Kestrel Foods",
  "Orchid Apparel", "Vertex Manufacturing", "Sundew Media", "Alpine Freight",
  "Copper Leaf Exports", "Ridgeline Components"];
const INDIA_TZ = 5.5;
const OTHER_TZ = [0.0, -5.0, 8.0, 1.0];
const DECLINE_CODES = ["insufficient_funds", "do_not_honor", "expired_card", "processing_error",
  "incorrect_number", "limit_exceeded", "stolen_card"];
const DECLINE_WEIGHTS = [0.30, 0.25, 0.14, 0.10, 0.08, 0.10, 0.03];
const PLANS = [["Starter", 499], ["Growth", 999], ["Pro", 2999], ["Scale", 4999], ["Annual Pro", 29999]];
const DROP_STAGES = ["browsing_cart", "shipping_details", "payment_details"];
const DROP_WEIGHTS = [0.35, 0.25, 0.40];
const B2B_REPLIES = [null, null, null, null,
  "Will clear this by the 30th, releasing payments in a batch this week.",
  "We dispute this invoice - PO number doesn't match our records, please resend.",
  "Facing a cash flow crunch this quarter, can we get 15 more days?",
  "Paid already, please check - will send UTR shortly.",
  "This has been escalated internally, expect payment by Friday."];
const SIM_NOW = new Date("2026-08-23T10:00:00Z").getTime();

function randTime(rng, daysBack) {
  const deltaMin = rng.randint(0, Math.max(daysBack, 1) * 24 * 60);
  return new Date(SIM_NOW - deltaMin * 60000);
}
function customer(rng, b2b = false) {
  return [`CUST-${rng.randint(10000, 99999)}`, rng.choice(b2b ? COMPANY_NAMES : PERSON_NAMES)];
}
function genPaymentFailures(rng, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const [cid, name] = customer(rng);
    const [plan, amount] = rng.choice(PLANS);
    out.push({
      id: `PMT-${String(i).padStart(5, "0")}`, category: "payment_failure",
      customerId: cid, customerName: name, amount, currency: "INR",
      createdAt: randTime(rng, 21), tzOffsetHours: rng.random() < 0.85 ? INDIA_TZ : rng.choice(OTHER_TZ),
      localeHint: rng.random() < 0.4 ? "hi-en" : "en", optedOut: rng.random() < 0.03,
      signal: { plan, declineCode: rng.choices(DECLINE_CODES, DECLINE_WEIGHTS), gateway: rng.choice(["Razorpay", "Stripe", "Cashfree"]), customerTenureMonths: rng.randint(1, 48) },
    });
  }
  return out;
}
function genCheckoutAbandonment(rng, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const isGuest = rng.random() < 0.35;
    const [cid, name] = isGuest ? ["GUEST", "Guest"] : customer(rng);
    const cart = Math.round(rng.choice([rng.uniform(300, 1500), rng.uniform(1500, 6000), rng.uniform(6000, 20000)]) / 10) * 10;
    out.push({
      id: `CKT-${String(i).padStart(5, "0")}`, category: "checkout_abandonment",
      customerId: cid, customerName: name, amount: cart, currency: "INR",
      createdAt: randTime(rng, 10), tzOffsetHours: rng.random() < 0.9 ? INDIA_TZ : rng.choice(OTHER_TZ),
      localeHint: rng.random() < 0.4 ? "hi-en" : "en", optedOut: !isGuest && rng.random() < 0.03,
      signal: { itemsCount: rng.randint(1, 6), dropOffStage: rng.choices(DROP_STAGES, DROP_WEIGHTS), device: rng.choice(["mobile", "desktop"]), isReturningCustomer: !isGuest && rng.random() < 0.5 },
    });
  }
  return out;
}
function genReceivables(rng, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const [cid, name] = customer(rng, true);
    const amount = Math.round(rng.choice([rng.uniform(25000, 150000), rng.uniform(150000, 500000), rng.uniform(500000, 1500000)]) / 1000) * 1000;
    const daysOverdue = rng.choices([rng.randint(1, 15), rng.randint(16, 30), rng.randint(31, 60), rng.randint(61, 90), rng.randint(91, 150)], [0.35, 0.25, 0.20, 0.12, 0.08]);
    out.push({
      id: `RCV-${String(i).padStart(5, "0")}`, category: "receivable_overdue",
      customerId: cid, customerName: name, amount, currency: "INR",
      createdAt: randTime(rng, 30), tzOffsetHours: rng.random() < 0.8 ? INDIA_TZ : rng.choice(OTHER_TZ),
      localeHint: "en", optedOut: false,
      signal: { daysOverdue, paymentHistoryScore: Math.round(rng.betavariate(5, 2) * 1000) / 10, invoiceCountLastYear: rng.randint(4, 48), relationshipManager: rng.choice(["Ritu", "Sameer", "Anjali", null]), customerReplyText: rng.choice(B2B_REPLIES) },
    });
  }
  return out;
}
function generateBatch(seed, total) {
  const rng = new RNG(seed);
  const third = Math.floor(total / 3), rem = total - third * 3;
  let events = [
    ...genPaymentFailures(rng, third + (rem > 0 ? 1 : 0)),
    ...genCheckoutAbandonment(rng, third + (rem > 1 ? 1 : 0)),
    ...genReceivables(rng, third),
  ];
  return rng.shuffle(events);
}

/* ======================================================================
   DIAGNOSIS - rules first; LLM only for genuinely ambiguous cases.
   Batch runs use the offline heuristic fallback (same one src/llm_judgment.py
   falls back to) so a full batch resolves instantly - the AI Judgment Lab
   tab below is where this demo calls the *real* Gemini API.
   ====================================================================== */
const DECLINE_PROFILES = {
  insufficient_funds: { label: "Insufficient funds", retryable: true, neverRetry: false, requiresCardUpdate: false, recommendedWaitDays: 3 },
  expired_card: { label: "Card expired", retryable: false, neverRetry: false, requiresCardUpdate: true, recommendedWaitDays: 1 },
  incorrect_number: { label: "Card details entered incorrectly", retryable: false, neverRetry: false, requiresCardUpdate: true, recommendedWaitDays: 1 },
  stolen_card: { label: "Card reported lost / stolen", retryable: false, neverRetry: true, requiresCardUpdate: false, recommendedWaitDays: 0 },
  processing_error: { label: "Gateway / processing error", retryable: true, neverRetry: false, requiresCardUpdate: false, recommendedWaitDays: 0 },
  do_not_honor: { label: "Bank declined, no reason given", retryable: true, neverRetry: false, requiresCardUpdate: false, recommendedWaitDays: 2, ambiguous: true },
  limit_exceeded: { label: "Card limit exceeded", retryable: true, neverRetry: false, requiresCardUpdate: false, recommendedWaitDays: 5 },
};
function diagnoseAmbiguousHeuristic(event) {
  const tenure = event.signal.customerTenureMonths || 1;
  return tenure >= 6
    ? { rootCause: "Likely a persistent soft decline from an established customer", confidence: 0.55, method: "llm_fallback_heuristic", rationale: "Long-tenure customers rarely churn silently; one more patient retry is worth it.", recommendedAction: "retry_payment", neverRetry: false, needsHuman: false }
    : { rootCause: "Repeated unexplained decline on a newer relationship", confidence: 0.5, method: "llm_fallback_heuristic", rationale: "Short tenure plus repeated opaque declines is worth a human glance before another attempt.", recommendedAction: "escalate_human", neverRetry: false, needsHuman: true };
}
function classifyReplyHeuristic(replyText) {
  const t = replyText.toLowerCase();
  let intent = "other";
  if (["dispute", "doesn't match", "po number", "incorrect invoice"].some((w) => t.includes(w))) intent = "dispute";
  else if (["cash flow", "crunch", "more days", "extension", "hardship"].some((w) => t.includes(w))) intent = "hardship";
  else if (["will clear", "will pay", "expect payment", "releasing payment", "by the"].some((w) => t.includes(w))) intent = "promise_to_pay";
  return { intent, confidence: 0.6, method: "llm_fallback_heuristic", rationale: "Keyword-matched fallback standing in for real intent classification." };
}
function diagnosePaymentFailure(event, attemptNumber) {
  const code = event.signal.declineCode || "do_not_honor";
  const profile = DECLINE_PROFILES[code] || DECLINE_PROFILES.do_not_honor;
  if (profile.ambiguous && attemptNumber >= 2) {
    const r = diagnoseAmbiguousHeuristic(event);
    return { rootCause: r.rootCause, method: r.method, confidence: r.confidence, rationale: r.rationale, neverRetry: r.neverRetry, needsHuman: r.needsHuman, recommendedAction: r.recommendedAction };
  }
  return {
    rootCause: profile.label, method: "rule", confidence: 0.95,
    rationale: `Decline code '${code}' maps directly to a known category - no ambiguity to resolve.`,
    neverRetry: profile.neverRetry, needsHuman: profile.neverRetry,
    recommendedAction: profile.requiresCardUpdate ? "request_card_update" : (profile.retryable ? "retry_payment" : "escalate_human"),
  };
}
function diagnoseCheckout(event) {
  const stage = event.signal.dropOffStage || "browsing_cart";
  const labels = { payment_details: "Friction at the final payment step", shipping_details: "Hesitation over shipping cost or timing", browsing_cart: "Low purchase intent / still comparing" };
  return { rootCause: labels[stage] || "Cart abandoned", method: "rule", confidence: 0.8, rationale: `Drop-off stage '${stage}' maps to a known abandonment pattern.`, neverRetry: false, needsHuman: false, recommendedAction: "send_checkout_reminder" };
}
function diagnoseReceivable(event, elapsedDays) {
  const reply = event.signal.customerReplyText;
  const daysOverdue = (event.signal.daysOverdue || 0) + elapsedDays;
  if (reply) {
    const r = classifyReplyHeuristic(reply);
    const needsHuman = r.intent === "dispute" || r.intent === "hardship";
    return { rootCause: `Customer reply classified as: ${r.intent.replace("_", " ")}`, method: r.method, confidence: r.confidence, rationale: r.rationale, neverRetry: false, needsHuman, recommendedAction: r.intent === "promise_to_pay" ? "await_promised_date" : (needsHuman ? "escalate_human" : "send_dunning_reminder") };
  }
  const bucket = daysOverdue <= 15 ? "early" : daysOverdue <= 30 ? "follow_up" : daysOverdue <= 60 ? "firm" : daysOverdue <= 90 ? "pre_collections" : "collections";
  return { rootCause: `Invoice ${daysOverdue} days overdue (${bucket.replace("_", " ")} stage)`, method: "rule", confidence: 0.9, rationale: "Days-overdue bucket is a deterministic, auditable aging rule, recomputed each round.", neverRetry: false, needsHuman: bucket === "collections", recommendedAction: bucket === "collections" ? "escalate_human" : "send_dunning_reminder" };
}
function diagnose(event, attemptNumber, elapsedDays = 0) {
  if (event.category === "payment_failure") return diagnosePaymentFailure(event, attemptNumber);
  if (event.category === "checkout_abandonment") return diagnoseCheckout(event);
  return diagnoseReceivable(event, elapsedDays);
}

/* ======================================================================
   POLICY ENGINE - deterministic, bounded, compliant. Zero randomness.
   Mirrors src/policy.py exactly, including the RBI e-mandate rule.
   ====================================================================== */
const MAX_AUTOMATED_ATTEMPTS = { payment_failure: 4, checkout_abandonment: 3, receivable_overdue: 4 };
const MIN_COOLDOWN_HOURS = { payment_failure: 12, checkout_abandonment: 4, receivable_overdue: 48 };
const HIGH_VALUE_ESCALATION_THRESHOLD = { payment_failure: 5000, checkout_abandonment: 20000, receivable_overdue: 600000 };
const AFA_REAUTH_THRESHOLD_INR = 15000;
const QUIET_HOURS_START = 21, QUIET_HOURS_END = 8;
const RETRY_SCHEDULE_HOURS = { checkout_abandonment: [4, 24, 72], receivable_overdue: [72, 120, 168, 240] };

// Only the *pacing* rules are configurable, mirroring src/policy.py's
// PolicyConfig exactly - deliberately no toggle for eligibility rules
// (fraud, opt-out, dispute/hardship escalation). Used by the Policy Lab
// tab's cost-of-compliance counterfactual, never changed by default.
const DEFAULT_POLICY_CONFIG = {
  enforceQuietHours: true,
  maxAttempts: { ...MAX_AUTOMATED_ATTEMPTS },
  maxMessagesPerHour: 15,
};

function localHour(date, tzOffsetHours) {
  const local = new Date(date.getTime() + tzOffsetHours * 3600000);
  return local.getUTCHours() + local.getUTCMinutes() / 60;
}
function pushPastQuietHours(date, tzOffsetHours) {
  const hour = localHour(date, tzOffsetHours);
  if (QUIET_HOURS_START <= hour || hour < QUIET_HOURS_END) {
    const local = new Date(date.getTime() + tzOffsetHours * 3600000);
    let next = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), QUIET_HOURS_END, 0, 0, 0));
    if (hour >= QUIET_HOURS_START) next = new Date(next.getTime() + 86400000);
    return new Date(next.getTime() - tzOffsetHours * 3600000);
  }
  return date;
}
function nextDelayHours(event, attemptNumber, recommendedWaitDays) {
  if (event.category === "payment_failure") {
    const baseDays = recommendedWaitDays != null ? recommendedWaitDays : 3;
    return Math.max((baseDays + (attemptNumber - 1) * 1.5) * 24, MIN_COOLDOWN_HOURS[event.category]);
  }
  const schedule = RETRY_SCHEDULE_HOURS[event.category];
  return Math.max(schedule[Math.min(attemptNumber - 1, schedule.length - 1)], MIN_COOLDOWN_HOURS[event.category]);
}
function decide(event, diagnosis, attemptNumber, simTime, recommendedWaitDays = null, config = DEFAULT_POLICY_CONFIG) {
  const checks = [];
  const optedOut = event.optedOut;
  checks.push({ rule: "do_not_contact_list", passed: !optedOut, detail: optedOut ? "Customer has opted out - all automated contact halts immediately." : "Not on the do-not-contact list." });
  if (optedOut) return { action: "none", blocked: true, reason: "opted_out", toneTier: 0, channel: null, scheduledAt: null, policyChecks: checks, autoEscalate: false };

  const fraud = diagnosis.neverRetry;
  checks.push({ rule: "never_retry_fraud_signal", passed: !fraud, detail: fraud ? "Fraud/lost/stolen signal present - automation must never retry this." : "No fraud signal present." });
  if (fraud) return { action: "escalate_human", blocked: true, reason: "fraud_or_high_risk_signal", toneTier: 0, channel: null, scheduledAt: simTime, policyChecks: checks, autoEscalate: true };

  const maxAttempts = config.maxAttempts[event.category];
  const exhausted = attemptNumber > maxAttempts;
  checks.push({ rule: "max_automated_attempts", passed: !exhausted, detail: `Attempt ${attemptNumber} of ${maxAttempts} allowed automated attempts.` });
  if (exhausted) {
    const autoEscalate = event.category !== "checkout_abandonment";
    return { action: autoEscalate ? "escalate_human" : "close_unrecovered", blocked: true, reason: "max_attempts_exhausted", toneTier: 0, channel: null, scheduledAt: simTime, policyChecks: checks, autoEscalate };
  }

  const needsHuman = diagnosis.needsHuman;
  checks.push({ rule: "diagnosis_flagged_human_review", passed: !needsHuman, detail: needsHuman ? diagnosis.rationale : "No human-review flag from diagnosis." });
  if (needsHuman) return { action: "escalate_human", blocked: true, reason: "diagnosis_requires_human_review", toneTier: 0, channel: null, scheduledAt: simTime, policyChecks: checks, autoEscalate: true };

  const threshold = HIGH_VALUE_ESCALATION_THRESHOLD[event.category];
  const highValue = event.amount > threshold;
  checks.push({ rule: "high_value_human_oversight", passed: true, detail: highValue ? `Amount INR ${event.amount.toFixed(0)} exceeds INR ${threshold.toFixed(0)} - relationship manager cc'd on this touch.` : `Amount INR ${event.amount.toFixed(0)} within the automated-only threshold.` });

  let action = diagnosis.recommendedAction || "send_checkout_reminder";
  if (action === "retry_payment" && event.amount > AFA_REAUTH_THRESHOLD_INR) {
    action = "request_reauth_payment";
    checks.push({ rule: "rbi_afa_reauth_threshold", passed: true, detail: `Amount INR ${event.amount.toFixed(0)} exceeds the INR ${AFA_REAUTH_THRESHOLD_INR.toLocaleString("en-IN")} e-mandate AFA-exempt ceiling - cannot silently auto-retry; customer must complete fresh authentication.` });
  } else {
    checks.push({ rule: "rbi_afa_reauth_threshold", passed: true, detail: "Within the e-mandate AFA-exempt ceiling - eligible for a silent retry." });
  }

  const delayHours = nextDelayHours(event, attemptNumber, recommendedWaitDays);
  let scheduledAt = new Date(simTime.getTime() + delayHours * 3600000);
  if (config.enforceQuietHours) {
    const preQuiet = scheduledAt.getTime();
    scheduledAt = pushPastQuietHours(scheduledAt, event.tzOffsetHours);
    checks.push({ rule: "quiet_hours", passed: true, detail: scheduledAt.getTime() !== preQuiet ? "Rescheduled past the 9pm-8am local quiet-hours window." : "Falls within allowed contact hours." });
  } else {
    checks.push({ rule: "quiet_hours", passed: true, detail: "Quiet-hours enforcement disabled in this policy config (counterfactual run only - never disabled by default)." });
  }

  const channel = action === "retry_payment" ? "gateway_retry" : (highValue ? "email+sms" : "email");
  return { action, blocked: false, reason: "proceed", toneTier: Math.min(attemptNumber, 4), channel, scheduledAt, policyChecks: checks, autoEscalate: false };
}

/* ======================================================================
   EXECUTOR - simulated outcomes. Every probability here is grounded in a
   cited public benchmark (dunning/AR/collections industry research, NPCI
   rules) rather than picked to feel plausible - full sourcing, the
   reasoning behind each number, and the places no clean benchmark exists
   (said outright, not papered over) are in the Python package's
   BENCHMARKS.md. These are still generic industry averages, not this
   (synthetic) business's own data - see calibrate.py in that package for
   how you'd refit against real historical outcomes instead. Message copy
   uses fast offline templates for batch runs; the AI Judgment Lab drafts
   with real Gemini.
   ====================================================================== */
const COST_PER_CHANNEL = { gateway_retry: 2.0, email: 0.3, "email+sms": 0.8 };
// Not independently sourced as a single figure (no benchmark isolates
// "cost of one escalation decision") - structurally informed by cited
// cost-of-collection research (labor-dominated, scales with
// investigation time), reasoned India-context estimates on top of that
// structure. See the Python package's BENCHMARKS.md §7.
const ESCALATION_REVIEW_COST = {
  fraud_or_high_risk_signal: 40.0,
  diagnosis_requires_human_review: 120.0,
  max_attempts_exhausted: 90.0,
};
// insufficient_funds/do_not_honor weighted low (real-time bank-balance
// problems, same structural ceiling UPI Autopay's own ~15-20% recovery
// literature describes); processing_error weighted high (transient, not
// balance-related). See BENCHMARKS.md §1, §6.
const PAYMENT_SUCCESS = {
  insufficient_funds: { 0: 0.06, 1: 0.12, 3: 0.28, 5: 0.32, 7: 0.34, 10: 0.22 },
  processing_error: { 0: 0.55, 1: 0.45, 3: 0.35 },
  do_not_honor: { 1: 0.15, 2: 0.18, 3: 0.20, 5: 0.19, 7: 0.17 },
  limit_exceeded: { 3: 0.20, 5: 0.25, 7: 0.35, 10: 0.28 },
};
// Full-funnel completion sits below the raw 20-40% dunning-email
// click-through rate, not above it - BENCHMARKS.md §2.
const CARD_UPDATE_CLICK_THROUGH = 0.32, REAUTH_CLICK_THROUGH = 0.27;
const MULTI_CHANNEL_BUMP = 0.03; // email+sms beats email-only dunning - BENCHMARKS.md §2
// Retuned down from a ~27% blended cumulative (above even "high
// performing" cart-recovery programs) to ~19-20%, the top edge of the
// cited "high-performing multi-touch" band - BENCHMARKS.md §3.
const CHECKOUT_BASE_RATE = { browsing_cart: 0.02, shipping_details: 0.035, payment_details: 0.06 };
const CHECKOUT_TIME_DECAY = { 1: 1.0, 2: 0.75, 3: 0.55 };
const INCENTIVE_BUMP = 0.05; // not independently sourced - flagged in BENCHMARKS.md §3
// Models recovery via automated dunning ALONE, not the higher "ultimate
// eventual collection by any means" figures the AR-aging literature
// reports - genuinely a different, narrower metric. BENCHMARKS.md §4.
const RECEIVABLE_BASE_RATE = { early: 0.35, follow_up: 0.24, firm: 0.15, pre_collections: 0.07 };
const PROMISE_HONOURED_RATE = 0.68; // already inside the cited ~60-85% range as-is - BENCHMARKS.md §5

function nearestBucketProb(table, waitDays) {
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  let closest = keys[0], min = Infinity;
  for (const k of keys) { const d = Math.abs(k - waitDays); if (d < min) { min = d; closest = k; } }
  return table[closest];
}
const CTA_BY_TIER = {
  1: "Just a friendly nudge - happy to help if anything's blocking this.",
  2: "Could you take a look when you get a chance? Reply here if you need any help.",
  3: "This needs attention soon to avoid any service interruption - let us know how we can help.",
  4: "We'd like to resolve this together - a member of our team will reach out shortly.",
};
function draftTemplate(event, detail, reason, toneTier, locale) {
  const T = {
    "payment_failure|en": (e) => `Hi ${e.customerName}, your payment of INR ${e.amount.toFixed(0)} for ${detail} didn't go through (${reason}). ${CTA_BY_TIER[toneTier]}`,
    "payment_failure|hi-en": (e) => `Hi ${e.customerName}, aapka INR ${e.amount.toFixed(0)} ka payment ${detail} ke liye complete nahi hua (${reason}). ${CTA_BY_TIER[toneTier]}`,
    "checkout_abandonment|en": (e) => `Hi ${e.customerName}, you left ${detail} worth INR ${e.amount.toFixed(0)} in your cart. ${CTA_BY_TIER[toneTier]}`,
    "checkout_abandonment|hi-en": (e) => `Hi ${e.customerName}, aapne apne cart mein INR ${e.amount.toFixed(0)} ka ${detail} chhoda hua hai. ${CTA_BY_TIER[toneTier]}`,
    "receivable_overdue|en": (e) => `Dear ${e.customerName}, invoice for INR ${e.amount.toFixed(0)} is ${detail}. ${CTA_BY_TIER[toneTier]}`,
    "receivable_overdue|hi-en": (e) => `Dear ${e.customerName}, INR ${e.amount.toFixed(0)} ka invoice ${detail} hai. ${CTA_BY_TIER[toneTier]}`,
  };
  const fn = T[`${event.category}|${locale}`] || T[`${event.category}|en`];
  return fn(event);
}
function execute(event, diagnosis, decision, attemptNumber, rng, elapsedDays = 0) {
  if (decision.blocked) return { executedAt: null, messagePreview: null, outcome: "n/a", amountRecovered: 0, costEstimate: 0 };
  let cost = COST_PER_CHANNEL[decision.channel] ?? 0.3;
  const multiBump = decision.channel === "email+sms" ? MULTI_CHANNEL_BUMP : 0;
  let message = null, recovered = false;

  if (decision.action === "retry_payment") {
    const table = PAYMENT_SUCCESS[event.signal.declineCode] || PAYMENT_SUCCESS.do_not_honor;
    const waitDays = decision.scheduledAt ? Math.max((decision.scheduledAt - event.createdAt) / 86400000, 0) : 0;
    recovered = rng.random() < nearestBucketProb(table, waitDays);
  } else if (decision.action === "request_card_update") {
    const reason = (DECLINE_PROFILES[event.signal.declineCode] || {}).label || "a card issue";
    message = draftTemplate(event, `your ${event.signal.plan || "subscription"} plan`, reason, decision.toneTier, event.localeHint);
    recovered = rng.random() < CARD_UPDATE_CLICK_THROUGH + multiBump;
  } else if (decision.action === "request_reauth_payment") {
    message = draftTemplate(event, `your ${event.signal.plan || "subscription"} plan renewal`, "needs a fresh authentication step under RBI e-mandate rules", decision.toneTier, event.localeHint);
    recovered = rng.random() < REAUTH_CLICK_THROUGH + multiBump;
  } else if (decision.action === "send_checkout_reminder") {
    const stage = event.signal.dropOffStage || "browsing_cart";
    const base = (CHECKOUT_BASE_RATE[stage] || 0.1) * (CHECKOUT_TIME_DECAY[attemptNumber] || 0.5);
    const giveIncentive = attemptNumber >= 2 && event.amount >= 1500;
    message = draftTemplate(event, `${event.signal.itemsCount} item(s)`, "cart abandoned at " + stage.replace("_", " "), decision.toneTier, event.localeHint) + (giveIncentive ? "  [10% off code: COMEBACK10]" : "");
    recovered = rng.random() < base + (giveIncentive ? INCENTIVE_BUMP : 0) + multiBump;
  } else if (decision.action === "send_dunning_reminder") {
    const days = (event.signal.daysOverdue || 0) + elapsedDays;
    const bucket = days <= 15 ? "early" : days <= 30 ? "follow_up" : days <= 60 ? "firm" : "pre_collections";
    message = draftTemplate(event, `INR ${event.amount.toFixed(0)}, ${days} days overdue`, `${bucket.replace("_", " ")}-stage follow-up`, decision.toneTier, event.localeHint);
    recovered = rng.random() < (RECEIVABLE_BASE_RATE[bucket] ?? 0.2) + multiBump;
  } else if (decision.action === "await_promised_date") {
    message = "(No new outbound message - waiting on the promised payment date.)";
    recovered = rng.random() < PROMISE_HONOURED_RATE;
    cost = 0;
  }
  return { executedAt: decision.scheduledAt, messagePreview: message, outcome: recovered ? "recovered" : "no_response", amountRecovered: recovered ? event.amount : 0, costEstimate: cost };
}

/* ======================================================================
   ORCHESTRATOR - processes every case's rounds in true global
   chronological order via a priority queue keyed by scheduled time, not
   case-by-case in isolation. Required for maxMessagesPerHour to mean
   anything, since it's a constraint shared across the whole batch, not
   a per-case rule. Mirrors src/engine.py exactly, including the same
   bug that rewrite surfaced there (see below).
   ====================================================================== */
const RATE_LIMITED_CHANNELS = new Set(["email", "email+sms"]);

function hourBucketKey(date) {
  const d = new Date(date.getTime());
  d.setUTCMinutes(0, 0, 0);
  return d.getTime();
}

function applyRateLimit(decision, event, hourlySent, maxPerHour) {
  // Keeps the precise timestamp (`candidate`) and the hour-truncated
  // value used only as the hourlySent map key strictly separate. An
  // earlier version of this collapsed the two - safe for whole-hour
  // timezone offsets, silently wrong for IST's +5:30: a precise local-
  // 8am instant (what pushPastQuietHours computes to escape quiet
  // hours) has a non-zero minute in the underlying reference frame, so
  // truncating it back to :00 shifts the *local* time backward by up to
  // 30 minutes - occasionally back into the window it had just escaped.
  // Same bug, same fix, as engine.py's _apply_rate_limit in the Python
  // package - see BENCHMARKS.md's second bug writeup.
  let candidate = decision.scheduledAt;
  let guard = 0;
  while (true) {
    candidate = pushPastQuietHours(candidate, event.tzOffsetHours);
    const key = hourBucketKey(candidate);
    if ((hourlySent.get(key) || 0) < maxPerHour || guard >= 24 * 14) break;
    candidate = new Date(key + 3600000);
    guard++;
  }
  const pushed = candidate.getTime() !== decision.scheduledAt.getTime();
  const finalKey = hourBucketKey(candidate);
  hourlySent.set(finalKey, (hourlySent.get(finalKey) || 0) + 1);
  decision.scheduledAt = candidate;
  decision.policyChecks.push({
    rule: "batch_rate_limit", passed: true,
    detail: pushed
      ? `Hour-slot at the shared ${maxPerHour}/hr cap - pushed to ${candidate.toISOString()}.`
      : `Under the shared ${maxPerHour}/hr cap for this slot.`,
  });
}

function popMin(heap) {
  let minIdx = 0;
  for (let i = 1; i < heap.length; i++) {
    const a = heap[i], b = heap[minIdx];
    if (a[0].getTime() < b[0].getTime() || (a[0].getTime() === b[0].getTime() && a[1] < b[1])) minIdx = i;
  }
  return heap.splice(minIdx, 1)[0];
}

function runBatch(events, seed, config = DEFAULT_POLICY_CONFIG) {
  // Each case gets its own seed (batch seed + case id), not one shared
  // sequential stream - otherwise tuning one category's probabilities
  // silently perturbs every other category's outcomes too, since it
  // changes how many random draws happen before them. See the Python
  // engine's BENCHMARKS.md for the calibration bug this caused there.
  const states = {};
  for (const e of events) {
    states[e.id] = {
      event: e, rng: new RNG(caseSeed(seed, e.id)), simTime: e.createdAt, attemptNumber: 1,
      status: "active", attempts: [], amountRecovered: 0, totalCost: 0, escalationCost: 0,
    };
  }
  const maxRounds = {};
  for (const e of events) maxRounds[e.id] = config.maxAttempts[e.category] + 1;

  const hourlySent = new Map();
  let seq = 0;
  const heap = events.map((e) => [e.createdAt, seq++, e.id]);

  while (heap.length > 0) {
    const [, , caseId] = popMin(heap);
    const state = states[caseId];
    if (state.status !== "active") continue;
    const event = state.event;
    const simTime = state.simTime;

    const elapsedDays = Math.max(Math.floor((simTime - event.createdAt) / 86400000), 0);
    const d = diagnose(event, state.attemptNumber, elapsedDays);
    let recommendedWaitDays = null;
    if (event.category === "payment_failure") recommendedWaitDays = (DECLINE_PROFILES[event.signal.declineCode] || {}).recommendedWaitDays ?? null;
    const decision = decide(event, d, state.attemptNumber, simTime, recommendedWaitDays, config);

    if (!decision.blocked && config.maxMessagesPerHour != null && RATE_LIMITED_CHANNELS.has(decision.channel)) {
      applyRateLimit(decision, event, hourlySent, config.maxMessagesPerHour);
    }

    const result = execute(event, d, decision, state.attemptNumber, state.rng, elapsedDays);

    if (decision.blocked) {
      if (decision.reason === "opted_out") state.status = "opted_out";
      else if (decision.autoEscalate) {
        state.status = "escalated_human";
        state.escalationCost = ESCALATION_REVIEW_COST[decision.reason] || 0;
        state.totalCost += state.escalationCost;
      } else state.status = "closed_unrecovered";
    } else if (result.outcome === "recovered") {
      state.status = "recovered";
    }

    state.amountRecovered += result.amountRecovered;
    state.totalCost += result.costEstimate;
    state.attempts.push({ caseId: event.id, attemptNumber: state.attemptNumber, diagnosis: d, decision, execution: result, caseStatusAfter: state.status });

    if (state.status === "active") {
      state.attemptNumber++;
      if (state.attemptNumber <= maxRounds[caseId] && decision.scheduledAt) {
        state.simTime = decision.scheduledAt;
        heap.push([state.simTime, seq++, caseId]);
      } else {
        state.status = "closed_unrecovered";
      }
    }
  }

  return Object.values(states).map((s) => ({
    event: s.event, status: s.status, attempts: s.attempts,
    amountRecovered: s.amountRecovered, totalCost: s.totalCost, escalationCost: s.escalationCost,
  }));
}
function computeComplianceStats(results) {
  let quietHourViolations = 0, optOutViolations = 0, fraudRetryViolations = 0;
  for (const r of results) for (const a of r.attempts) {
    if (!a.decision.blocked && a.decision.scheduledAt) {
      const h = localHour(a.decision.scheduledAt, r.event.tzOffsetHours);
      if (QUIET_HOURS_START <= h || h < QUIET_HOURS_END) quietHourViolations++;
    }
    if (r.event.optedOut && !a.decision.blocked) optOutViolations++;
    if (a.diagnosis.neverRetry && a.decision.action !== "escalate_human") fraudRetryViolations++;
  }
  return { quietHourViolations, optOutViolations, fraudRetryViolations };
}

/* ======================================================================
   ESCALATION-QUEUE + POLICY-ENGINE ANALYTICS - re-derive both views from
   the same attempt records the audit trail is built from, rather than
   tracking separate counters, so they can't drift from what actually ran.
   ====================================================================== */
function getEscalationReason(result) {
  const last = result.attempts[result.attempts.length - 1];
  if (!last) return { code: "unknown", label: "Unknown", detail: "" };
  const reason = last.decision.reason;
  if (reason === "fraud_or_high_risk_signal") {
    return { code: reason, label: "Fraud / never-retry signal", detail: last.diagnosis.rationale };
  }
  if (reason === "diagnosis_requires_human_review") {
    const rc = last.diagnosis.rootCause.toLowerCase();
    const label = rc.includes("dispute") ? "Customer disputes the charge" : rc.includes("hardship") ? "Customer reports hardship" : "Flagged for human review";
    return { code: reason, label, detail: last.diagnosis.rationale };
  }
  if (reason === "max_attempts_exhausted") {
    return { code: reason, label: "Automated attempts exhausted", detail: `${result.attempts.length - 1} automated touch(es) made no progress.` };
  }
  return { code: reason, label: reason, detail: last.diagnosis.rationale };
}

const RULE_META = {
  do_not_contact_list: { label: "Do-not-contact list", desc: "Blocks all automation the instant a customer has opted out." },
  never_retry_fraud_signal: { label: "Never-retry fraud signal", desc: "A stolen/lost-card decline is never auto-retried - escalates immediately, no exceptions." },
  max_automated_attempts: { label: "Max automated attempts", desc: "Caps automation at 3-4 touches per case, then forces a decision: escalate or close." },
  diagnosis_flagged_human_review: { label: "Diagnosis flags human review", desc: "A dispute or hardship reply halts automated dunning on the spot." },
  high_value_human_oversight: { label: "High-value RM visibility", desc: "Large cases still automate, but a relationship manager is cc'd rather than left unwatched." },
  rbi_afa_reauth_threshold: { label: "RBI e-mandate re-auth ceiling", desc: "Mandates over INR 15,000 can't be silently retried - routed to a re-authentication request instead." },
  quiet_hours: { label: "Quiet hours (9pm-8am local)", desc: "Nothing is ever scheduled to land inside the customer's local quiet-hours window." },
};
const RULE_FIRED_TEST = {
  do_not_contact_list: (c) => !c.passed,
  never_retry_fraud_signal: (c) => !c.passed,
  max_automated_attempts: (c) => !c.passed,
  diagnosis_flagged_human_review: (c) => !c.passed,
  high_value_human_oversight: (c) => c.detail.includes("cc'd"),
  rbi_afa_reauth_threshold: (c) => c.detail.includes("cannot silently auto-retry"),
  quiet_hours: (c) => c.detail.includes("Rescheduled"),
};
function computeRuleStats(results) {
  const stats = {};
  for (const name of Object.keys(RULE_META)) stats[name] = { evaluated: 0, fired: 0, examples: [] };
  for (const r of results) {
    for (const a of r.attempts) {
      for (const c of a.decision.policyChecks) {
        const s = stats[c.rule];
        if (!s) continue;
        s.evaluated++;
        if (RULE_FIRED_TEST[c.rule] && RULE_FIRED_TEST[c.rule](c)) {
          s.fired++;
          if (s.examples.length < 3) s.examples.push({ result: r, detail: c.detail });
        }
      }
    }
  }
  return stats;
}
function computeRecoveryByAttempt(results) {
  const byAttempt = {};
  for (const r of results) {
    for (const a of r.attempts) {
      if (a.execution.outcome === "recovered") {
        byAttempt[a.attemptNumber] = byAttempt[a.attemptNumber] || { recovered: 0, count: 0 };
        byAttempt[a.attemptNumber].recovered += a.execution.amountRecovered;
        byAttempt[a.attemptNumber].count += 1;
      }
    }
  }
  return Object.entries(byAttempt).sort((x, y) => Number(x[0]) - Number(y[0]))
    .map(([k, v]) => ({ name: `Attempt ${k}`, Recovered: Math.round(v.recovered), Cases: v.count }));
}
function computeHourHistogram(results) {
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0 }));
  for (const r of results) {
    for (const a of r.attempts) {
      if (!a.decision.blocked && a.decision.scheduledAt) {
        hours[Math.floor(localHour(a.decision.scheduledAt, r.event.tzOffsetHours))].count++;
      }
    }
  }
  return hours;
}

/* ======================================================================
   EXPORTS - hand the audit trail off, in the same shape the Python
   reference engine writes to output/audit_log.jsonl and output/cases.csv.
   ====================================================================== */
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function downloadAuditJSON(results) {
  const rows = [];
  for (const r of results) {
    for (const a of r.attempts) {
      rows.push({
        case_id: a.caseId, attempt_number: a.attemptNumber, category: r.event.category, customer: r.event.customerName,
        amount_inr: r.event.amount,
        diagnosis: a.diagnosis,
        decision: { ...a.decision, scheduledAt: a.decision.scheduledAt ? a.decision.scheduledAt.toISOString() : null },
        execution: { ...a.execution, executedAt: a.execution.executedAt ? a.execution.executedAt.toISOString() : null },
        case_status_after: a.caseStatusAfter,
      });
    }
  }
  triggerDownload(new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" }), "audit_log.json");
}
function downloadCasesCSV(results) {
  const headers = ["case_id", "category", "customer", "amount_inr", "status", "attempts", "amount_recovered_inr", "cost_inr"];
  const rows = results.map((r) => [r.event.id, CATEGORY_LABEL[r.event.category] || humanize(r.event.category), r.event.customerName, r.event.amount.toFixed(0), STATUS_LABEL[r.status] || humanize(r.status), r.attempts.length, r.amountRecovered.toFixed(0), r.totalCost.toFixed(2)]);
  const csv = [headers.join(","), ...rows.map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
  triggerDownload(new Blob([csv], { type: "text/csv" }), "cases.csv");
}

/* ======================================================================
   GEMINI API - real calls, used only in the AI Judgment Lab tab. Unlike
   Claude-in-artifact calls, there's no built-in key injection here, so
   this is a bring-your-own-key flow: the key lives only in React state
   (never persisted, never sent anywhere but Google's endpoint) and the
   model string is user-editable since the Gemini lineup moves fast -
   gemini-3.7-flash is current and GA as of this writing.
   ====================================================================== */
const GEMINI_DEFAULT_MODEL = "gemini-3.7-flash";
async function callGemini(model, system, user, maxTokens = 350) {
  const res = await fetch(`/api/gemini`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, system, user, maxTokens }),
  });
  if (!res.ok) {
    let detail = "";
    try { const err = await res.json(); if (err?.error) detail = `: ${err.error}`; } catch {}
    throw new Error(`Gemini API responded ${res.status}${detail}`);
  }
  const data = await res.json();
  if (!data.text) throw new Error("Empty response from API");
  return data.text;
}
function stripFences(t) { return t.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim(); }

/* ======================================================================
   FORMATTING HELPERS
   ====================================================================== */
const inr = (n) => `INR ${Math.round(n).toLocaleString("en-IN")}`;
const humanize = (str) => {
  if (typeof str !== "string") return str;
  return str.replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase());
};
const CATEGORY_LABEL = { payment_failure: "Payment failure", checkout_abandonment: "Checkout abandonment", receivable_overdue: "Receivable overdue" };
const CATEGORY_ICON = { payment_failure: CreditCard, checkout_abandonment: ShoppingCart, receivable_overdue: Landmark };
const STATUS_STYLE = {
  recovered: "text-emerald-400 bg-emerald-500/10",
  escalated_human: "text-rose-400 bg-rose-500/10",
  opted_out: "text-stone-400 bg-stone-500/10",
  closed_unrecovered: "text-stone-400 bg-stone-500/10",
  active: "text-amber-400 bg-amber-500/10",
};
const STATUS_LABEL = { recovered: "Recovered", escalated_human: "Escalated", opted_out: "Opted out", closed_unrecovered: "Unrecovered", active: "In progress" };

/* ======================================================================
   UI PRIMITIVES
   ====================================================================== */
function Eyebrow({ children }) {
  return <div className="text-[10px] uppercase tracking-widest text-stone-400 mb-3">{children}</div>;
}

function AnimatedNumber({ value, prefix = "", suffix = "" }) {
  const spring = useSpring(0, { bounce: 0, duration: 1500 });
  useEffect(() => {
    spring.set(value);
  }, [value, spring]);
  
  const display = useTransform(spring, (current) => {
    return prefix + Math.round(current).toLocaleString("en-IN") + suffix;
  });
  
  return <motion.span>{display}</motion.span>;
}

function KPICard({ icon: Icon, label, value, prefix, suffix, sub, tone = "stone" }) {
  const toneMap = { stone: "text-stone-100", emerald: "text-emerald-500", rose: "text-rose-500", amber: "text-amber-500" };
  return (
    <div className="bg-stone-900 border border-stone-800 p-5">
      <div className="flex items-center gap-2 text-stone-400 mb-3">
        <Icon size={15} />
        <span className="text-[10px] uppercase tracking-widest">{label}</span>
      </div>
      <div className={`text-2xl sm:text-3xl font-normal ${toneMap[tone]}`}><AnimatedNumber value={value} prefix={prefix} suffix={suffix} /></div>
      {sub && <div className="text-xs text-stone-400 mt-2">{sub}</div>}
    </div>
  );
}
function StatusPill({ status }) {
  return <span className={`inline-block px-2 py-0.5 text-[10px] uppercase tracking-widest border border-current ${STATUS_STYLE[status] || STATUS_STYLE.active}`}>{STATUS_LABEL[status] || humanize(status)}</span>;
}
function PolicyCheckRow({ check }) {
  return (
    <div className="flex items-start gap-2 text-xs font-mono leading-relaxed">
      <span className={check.passed ? "text-emerald-400" : "text-rose-400"}>{check.passed ? "\u2713" : "\u2717"}</span>
      <span className="text-stone-400 shrink-0">{humanize(check.rule)}</span>
      <span className="text-stone-400">&mdash;</span>
      <span className="text-stone-400">{check.detail}</span>
    </div>
  );
}

/* ======================================================================
   CASE DETAIL - the signature element: a ledger-style audit trail.
   ====================================================================== */
function AttemptBlock({ attempt }) {
  const d = attempt.diagnosis, dec = attempt.decision, ex = attempt.execution;
  return (
    <div className="relative border-l-2 border-stone-800 pl-5 pb-7 last:pb-0">
      <div className="absolute -left-[7px] top-0 w-3 h-3 rounded-full bg-amber-500 ring-4 ring-stone-950" />
      <div className="font-mono text-[11px] uppercase tracking-widest text-amber-500 mb-2.5">Attempt {attempt.attemptNumber}</div>

      <div className="space-y-3">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-stone-400 mb-1">Diagnose</div>
          <div className="text-stone-200 text-sm">{humanize(d.rootCause)}</div>
          <div className="text-stone-400 text-[11px] font-mono mt-0.5">method: {humanize(d.method)} &middot; confidence: {(d.confidence * 100).toFixed(0)}%</div>
          <div className="text-stone-400 text-xs mt-1 leading-relaxed">{d.rationale}</div>
        </div>

        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-stone-400 mb-1">Decide</div>
          <div className="text-stone-200 text-sm font-mono mb-1.5">{humanize(dec.action)}{dec.scheduledAt ? ` \u00b7 ${dec.scheduledAt.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}` : ""}</div>
          <div className="space-y-1 bg-stone-900/60 rounded-lg p-2.5 border border-stone-800/60">
            {dec.policyChecks.map((c, i) => <PolicyCheckRow key={i} check={c} />)}
          </div>
        </div>

        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-stone-400 mb-1">Act &amp; outcome</div>
          {ex.messagePreview && <div className="text-stone-300 text-sm italic bg-stone-900 rounded-lg p-2.5 border border-stone-800/60">&ldquo;{ex.messagePreview}&rdquo;</div>}
          {!ex.messagePreview && ex.outcome !== "n/a" && <div className="text-stone-400 text-xs italic">(silent gateway retry - no customer-facing message)</div>}
          <div className={`text-sm font-semibold mt-1.5 ${ex.outcome === "recovered" ? "text-emerald-400" : ex.outcome === "n/a" ? "text-stone-400" : "text-stone-400"}`}>
            {ex.outcome === "recovered" ? `Recovered \u00b7 ${inr(ex.amountRecovered)}` : ex.outcome === "n/a" ? "Blocked - no execution" : humanize(ex.outcome)}
          </div>
        </div>
      </div>
    </div>
  );
}
function CaseDetailModal({ result, onClose }) {
  if (!result) return null;
  const e = result.event;
  const Icon = CATEGORY_ICON[e.category];
  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/70 backdrop-blur-sm p-0 sm:p-4" onClick={onClose}>
      <div className="bg-stone-950 border border-stone-800 sm:rounded-2xl w-full sm:max-w-2xl h-full sm:h-auto sm:max-h-[88vh] overflow-y-auto" onClick={(ev) => ev.stopPropagation()}>
        <div className="sticky top-0 bg-stone-950/95 backdrop-blur border-b border-stone-800 px-5 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3 min-w-0">
            <Icon size={18} className="text-amber-500 shrink-0" />
            <div className="min-w-0">
              <div className="font-mono text-xs text-stone-400">{e.id}</div>
              <div className="font-bold text-stone-100 truncate">{e.customerName}</div>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <StatusPill status={result.status} />
            <button onClick={onClose} className="text-stone-400 hover:text-stone-200 transition"><X size={20} /></button>
          </div>
        </div>

        <div className="px-5 py-4 border-b border-stone-800 grid grid-cols-3 gap-3 text-center">
          <div><div className="font-mono text-[10px] uppercase text-stone-400">At risk</div><div className="text-stone-200 font-bold text-sm mt-0.5">{inr(e.amount)}</div></div>
          <div><div className="font-mono text-[10px] uppercase text-stone-400">Recovered</div><div className={`font-bold text-sm mt-0.5 ${result.amountRecovered > 0 ? "text-emerald-400" : "text-stone-400"}`}>{inr(result.amountRecovered)}</div></div>
          <div><div className="font-mono text-[10px] uppercase text-stone-400">Attempts</div><div className="text-stone-200 font-bold text-sm mt-0.5">{result.attempts.length}</div></div>
        </div>

        <div className="px-5 py-5">
          {result.attempts.map((a, i) => <AttemptBlock key={i} attempt={a} />)}
        </div>
      </div>
    </div>
  );
}

/* ======================================================================
   DASHBOARD TAB
   ====================================================================== */
const staggerContainer = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.1 } }
};
const dropIn = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { ease: "easeOut", duration: 0.4 } }
};

function DashboardTab({ results }) {
  const stats = useMemo(() => {
    const overall = { atRisk: 0, recovered: 0, escalated: 0, optedOut: 0, cost: 0 };
    const byCat = {};
    for (const cat of Object.keys(CATEGORY_LABEL)) byCat[cat] = { atRisk: 0, recovered: 0, count: 0 };
    for (const r of results) {
      overall.atRisk += r.event.amount;
      overall.recovered += r.amountRecovered;
      overall.cost += r.totalCost;
      if (r.status === "escalated_human") overall.escalated++;
      if (r.status === "opted_out") overall.optedOut++;
      const c = byCat[r.event.category];
      c.atRisk += r.event.amount; c.recovered += r.amountRecovered; c.count++;
    }
    return { overall, byCat };
  }, [results]);
  const compliance = useMemo(() => computeComplianceStats(results), [results]);
  const recoveryByAttempt = useMemo(() => computeRecoveryByAttempt(results), [results]);
  const hourHistogram = useMemo(() => computeHourHistogram(results), [results]);
  const maxHourCount = Math.max(1, ...hourHistogram.map((h) => h.count));
  const rate = stats.overall.atRisk ? (100 * stats.overall.recovered / stats.overall.atRisk) : 0;

  const chartData = Object.entries(stats.byCat).map(([cat, v]) => ({
    name: CATEGORY_LABEL[cat].replace(" failure", "").replace(" abandonment", "").replace(" overdue", ""),
    "At risk": Math.round(v.atRisk), "Recovered": Math.round(v.recovered),
  }));

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={dropIn} className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <KPICard icon={IndianRupee} label="Total at risk" value={stats.overall.atRisk} prefix="INR " sub={`${results.length} cases detected`} />
        <KPICard icon={CheckCircle2} label="Recovered" value={stats.overall.recovered} prefix="INR " sub={`${rate.toFixed(1)}% recovery rate`} tone="emerald" />
        <KPICard icon={ShieldAlert} label="Escalated to human" value={stats.overall.escalated} sub={`${stats.overall.optedOut} opted out, untouched`} tone="amber" />
        <KPICard icon={AlertTriangle} label="Intervention cost" value={stats.overall.cost} prefix="INR " sub={stats.overall.recovered ? `~INR ${(stats.overall.cost / stats.overall.recovered * 1000).toFixed(2)} per INR 1,000 recovered` : "-"} />
      </motion.div>

      <motion.div variants={dropIn} className="bg-stone-900 border border-stone-800 rounded-xl p-4 sm:p-5">
        <Eyebrow>At risk vs. recovered, by category</Eyebrow>
        <div style={{ height: 260 }} className="mt-3">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 12 }} axisLine={{ stroke: "rgba(255,255,255,0.15)" }} tickLine={false} />
              <YAxis tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip cursor={{ fill: "transparent" }} contentStyle={{ background: "#ffffff", border: "none", borderRadius: "6px", fontSize: 12, color: "#111111", boxShadow: "0 4px 12px rgba(0,0,0,0.5)" }} labelStyle={{ color: "#111111", fontWeight: 600, marginBottom: 4 }} itemStyle={{ color: "#111111" }} formatter={(v) => inr(v)} />
              <Legend wrapperStyle={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }} />
              <Bar dataKey="At risk" fill="rgba(255,255,255,0.1)" radius={[0, 0, 0, 0]} />
              <Bar dataKey="Recovered" fill="#b59f85" radius={[0, 0, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </motion.div>

      <motion.div variants={dropIn} className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-stone-900 border border-stone-800 rounded-xl p-4 sm:p-5">
          <Eyebrow>Recovered value by attempt number</Eyebrow>
          <div style={{ height: 200 }} className="mt-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={recoveryByAttempt} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }} axisLine={{ stroke: "rgba(255,255,255,0.15)" }} tickLine={false} />
                <YAxis tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip cursor={{ fill: "transparent" }} contentStyle={{ background: "#ffffff", border: "none", borderRadius: "6px", fontSize: 12, color: "#111111", boxShadow: "0 4px 12px rgba(0,0,0,0.5)" }} labelStyle={{ color: "#111111", fontWeight: 600, marginBottom: 4 }} itemStyle={{ color: "#111111" }} formatter={(v) => inr(v)} />
                <Bar dataKey="Recovered" radius={[0, 0, 0, 0]}>
                  {recoveryByAttempt.map((_, i) => <Cell key={i} fill={i === 0 ? "#b59f85" : i === 1 ? "#a38c73" : "#d8ccbc"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="text-xs text-stone-400 mt-2 leading-relaxed">Most recovery lands in the first one or two touches - the attempt caps aren&rsquo;t only about compliance, further attempts have rapidly diminishing returns.</div>
        </div>

        <div className="bg-stone-900 border border-stone-800 rounded-xl p-4 sm:p-5">
          <Eyebrow>Contact timing, by local hour of day</Eyebrow>
          <div className="flex items-end gap-0.5 mt-4" style={{ height: 120 }}>
            {hourHistogram.map((h) => {
              const inQuiet = QUIET_HOURS_START <= h.hour || h.hour < QUIET_HOURS_END;
              return (
                <div key={h.hour} className="flex-1 h-full flex items-end">
                  <div className={`w-full rounded-sm ${inQuiet ? "bg-stone-800" : "bg-amber-500/70"}`} style={{ height: `${Math.max(2, (h.count / maxHourCount) * 100)}%` }} />
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-[10px] font-mono text-stone-400 mt-1.5">
            <span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>12am</span>
          </div>
          <div className="text-xs text-stone-400 mt-2 leading-relaxed">Darker band is the 9pm-8am quiet-hours window - zero automated touches ever land there, by construction.</div>
        </div>
      </motion.div>

      <motion.div variants={dropIn} className="bg-stone-900 border border-stone-800 rounded-xl p-4 sm:p-5">
        <Eyebrow>Verified against this run</Eyebrow>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
          {[
            { label: "Quiet-hours violations", value: compliance.quietHourViolations },
            { label: "Contact-after-opt-out", value: compliance.optOutViolations },
            { label: "Fraud signals retried", value: compliance.fraudRetryViolations },
          ].map((s) => (
            <div key={s.label} className="flex items-center gap-2.5">
              <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
              <div className="text-sm text-stone-400">{s.label}: <span className="font-mono font-bold text-stone-200">{s.value}</span></div>
            </div>
          ))}
        </div>
        <div className="text-xs text-stone-400 mt-3 leading-relaxed">Re-scanned live from every attempt this batch produced, not asserted from design intent - see the Cases tab for the underlying audit trail.</div>
      </motion.div>
    </motion.div>
  );
}

/* ======================================================================
   CASES TAB
   ====================================================================== */
function CasesTab({ results, onSelect }) {
  const [filterCat, setFilterCat] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("amount");
  const [sortDir, setSortDir] = useState("desc");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = results.filter((r) =>
      (filterCat === "all" || r.event.category === filterCat) &&
      (filterStatus === "all" || r.status === filterStatus) &&
      (q === "" || r.event.customerName.toLowerCase().includes(q) || r.event.id.toLowerCase().includes(q))
    );
    const keyFn = { amount: (r) => r.event.amount, attempts: (r) => r.attempts.length }[sortKey] || ((r) => r.event.amount);
    rows = [...rows].sort((a, b) => (keyFn(a) - keyFn(b)) * (sortDir === "asc" ? 1 : -1));
    return rows;
  }, [results, filterCat, filterStatus, query, sortKey, sortDir]);

  const chip = (key, active, onClick, label) => (
    <button key={key} onClick={onClick} className={`px-3 py-1.5 text-[10px] uppercase tracking-widest whitespace-nowrap transition border ${active ? "bg-stone-100 text-stone-900 border-stone-100" : "bg-transparent text-stone-400 border-stone-800 hover:border-stone-500"}`}>{label}</button>
  );
  const sortBtn = (key, label) => (
    <button onClick={() => { if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc")); else { setSortKey(key); setSortDir("desc"); } }}
      className={`inline-flex items-center gap-1 transition ${sortKey === key ? "text-amber-500" : "text-stone-400 hover:text-stone-400"}`}>
      {label} <ArrowUpDown size={11} />
    </button>
  );

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-2">
        {chip("all-cat", filterCat === "all", () => setFilterCat("all"), "All categories")}
        {Object.entries(CATEGORY_LABEL).map(([k, v]) => chip(k, filterCat === k, () => setFilterCat(k), v))}
      </div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {chip("all-stat", filterStatus === "all", () => setFilterStatus("all"), "All statuses")}
        {Object.entries(STATUS_LABEL).filter(([k]) => k !== "active").map(([k, v]) => chip(k, filterStatus === k, () => setFilterStatus(k), v))}
        <div className="relative sm:ml-auto">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search customer or case ID"
            className="bg-stone-900 border border-stone-800 pl-8 pr-3 py-1.5 text-xs text-stone-100 placeholder-stone-600 focus:outline-none focus:border-amber-500 w-56" />
        </div>
      </div>

      <div className="bg-stone-900 border border-stone-800 overflow-hidden">
        <div className="overflow-x-auto" style={{ maxHeight: "60vh", overflowY: "auto" }}>
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-stone-900 border-b border-stone-800">
              <tr className="text-left text-[10px] uppercase tracking-widest text-stone-400">
                <th className="px-4 py-3 font-normal">Case</th><th className="px-4 py-3 font-normal">Category</th><th className="px-4 py-3 font-normal">Customer</th>
                <th className="px-4 py-3 text-right font-normal">{sortBtn("amount", "Amount")}</th><th className="px-4 py-3 font-normal">Status</th>
                <th className="px-4 py-3 text-right font-normal">{sortBtn("attempts", "Attempts")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.event.id} onClick={() => onSelect(r)} className="border-b border-stone-800/60 last:border-0 hover:bg-stone-800/40 cursor-pointer transition">
                  <td className="px-4 py-3 text-xs text-stone-400">{r.event.id}</td>
                  <td className="px-4 py-3 text-stone-400 text-xs">{CATEGORY_LABEL[r.event.category]}</td>
                  <td className="px-4 py-3 text-stone-100">{r.event.customerName}</td>
                  <td className="px-4 py-3 text-right text-stone-100">{inr(r.event.amount)}</td>
                  <td className="px-4 py-3"><StatusPill status={r.status} /></td>
                  <td className="px-4 py-3 text-right text-stone-400">{r.attempts.length}</td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-stone-400 text-sm">No cases match these filters.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <div className="text-xs text-stone-400 mt-2 font-mono">{filtered.length} of {results.length} cases shown</div>
    </div>
  );
}

/* ======================================================================
   ESCALATION QUEUE TAB - the human reviewer's view: every case
   automation deliberately stopped on, grouped by why.
   ====================================================================== */
function EscalationQueueTab({ results, onSelect }) {
  const escalated = useMemo(() => results.filter((r) => r.status === "escalated_human")
    .map((r) => ({ result: r, reason: getEscalationReason(r) })), [results]);

  const groups = useMemo(() => {
    const g = {};
    for (const item of escalated) {
      const key = item.reason.code;
      g[key] = g[key] || { label: item.reason.label, items: [], value: 0, reviewCost: 0 };
      g[key].items.push(item);
      g[key].value += item.result.event.amount;
      g[key].reviewCost += item.result.escalationCost;
    }
    return g;
  }, [escalated]);

  const groupIcon = { fraud_or_high_risk_signal: ShieldAlert, diagnosis_requires_human_review: MessageSquare, max_attempts_exhausted: Clock };
  const groupTone = { fraud_or_high_risk_signal: "text-rose-400", diagnosis_requires_human_review: "text-amber-400", max_attempts_exhausted: "text-stone-400" };
  const DISPROPORTIONATE_THRESHOLD = 0.05; // review cost exceeding 5% of case value is worth a second look

  if (escalated.length === 0) {
    return <div className="text-center py-16 text-stone-400 text-sm">No cases were escalated in this batch - everything resolved automatically, opted out, or ran to close on its own.</div>;
  }

  const totalReviewCost = escalated.reduce((s, i) => s + i.result.escalationCost, 0);
  const disproportionateCount = escalated.filter((i) => i.result.escalationCost / i.result.event.amount > DISPROPORTIONATE_THRESHOLD).length;

  return (
    <div className="space-y-5">
      

      {Object.entries(groups).map(([code, g]) => {
        const Icon = groupIcon[code] || AlertTriangle;
        return (
          <div key={code} className="bg-stone-900 border border-stone-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-stone-800 flex items-center justify-between flex-wrap gap-1">
              <div className="flex items-center gap-2">
                <Icon size={15} className={groupTone[code] || "text-stone-400"} />
                <span className="font-bold text-stone-200 text-sm">{g.label}</span>
                <span className="text-xs font-mono text-stone-400">&times;{g.items.length}</span>
              </div>
              <span className="text-xs font-mono text-stone-400">{inr(g.value)} at stake &middot; {inr(g.reviewCost)} review cost</span>
            </div>
            <div className="divide-y divide-stone-800/60">
              {g.items.map(({ result, reason }) => {
                const disproportionate = result.escalationCost / result.event.amount > DISPROPORTIONATE_THRESHOLD;
                return (
                  <div key={result.event.id} onClick={() => onSelect(result)} className="px-4 py-3 hover:bg-stone-800/40 cursor-pointer transition flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-stone-200 text-sm flex items-center gap-1.5">
                        {result.event.customerName} <span className="text-stone-400 font-mono text-xs">&middot; {result.event.id}</span>
                        {disproportionate && <span title="Review cost exceeds 5% of case value" className="text-[10px] font-mono text-rose-400 bg-rose-500/10 rounded px-1.5 py-0.5">review cost &gt; 5% of value</span>}
                      </div>
                      <div className="text-stone-400 text-xs mt-0.5 leading-relaxed">{reason.detail}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono text-sm text-stone-300">{inr(result.event.amount)}</div>
                      <div className="text-[11px] text-stone-400">{CATEGORY_LABEL[result.event.category]} &middot; {inr(result.escalationCost)} review</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ======================================================================
   POLICY ENGINE TAB - every named compliance rule, and exactly how many
   times it fired in this run, with clickable examples.
   ====================================================================== */
function PolicyEngineTab({ results, onSelect }) {
  const stats = useMemo(() => computeRuleStats(results), [results]);
  const totalChecks = Object.values(stats).reduce((s, v) => s + v.evaluated, 0);

  return (
    <div className="space-y-4">
      

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {Object.entries(RULE_META).map(([code, meta]) => {
          const s = stats[code] || { evaluated: 0, fired: 0, examples: [] };
          const pct = s.evaluated ? (100 * s.fired / s.evaluated) : 0;
          return (
            <div key={code} className="bg-stone-900 border border-stone-800 rounded-xl p-4">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="font-mono text-xs font-bold text-stone-200">{humanize(code)}</span>
                <span className="text-xs font-mono text-amber-500">{s.fired} / {s.evaluated}</span>
              </div>
              <div className="text-stone-400 text-xs leading-relaxed mb-2.5">{meta.desc}</div>
              <div className="h-1.5 bg-stone-800 rounded-full overflow-hidden mb-3">
                <div className="h-full bg-amber-500 rounded-full" style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
              {s.examples.length > 0 && (
                <div className="space-y-1.5">
                  {s.examples.map((ex, i) => (
                    <div key={i} onClick={() => onSelect(ex.result)} className="text-xs text-stone-400 hover:text-stone-300 cursor-pointer flex items-start gap-1.5 transition">
                      <ChevronRight size={12} className="shrink-0 mt-0.5" />
                      <span><span className="font-mono text-stone-400">{ex.result.event.id}</span> &middot; {ex.detail}</span>
                    </div>
                  ))}
                </div>
              )}
              {s.examples.length === 0 && <div className="text-xs text-stone-700 italic">Didn&rsquo;t fire in this batch.</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ======================================================================
   POLICY LAB TAB - the "cost of compliance" counterfactual, live in the
   browser. Mirrors compare_policies.py's findings exactly: quiet hours
   and the rate limit both cost ~nothing measurable (the recovery model
   is bucketed by day/attempt-number, not hour-of-day); attempt caps are
   the one rule that isn't free. Only pacing rules are configurable here
   - see DEFAULT_POLICY_CONFIG's comment for why eligibility rules
   (fraud, opt-out, dispute/hardship) deliberately have no toggle
   anywhere in this codebase, not just in this tab.
   ====================================================================== */
function runPolicySeeds(config, n, seeds) {
  const totals = { atRisk: 0, recovered: 0, escalated: 0, cost: 0, escalationCost: 0 };
  for (let seed = 1; seed <= seeds; seed++) {
    const events = generateBatch(seed, n);
    for (const r of runBatch(events, seed, config)) {
      totals.atRisk += r.event.amount;
      totals.recovered += r.amountRecovered;
      totals.cost += r.totalCost;
      totals.escalationCost += r.escalationCost;
      if (r.status === "escalated_human") totals.escalated++;
    }
  }
  return totals;
}

function PolicyLabTab() {
  const [rule, setRule] = useState("quiet_hours");
  const [cap, setCap] = useState(3);
  const [extraAttempts, setExtraAttempts] = useState(2);
  const [seeds, setSeeds] = useState(10);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  const runComparison = useCallback(() => {
    setRunning(true);
    setTimeout(() => {
      const baseline = DEFAULT_POLICY_CONFIG;
      let variant, labelA, labelB;
      if (rule === "quiet_hours") {
        variant = { ...baseline, enforceQuietHours: false };
        labelA = "Quiet hours ON"; labelB = "Quiet hours OFF";
      } else if (rule === "rate_limit") {
        variant = { ...baseline, maxMessagesPerHour: cap };
        labelA = `Cap = ${baseline.maxMessagesPerHour}/hr`; labelB = `Cap = ${cap}/hr`;
      } else {
        const bumped = {};
        for (const k of Object.keys(baseline.maxAttempts)) bumped[k] = baseline.maxAttempts[k] + extraAttempts;
        variant = { ...baseline, maxAttempts: bumped };
        labelA = "Standard caps"; labelB = `+${extraAttempts} attempts`;
      }
      const a = runPolicySeeds(baseline, 200, seeds);
      const b = runPolicySeeds(variant, 200, seeds);
      setResult({ labelA, labelB, a, b });
      setRunning(false);
    }, 30);
  }, [rule, cap, extraAttempts, seeds]);

  const segCls = (active) => `px-3 py-1.5 rounded-lg text-xs font-mono transition ${active ? "bg-amber-500 text-stone-950 font-semibold" : "bg-stone-900 text-stone-400 border border-stone-800 hover:border-stone-600"}`;

  const Row = ({ label, a, b, fmt = (v) => v, deltaFmt }) => {
    const delta = b - a;
    return (
      <div className="grid grid-cols-4 gap-2 py-2 border-b border-stone-800/60 last:border-0 text-sm">
        <div className="text-stone-400">{label}</div>
        <div className="text-right font-mono text-stone-300">{fmt(a)}</div>
        <div className="text-right font-mono text-stone-300">{fmt(b)}</div>
        <div className={`text-right font-mono ${delta > 0 ? "text-emerald-400" : delta < 0 ? "text-rose-400" : "text-stone-400"}`}>
          {delta === 0 ? "\u2014" : (deltaFmt ? deltaFmt(delta) : `${delta > 0 ? "+" : ""}${fmt(delta)}`)}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      

      <div className="bg-stone-900 border border-stone-800 rounded-xl p-4 sm:p-5">
        <div className="flex flex-wrap gap-2 mb-4">
          <button className={segCls(rule === "quiet_hours")} onClick={() => setRule("quiet_hours")}>Quiet hours</button>
          <button className={segCls(rule === "rate_limit")} onClick={() => setRule("rate_limit")}>Batch rate limit</button>
          <button className={segCls(rule === "attempt_cap")} onClick={() => setRule("attempt_cap")}>Attempt caps</button>
        </div>

        <div className="flex flex-wrap items-end gap-4 mb-4">
          {rule === "rate_limit" && (
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-widest text-stone-400 mb-1">Tightened cap (msgs/hr)</label>
              <input type="number" min="1" value={cap} onChange={(e) => setCap(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-24 bg-stone-950 border border-stone-700 rounded-lg px-2.5 py-1.5 text-sm text-stone-200 font-mono focus:outline-none focus:border-amber-500" />
            </div>
          )}
          {rule === "attempt_cap" && (
            <div>
              <label className="block font-mono text-[10px] uppercase tracking-widest text-stone-400 mb-1">Extra attempts</label>
              <input type="number" min="1" max="10" value={extraAttempts} onChange={(e) => setExtraAttempts(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-24 bg-stone-950 border border-stone-700 rounded-lg px-2.5 py-1.5 text-sm text-stone-200 font-mono focus:outline-none focus:border-amber-500" />
            </div>
          )}
          <div>
            <label className="block font-mono text-[10px] uppercase tracking-widest text-stone-400 mb-1">Seeds to average</label>
            <select value={seeds} onChange={(e) => setSeeds(parseInt(e.target.value))}
              className="bg-stone-950 border border-stone-700 rounded-lg px-2.5 py-1.5 text-sm text-stone-200 font-mono focus:outline-none focus:border-amber-500">
              {[5, 10, 20].map((n) => <option key={n} value={n}>{n} seeds</option>)}
            </select>
          </div>
          <button onClick={runComparison} disabled={running}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-stone-950 text-sm font-semibold transition disabled:opacity-60">
            {running ? <Loader2 size={15} className="animate-spin" /> : <FlaskConical size={15} />}
            {running ? "Running..." : "Run comparison"}
          </button>
        </div>

        {result && (
          <div>
            <div className="grid grid-cols-4 gap-2 pb-2 border-b border-stone-700 text-[10px] font-mono uppercase tracking-widest text-stone-400">
              <div></div>
              <div className="text-right">{result.labelA}</div>
              <div className="text-right">{result.labelB}</div>
              <div className="text-right">Delta</div>
            </div>
            <Row label="Recovered value" a={result.a.recovered} b={result.b.recovered} fmt={inr} deltaFmt={(d) => `${d > 0 ? "+" : ""}${inr(d)}`} />
            <Row label="Recovery rate" a={100 * result.a.recovered / result.a.atRisk} b={100 * result.b.recovered / result.b.atRisk}
              fmt={(v) => `${v.toFixed(2)}%`} deltaFmt={(d) => `${d > 0 ? "+" : ""}${d.toFixed(2)}pp`} />
            <Row label="Escalated to human" a={result.a.escalated} b={result.b.escalated} />
            <Row label="Total cost (incl. escalation)" a={result.a.cost} b={result.b.cost} fmt={inr} deltaFmt={(d) => `${d > 0 ? "+" : ""}${inr(d)}`} />
          </div>
        )}
      </div>

      <div className="bg-stone-900 border border-stone-800 rounded-xl p-4 sm:p-5">
        <Eyebrow>What running this actually found (20-seed averages, documented in BENCHMARKS.md)</Eyebrow>
        <div className="mt-3 space-y-2.5 text-sm text-stone-400 leading-relaxed">
          <div><span className="text-stone-200 font-semibold">Quiet hours cost ~nothing</span> — recovered value differs by ~0.003% with enforcement on vs. off.</div>
          <div><span className="text-stone-200 font-semibold">The rate limit also costs ~nothing</span> at any tested cap down to 3/hour — it demonstrably fires, it just redistributes <em>when</em> messages go out, which this recovery model doesn&rsquo;t price in.</div>
          <div><span className="text-stone-200 font-semibold">Attempt caps are the one rule that isn&rsquo;t free.</span> +2 attempts per category recovered 4.4pp more <em>and</em> lowered total cost (fewer expensive human escalations). Caveat: for payment failures specifically, 4 attempts is NPCI&rsquo;s actual UPI Autopay ceiling, not just a business choice — extending it isn&rsquo;t free to change for that category the way it is for checkout and receivables.</div>
        </div>
      </div>
    </div>
  );
}

/* ======================================================================
   AI JUDGMENT LAB - real Gemini calls, three distinct judgment moments.
   ====================================================================== */
function LabCard({ icon: Icon, title, blurb, children }) {
  return (
    <div className="bg-stone-900 border border-stone-800 rounded-xl p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-1.5"><Icon size={16} className="text-amber-500" /><h3 className="font-bold text-stone-100 text-sm">{title}</h3></div>
      <p className="text-xs text-stone-400 mb-4 leading-relaxed">{blurb}</p>
      {children}
    </div>
  );
}
function ResultBox({ state }) {
  if (!state) return null;
  if (state.loading) return <div className="flex items-center gap-2 text-stone-400 text-xs mt-3"><Loader2 size={14} className="animate-spin" /> Calling Gemini...</div>;
  if (state.error) return <div className="flex items-start gap-2 text-rose-400 text-xs mt-3 bg-rose-500/10 rounded-lg p-2.5"><AlertTriangle size={14} className="shrink-0 mt-0.5" /><span>{state.error}</span></div>;
  if (state.data) return <div className="mt-3 bg-stone-950 border border-stone-800 rounded-lg p-3 text-xs text-stone-300 font-mono whitespace-pre-wrap leading-relaxed">{state.data}</div>;
  return null;
}

function GeminiKeyPanel({ apiKey, setApiKey, model, setModel }) {
  const [showKey, setShowKey] = useState(false);
  const hasKey = apiKey.trim().length > 0;
  return (
    <div className="bg-stone-900 border border-stone-800 rounded-xl p-4 sm:p-5">
      <div className="flex items-center gap-2 mb-1.5"><KeyRound size={16} className="text-amber-500" /><h3 className="font-bold text-stone-100 text-sm">Connect your Gemini API key</h3></div>
      <p className="text-xs text-stone-400 mb-3 leading-relaxed">
        The three cards below call the real Gemini API directly from your browser - bring your own key. It&rsquo;s kept only in this
        page&rsquo;s memory for this session, used solely for these calls, and never sent anywhere but Google&rsquo;s endpoint. Get a free one at{" "}
        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-amber-500 hover:underline inline-flex items-center gap-0.5">Google AI Studio<ExternalLink size={10} /></a>.
      </p>
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 basis-64">
          <input type={showKey ? "text" : "password"} value={apiKey} onChange={(e) => setApiKey(e.target.value)}
            placeholder="AIza..." spellCheck={false}
            className="w-full bg-stone-950 border border-stone-700 rounded-lg pl-3 pr-14 py-2 text-sm text-stone-200 font-mono focus:outline-none focus:border-amber-500" />
          <button onClick={() => setShowKey((s) => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono text-stone-400 hover:text-stone-400">{showKey ? "HIDE" : "SHOW"}</button>
        </div>
        <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={GEMINI_DEFAULT_MODEL} spellCheck={false}
          className="w-44 bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 font-mono focus:outline-none focus:border-amber-500" />
      </div>
      <div className={`text-[11px] mt-2 flex items-center gap-1 ${hasKey ? "text-emerald-400" : "text-stone-400"}`}>
        {hasKey ? <CheckCircle2 size={11} /> : <Info size={11} />}
        {hasKey ? "Key set - the cards below are ready to call Gemini." : "No key yet - the cards below will prompt for one when clicked."}
      </div>
    </div>
  );
}

function AIJudgmentLab({ results: batchResults = null }: { results?: any[] | null }) {
  const [model, setModel] = useState(GEMINI_DEFAULT_MODEL);
  const [results, setResults] = useState<any>({});

  const run = useCallback(async (id: string, system: string, user: string, maxTokens: number, formatter?: (r: string) => string) => {
    setResults((p: any) => ({ ...p, [id]: { loading: true } }));
    try {
      const raw = await callGemini(model.trim() || GEMINI_DEFAULT_MODEL, system, user, maxTokens);
      setResults((p: any) => ({ ...p, [id]: { data: formatter ? formatter(raw) : raw } }));
    } catch (e: any) {
      setResults((p: any) => ({ ...p, [id]: { error: e.message || "Request failed." } }));
    }
  }, [model]);

  const formatJSON = (raw: string) => {
    try {
      const parsed = JSON.parse(stripFences(raw));
      return Object.entries(parsed).map(([k, v]) => {
        const key = humanize(k);
        const val = typeof v === "number" ? (k === "confidence" ? `${(v * 100).toFixed(0)}%` : v) : (typeof v === "string" ? humanize(v) : String(v));
        return `${key}: ${val}`;
      }).join("\n");
    } catch { return raw; }
  };

  const cases = batchResults || [];

  // Scenario A - diagnose an ambiguous repeated decline
  const promptA = useMemo(() => {
    let match = cases.find(c => c.event.category === "payment_failure" && c.attempts.some((a: any) => a.diagnosis?.method === "llm_fallback_heuristic"));
    if (!match) {
      match = cases.find(c => c.event.category === "payment_failure" && c.event.signal?.declineCode === "do_not_honor" && c.attempts.length >= 2);
    }
    if (match) {
      const tenure = match.event.signal?.customerTenureMonths || 0;
      const amount = match.event.amount;
      const attempts = match.attempts.length;
      const gateway = match.event.signal?.gateway || "Razorpay";
      const code = match.event.signal?.declineCode || "do_not_honor";
      return {
         text: `Customer tenure: ${tenure} months. Plan amount: INR ${amount.toFixed(0)}. Decline code: ${code}, repeated across ${attempts} attempts. Gateway: ${gateway}.`,
         id: match.event.id
      };
    }
    return {
      text: "Customer tenure: 14 months. Plan amount: INR 2999. Decline code: do_not_honor, repeated across 3 attempts. Gateway: Razorpay.",
      id: null
    };
  }, [cases]);

  const runA = () => run("a",
    'You are a payments risk analyst. Given a repeating ambiguous card decline pattern, decide whether to keep retrying automatically, ask the customer to update their card, or escalate to a human. Respond ONLY with JSON, no other text, no markdown fences: {"root_cause": str, "confidence": float 0-1, "rationale": str (<=30 words), "recommended_action": "retry_payment"|"request_card_update"|"escalate_human", "never_retry": bool, "needs_human": bool}',
    promptA.text,
    400, formatJSON);

  // Scenario B - classify a B2B reply
  const promptB = useMemo(() => {
    const match = cases.find(c => c.event.category === "receivable_overdue" && c.event.signal?.customerReplyText);
    if (match) {
      return {
        text: match.event.signal.customerReplyText,
        id: match.event.id
      };
    }
    return {
      text: "Facing a temporary cash crunch, can we get 15 more days? We've always paid on time before.",
      id: null
    };
  }, [cases]);

  const runB = () => run("b",
    'Classify a B2B accounts-receivable customer reply. Respond ONLY with JSON, no other text, no markdown fences: {"intent": "promise_to_pay"|"dispute"|"hardship"|"other", "confidence": float 0-1, "rationale": str (<=25 words), "promised_date_hint": str or null}',
    promptB.text,
    300, formatJSON);

  // Scenario C - draft a message, with live controls
  const [tone, setTone] = useState(2);
  const [locale, setLocale] = useState("en");
  const [cat, setCat] = useState("receivable_overdue");
  
  const promptC = useMemo(() => {
    const match = cases.find(c => c.event.category === cat);
    if (match) {
      const e = match.event;
      let detail = "";
      let reason = "";
      if (cat === "payment_failure") {
        detail = e.signal?.subscriptionPlan || "subscription";
        reason = (e.signal?.declineCode || "failed").replace(/_/g, " ");
      } else if (cat === "checkout_abandonment") {
        detail = `${e.signal?.cartItemCount || 1} items`;
        reason = `cart abandoned at ${e.signal?.dropoffStage || "checkout"}`;
      } else {
        detail = `${e.signal?.daysOverdue || 30} days overdue`;
        reason = `${e.signal?.agingStage || "standard"} follow-up`;
      }
      return {
        name: e.customerName,
        amount: e.amount,
        detail,
        reason,
        id: e.id
      };
    }
    const sampleByCat: any = {
      payment_failure: { name: "Arjun", amount: 2999, detail: "your Pro plan", reason: "insufficient funds" },
      checkout_abandonment: { name: "Meera", amount: 4200, detail: "3 items", reason: "cart abandoned at payment details" },
      receivable_overdue: { name: "Kestrel Foods", amount: 185000, detail: "45 days overdue", reason: "firm-stage follow-up" },
    };
    return { ...sampleByCat[cat], id: null };
  }, [cases, cat]);

  const runC = () => {
    run("c",
      "Write a short (<=45 words), respectful revenue-recovery outreach message for a customer. Never sound threatening, always offer help. Match the requested tone tier and language. Respond with the message text only - no preamble, no quotes, no markdown.",
      `Category: ${cat}. Customer: ${promptC.name}. Amount: INR ${promptC.amount}. Detail: ${promptC.detail}. Reason: ${promptC.reason}. Tone tier (1=friendly nudge, 4=final notice before human handoff): ${tone}. Language: ${locale === "hi-en" ? "Hinglish (Roman script, casual code-mixed Hindi/English)" : "English"}.`,
      150);
  };

  const btnCls = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-stone-950 text-xs font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed";
  const segCls = (active) => `px-2.5 py-1 rounded-md text-xs font-mono transition ${active ? "bg-stone-700 text-stone-100" : "text-stone-400 hover:text-stone-300"}`;

  return (
    <div className="space-y-4">
      

      

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <LabCard icon={Sparkles} title="Diagnose an ambiguous decline" blurb="A subscription payment keeps failing with a decline code that gives no detail. Worth more patience, or a human look?">
          <div className="text-[11px] text-stone-500 mb-3">{promptA.id ? `Using live case ${promptA.id} from your last batch` : "Using example data — no matching case in your last batch"}</div>
          <button className={btnCls} onClick={runA} disabled={results.a?.loading}><Play size={12} /> Diagnose with Gemini</button>
          <ResultBox state={results.a} />
        </LabCard>

        <LabCard icon={MessageSquare} title="Classify a customer reply" blurb="A finance manager replied to an overdue-invoice email. Promise to pay, dispute, or hardship - each routes differently.">
          <div className="text-[11px] text-stone-500 mb-2">{promptB.id ? `Using live case ${promptB.id} from your last batch` : "Using example data — no matching case in your last batch"}</div>
          <div className="text-xs text-stone-400 italic bg-stone-950 border border-stone-800 rounded-lg p-2.5 mb-3">&ldquo;{promptB.text}&rdquo;</div>
          <button className={btnCls} onClick={runB} disabled={results.b?.loading}><Play size={12} /> Classify with Gemini</button>
          <ResultBox state={results.b} />
        </LabCard>

        <LabCard icon={CreditCard} title="Draft the outreach message" blurb="Pick a category, tone, and language - Gemini writes the actual copy that would go out.">
          <div className="text-[11px] text-stone-500 mb-3">{promptC.id ? `Using live case ${promptC.id} from your last batch` : "Using example data — no matching case in your last batch"}</div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {Object.entries(CATEGORY_LABEL).map(([k, v]) => <button key={k} className={segCls(cat === k)} onClick={() => setCat(k)}>{v}</button>)}
          </div>
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-stone-400 font-mono mr-1">tone</span>
              {[1, 2, 3, 4].map((t) => <button key={t} className={segCls(tone === t)} onClick={() => setTone(t)}>{t}</button>)}
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-stone-400 font-mono mr-1">lang</span>
              <button className={segCls(locale === "en")} onClick={() => setLocale("en")}>English</button>
              <button className={segCls(locale === "hi-en")} onClick={() => setLocale("hi-en")}>Hinglish</button>
            </div>
          </div>
          <button className={btnCls} onClick={runC} disabled={results.c?.loading}><Play size={12} /> Draft with Gemini</button>
          <ResultBox state={results.c} />
        </LabCard>
      </div>
    </div>
  );
}

/* ======================================================================
   APP
   ====================================================================== */
export function Dashboard({ onExit }: { onExit?: () => void }) {
  const [seed, setSeed] = useState(42);
  const [batchSize, setBatchSize] = useState(90);
  const [results, setResults] = useState(null);
  const [running, setRunning] = useState(false);
  const [tab, setTab] = useState("dashboard");
  const [selected, setSelected] = useState(null);
  // "browser" = JS engine in-browser (default); "server" = Python engine via /api/batch
  const [engine, setEngine] = useState<"browser" | "server">("browser");
  const [engineLabel, setEngineLabel] = useState<string | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);

  const runNow = useCallback(async () => {
    setRunning(true);
    setEngineError(null);
    if (engine === "server") {
      try {
        const res = await fetch("/api/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seed, n: batchSize }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error || `Server responded ${res.status}`);
        }
        const data = await res.json();
        // Rehydrate date strings → Date objects so the rest of the UI works unchanged
        const rehydrated = data.results.map((r: any) => ({
          ...r,
          event: {
            ...r.event,
            createdAt: new Date(r.event.createdAt),
          },
          attempts: r.attempts.map((a: any) => ({
            ...a,
            decision: {
              ...a.decision,
              scheduledAt: a.decision.scheduledAt ? new Date(a.decision.scheduledAt) : null,
            },
            execution: {
              ...a.execution,
              executedAt: a.execution.executedAt ? new Date(a.execution.executedAt) : null,
            },
          })),
        }));
        setResults(rehydrated);
        setEngineLabel(`${rehydrated.length} cases processed via Python engine.`);
      } catch (e: any) {
        setEngineError(e.message || "Failed to reach Python API");
        // Fallback: run browser engine so the user still gets results
        setTimeout(() => {
          const events = generateBatch(seed, batchSize);
          setResults(runBatch(events, seed));
        }, 50);
      } finally {
        setRunning(false);
      }
    } else {
      setTimeout(() => {
        const events = generateBatch(seed, batchSize);
        setResults(runBatch(events, seed));
        setEngineLabel(null);
        setRunning(false);
      }, 250);
    }
  }, [seed, batchSize, engine]);

  useEffect(() => { runNow(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const tabs = [
    { id: "dashboard", label: "Dashboard" },
    { id: "cases", label: "Cases" },
    { id: "escalations", label: "Escalation Queue" },
    { id: "policy", label: "Policy Engine" },
    { id: "policylab", label: "Policy Lab" },
    { id: "lab", label: "AI Judgment Lab" },
  ];
  const TAB_ICON = { escalations: UserCheck, policy: ListChecks, policylab: FlaskConical, lab: Sparkles };

  return (
    <div className="min-h-screen bg-[#111111] text-stone-300">
      {onExit && (
        <nav className="h-16 px-6 lg:px-12 flex items-center justify-between border-b border-stone-800 bg-[#161616]">
           <button onClick={onExit} className="text-sm font-medium text-stone-400 hover:text-stone-300 transition flex items-center gap-2">
             &larr; Back to Site
           </button>
           <RecoupLogo className="text-xl" theme="dark" />
        </nav>
      )}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <Eyebrow>Track 03 &middot; Working prototype</Eyebrow>
        <h1 className="text-3xl sm:text-5xl font-normal tracking-tight text-stone-50 mt-2 leading-[1.05]">
          Find revenue that&rsquo;s slipping away<span className="text-orange-400">.</span> Prove you won it back<span className="text-orange-400">.</span>
        </h1>
        <p className="text-stone-400 mt-4 max-w-2xl text-sm sm:text-base leading-relaxed">
          Detect &rarr; diagnose &rarr; decide &rarr; act &rarr; audit, across payment failures, checkout abandonment,
          and overdue receivables. Rules run the compliance-critical parts; Gemini runs the judgment calls. Every
          decision below is real output from the logic actually running in your browser, not a mockup.
        </p>

        <div className="flex flex-wrap items-end gap-4 mt-8 bg-stone-900 border border-stone-800 p-5">
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-stone-400 mb-2">Seed</label>
            <input type="number" value={seed} onChange={(e) => setSeed(parseInt(e.target.value) || 0)}
              className="w-24 bg-stone-900 border border-stone-700 px-3 py-2 text-sm text-stone-100 focus:outline-none focus:border-amber-500" />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-stone-400 mb-2">Batch size</label>
            <select value={batchSize} onChange={(e) => setBatchSize(parseInt(e.target.value))}
              className="bg-stone-900 border border-stone-700 px-3 py-2 text-sm text-stone-100 focus:outline-none focus:border-amber-500">
              {[30, 60, 90, 150].map((n) => <option key={n} value={n}>{n} events</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-stone-400 mb-2">Engine</label>
            <div className="flex border border-stone-700 overflow-hidden">
              <button onClick={() => setEngine("browser")}
                className={`px-3 py-2 text-[10px] uppercase tracking-widest transition ${engine === "browser" ? "bg-stone-100 text-stone-900" : "bg-stone-900 text-stone-400 hover:text-stone-300"}`}>
                Browser
              </button>
              <button onClick={() => setEngine("server")}
                className={`px-3 py-2 text-[10px] uppercase tracking-widest transition ${engine === "server" ? "bg-amber-500 text-stone-950 font-semibold" : "bg-stone-900 text-stone-400 hover:text-stone-300"}`}>
                Python
              </button>
            </div>
          </div>
          <button onClick={runNow} disabled={running}
            className="inline-flex items-center gap-2 px-5 py-2 h-[38px] bg-stone-100 hover:bg-amber-500 text-stone-900 hover:text-white text-[10px] uppercase tracking-widest transition disabled:opacity-60">
            {running ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {running ? "Running batch..." : "Run batch"}
          </button>
          {results && !running && (
            <span className="text-xs text-stone-400 font-mono">
              {engineLabel || `${results.length} cases processed in browser.`}
            </span>
          )}
          {engineError && (
            <div className="w-full flex items-center gap-2 text-xs text-rose-400 bg-rose-500/10 rounded px-3 py-1.5">
              <AlertTriangle size={12} className="shrink-0" />
              {engineError} — showing browser results as fallback.
            </div>
          )}
          {results && !running && (
            <div className="flex flex-wrap gap-4 ml-auto">
              <button onClick={() => downloadAuditJSON(results)} className="inline-flex items-center gap-1.5 text-xs text-stone-400 hover:text-amber-400 transition font-mono"><Download size={12} /> audit_log.json</button>
              <button onClick={() => downloadCasesCSV(results)} className="inline-flex items-center gap-1.5 text-xs text-stone-400 hover:text-amber-400 transition font-mono"><Download size={12} /> cases.csv</button>
            </div>
          )}
        </div>

        <div className="flex gap-1 mt-6 border-b border-stone-800 overflow-x-auto">
          {tabs.map((t) => {
            const TabIcon = TAB_ICON[t.id];
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-3.5 py-2.5 text-sm font-medium transition border-b-2 -mb-px flex items-center gap-1.5 whitespace-nowrap ${tab === t.id ? "border-amber-500 text-stone-100" : "border-transparent text-stone-400 hover:text-stone-300"}`}>
                {TabIcon && <TabIcon size={13} />}
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="mt-6 relative">
          <AnimatePresence mode="wait">
            {!results && (
              <motion.div key="loading" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                <div className="text-center py-16 text-stone-400 text-sm">Generating batch...</div>
              </motion.div>
            )}
            {results && tab === "dashboard" && (
              <motion.div key="dashboard" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                <DashboardTab results={results} />
              </motion.div>
            )}
            {results && tab === "cases" && (
              <motion.div key="cases" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                <CasesTab results={results} onSelect={setSelected} />
              </motion.div>
            )}
            {results && tab === "escalations" && (
              <motion.div key="escalations" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                <EscalationQueueTab results={results} onSelect={setSelected} />
              </motion.div>
            )}
            {results && tab === "policy" && (
              <motion.div key="policy" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                <PolicyEngineTab results={results} onSelect={setSelected} />
              </motion.div>
            )}
            {tab === "policylab" && (
              <motion.div key="policylab" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                <PolicyLabTab />
              </motion.div>
            )}
            {tab === "lab" && (
              <motion.div key="lab" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
                <AIJudgmentLab results={results} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="mt-10 pt-6 border-t border-stone-800 text-xs text-stone-400 leading-relaxed flex items-start gap-2">
          <ChevronRight size={14} className="shrink-0 mt-0.5" />
          <span>This dashboard is an independent client-side reimplementation of the Python reference engine (same categories, same policy constants, same pipeline shape) so it can run entirely in-browser. Success-rate figures are illustrative, not measured from real data. Time is a simulated clock, not wall-clock time.</span>
        </div>
      </div>

      <CaseDetailModal result={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function RecoupLogo({ className = "", theme = "dark" }: { className?: string; theme?: "light" | "dark" }) {
  const topColor = theme === "dark" ? "from-white" : "from-[#111111]";
  return (
    <div className={`flex font-black tracking-wider ${className}`}>
      <span className="text-[#2E7976]">RE</span>
      <span className={`bg-gradient-to-b ${topColor} from-50% to-[#2E7976] to-50% text-transparent bg-clip-text`}>C</span>
      <span className="text-[#007CA3]">O</span>
      <span className="text-[#0072B0]">UP</span>
    </div>
  );
}

function LandingPage({ onLaunch }: { onLaunch: () => void }) {
  return (
    <div className="min-h-screen bg-white text-[#111111] font-sans">
       <nav className="absolute top-0 w-full z-20 px-8 py-6 flex items-center justify-between">
          <RecoupLogo className="text-2xl" theme="light" />
       </nav>
       
       {/* Hero section */}
       <section className="relative w-full h-[85vh] min-h-[600px] overflow-hidden bg-gray-100 flex flex-col justify-center">
          <div className="absolute inset-0" style={{ backgroundImage: `url(${heroBeachImg})`, backgroundSize: 'cover', backgroundPosition: 'center' }}></div>
          <div className="absolute inset-0 bg-gradient-to-r from-white/90 via-white/50 to-transparent"></div>
          
          <div className="relative z-10 px-8 lg:px-24 max-w-4xl mt-12">
            <h1 className="text-6xl lg:text-8xl font-medium tracking-tight leading-[1.05] mb-6 text-black">Recover<br/>Lost Revenue.</h1>
            <p className="text-xl lg:text-2xl text-gray-800 max-w-xl mb-10 leading-relaxed font-medium">An AI-powered payment continuity engine. Detect payment failures, diagnose checkout abandonment, and recover overdue B2B receivables while AI runs the judgment calls.</p>
            <button onClick={onLaunch} className="bg-[#111111] text-white rounded-full px-6 py-3 flex items-center gap-3 font-medium hover:bg-gray-800 transition w-max text-sm shadow-lg">
              Go to Dashboard <span className="bg-white text-black rounded-full p-1 flex items-center justify-center"><ArrowRight size={14} strokeWidth={3} /></span>
            </button>
          </div>
          

       </section>
       
       {/* Intro section */}
       <section className="px-8 lg:px-24 py-24 flex flex-col md:flex-row gap-12 lg:gap-24 items-start bg-white">
          <div className="w-full md:w-1/2 flex flex-col items-start">
            <h2 className="text-4xl lg:text-5xl tracking-tight leading-tight mb-8 font-medium text-black">Meet Recoup.</h2>
          </div>
          <div className="w-full md:w-1/2">
            <p className="text-2xl lg:text-3xl leading-relaxed text-gray-600">Recoup is a deterministic engine that reclaims failed payments and checkout abandonments while remaining fully compliant with your local mandates. It works by detecting revenue at risk, diagnosing why, deciding the right intervention, and executing it. Every action produces a complete, replayable audit trail for every rupee.</p>
          </div>
       </section>

       {/* Bento section */}
       <section className="px-8 lg:px-24 py-12 bg-white">
         <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-[#F3EFFF] rounded-[2rem] p-10 lg:p-12 flex flex-col relative overflow-hidden">
               <div className="relative z-10">
                 <h3 className="text-3xl lg:text-4xl tracking-tight mb-4 text-black font-medium">Diagnose & Decide</h3>
                 <p className="text-gray-600 font-sans text-base lg:text-lg leading-relaxed">Agentic AI routes cases into top-performing recovery strategies. Gemini steps in when judgment is needed—analyzing unstructured decline patterns and drafting outreach copy.</p>
               </div>
            </div>
            <div className="bg-[#F3EFFF] rounded-[2rem] p-10 lg:p-12 flex flex-col relative overflow-hidden">
               <div className="relative z-10">
                 <h3 className="text-3xl lg:text-4xl tracking-tight mb-4 text-black font-medium">Complete Audit Trail</h3>
                 <p className="text-gray-600 font-sans text-base lg:text-lg leading-relaxed">Every decision produces a complete, replayable JSON trace. Absolute transparency for your financial operations, guaranteeing every rupee is accounted for.</p>
               </div>
            </div>
            <div className="bg-[#221936] rounded-[2rem] p-10 lg:p-12 flex flex-col shadow-xl">
                 <h3 className="text-3xl lg:text-4xl tracking-tight text-white font-medium mb-4">Strict compliance.</h3>
                 <p className="text-[#A19BB0] font-sans text-base lg:text-lg leading-relaxed mt-auto">Quiet hours, attempt caps, and RBI e-mandate thresholds are strictly enforced by deterministic rules, never left to AI hallucination.</p>
            </div>
            <div className="bg-[#221936] rounded-[2rem] p-10 lg:p-12 flex flex-col shadow-xl">
                 <h3 className="text-3xl lg:text-4xl tracking-tight text-white font-medium mb-4">Smart escalation.</h3>
                 <p className="text-[#A19BB0] font-sans text-base lg:text-lg leading-relaxed mt-auto">When the reply-intent classifier flags a dispute or hardship, automation stops and the case is hard-routed to a human.</p>
            </div>
         </div>
       </section>



       {/* Use Modes */}
       <section className="px-8 lg:px-24 py-24 flex flex-col md:flex-row gap-12 lg:gap-24 bg-[#F9F9F9]">
          <div className="w-full md:w-1/3">
            <div className="text-sm font-medium text-gray-500 mb-4">Recovery in Practice</div>
            <h2 className="text-4xl lg:text-6xl tracking-tight leading-tight mb-8 text-black font-medium">Core Workflows</h2>
            <p className="text-gray-600 font-sans text-lg leading-relaxed">Recoup powers automated workflows for builders and financial teams wanting safe and reliable payment continuity.</p>
          </div>
          <div className="w-full md:w-2/3 bg-white rounded-[2rem] p-10 lg:p-14 flex flex-col md:flex-row gap-12 items-center shadow-sm">
            <div className="flex-1">
               <h3 className="text-2xl tracking-tight mb-3 text-black font-medium">Payment Failures</h3>
               <p className="text-gray-600 font-sans text-sm leading-relaxed mb-8">Smart retry timing, card-update requests, or fresh-authentication routing for large mandates.</p>
               
               <h3 className="text-2xl tracking-tight mb-3 text-black font-medium">Checkout Abandonment</h3>
               <p className="text-gray-600 font-sans text-sm leading-relaxed mb-8">Reminders tiered by drop-off stage and cart value, with incentives only where economically justified.</p>

               <h3 className="text-2xl tracking-tight mb-3 text-black font-medium">B2B Receivables</h3>
               <p className="text-gray-600 font-sans text-sm leading-relaxed">Escalating dunning ladders with a promise-to-pay tracker and hardship detection.</p>
            </div>
            <div className="flex-1 w-full h-[300px] rounded-[2rem] bg-[#F3EFFF] overflow-hidden shadow-inner relative hidden md:block">
               <div className="absolute inset-0 mix-blend-multiply" style={{ backgroundImage: `url(${purpleBankImg})`, backgroundSize: 'cover', backgroundPosition: 'center' }}></div>
            </div>
          </div>
       </section>

       {/* Footer */}
       <footer className="bg-[#221936] text-white pt-20 px-8 lg:px-24 pb-12">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-20 gap-8">
            <div className="max-w-sm">
               <div className="flex items-center gap-3 mb-6">
                 <RecoupLogo className="text-3xl" theme="dark" />
               </div>
               <p className="text-sm font-sans leading-relaxed text-[#A19BB0]">An AI-powered payment continuity engine, built to recover revenue and let your business grow.</p>
            </div>
            <button onClick={onLaunch} className="bg-white text-[#221936] rounded-full px-6 py-3 flex items-center gap-3 font-medium hover:bg-gray-200 transition text-sm shadow-lg">
              Open Dashboard <span className="bg-[#221936] text-white rounded-full p-1 flex items-center justify-center"><ArrowRight size={14} strokeWidth={3}/></span>
            </button>
          </div>
          
          <div className="flex flex-col md:flex-row justify-between items-center pt-8 text-xs text-[#A19BB0] border-t border-white/10">
            <p>© 2026 Recoup. All rights reserved.</p>
            <p className="mt-4 md:mt-0">Recoup is an automated software platform, not a financial institution.</p>
          </div>
       </footer>
    </div>
  );
}

function AuthPage({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setTimeout(() => {
      onLogin();
    }, 1500);
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.4 }}
      className="min-h-screen flex items-center justify-center bg-[#111111] text-stone-300 font-sans"
    >
      <div className="bg-[#1a1a1a] p-10 rounded-2xl border border-stone-800 shadow-2xl w-full max-w-md">
        <div className="flex justify-center mb-10">
          <RecoupLogo className="text-4xl" theme="dark" />
        </div>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-stone-400 mb-2">Work Email</label>
            <input 
              type="email" 
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full bg-[#111111] border border-stone-700 px-4 py-3 rounded-lg text-stone-100 focus:outline-none focus:border-amber-500 transition" 
              placeholder="name@company.com" 
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-stone-400 mb-2">Password</label>
            <input 
              type="password" 
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full bg-[#111111] border border-stone-700 px-4 py-3 rounded-lg text-stone-100 focus:outline-none focus:border-amber-500 transition" 
              placeholder="••••••••" 
            />
          </div>
          <button 
            type="submit" 
            disabled={loading || !email || !password}
            className="w-full flex items-center justify-center gap-2 bg-stone-100 text-[#111111] text-sm font-medium py-3 rounded-lg hover:bg-amber-500 hover:text-white transition disabled:opacity-50 disabled:hover:bg-stone-100 disabled:hover:text-[#111111]"
          >
            {loading ? <Loader2 className="animate-spin" size={18} /> : "Sign in to Recoup"}
          </button>
        </form>
      </div>
    </motion.div>
  );
}

function SplashScreen({ onComplete }: { onComplete: () => void }) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onComplete();
    }, 2500);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.1 }}
      transition={{ duration: 0.8, ease: "easeInOut" }}
      className="min-h-screen flex items-center justify-center bg-[#111111]"
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 0.3, duration: 0.8, ease: "easeOut" }}
      >
        <RecoupLogo className="text-6xl" theme="dark" />
      </motion.div>
    </motion.div>
  );
}

export default function App() {
  const [view, setView] = useState<"landing" | "auth" | "splash" | "dashboard">("landing");
  
  return (
    <AnimatePresence mode="wait">
      {view === "landing" && (
        <motion.div key="landing" exit={{ opacity: 0, y: -20 }} transition={{ duration: 0.4 }}>
          <LandingPage onLaunch={() => setView("auth")} />
        </motion.div>
      )}
      {view === "auth" && (
        <AuthPage key="auth" onLogin={() => setView("splash")} />
      )}
      {view === "splash" && (
        <SplashScreen key="splash" onComplete={() => setView("dashboard")} />
      )}
      {view === "dashboard" && (
        <motion.div key="dashboard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }}>
          <Dashboard onExit={() => setView("landing")} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}