# Classroom Debate Module — Design

Status: **proposed** (design only; nothing implemented). Target: a structured,
attributed, AI-refereed in-class debate, run from the VTA dashboard, on the
existing Azure stack.

This document is grounded in a research + red-team pass (STT/speaker-ID vendors,
browser audio, Maryland/FERPA/biometric law, join-flow prior art, debate judging
literature, and a map of this repo). Where a vendor fact drives a decision it is
marked **[verify]** — confirm with a quote/doc before committing money.

---

## 1. TL;DR — what to build, and the three substitutions

The pedagogy is sound and ~70% of the concept drops cleanly onto this stack. But
three parts of the original flow do not survive contact with reality and are
replaced. Each substitution **preserves the professor's intent** while removing a
blocker.

| # | Original step | Problem | Substitution |
|---|---|---|---|
| 1 | Students **enroll a voiceprint** so the system can identify their voice | Dead end on 3 independent axes (see §3) | **Delete it.** Attribution comes from **floor control + device identity** — 100% deterministic, zero biometrics |
| 2 | **Recording starts automatically** for everyone | Illegal-by-default in Maryland (all-party consent), and browsers forbid it (mic needs a user gesture; iOS suspends background capture) | **Push-to-talk floor control**: a mic opens *only* while its owner holds the floor, and *only* after they press "Speak" (which is both the consent act and the required gesture) |
| 3 | VTA is a live **AI debater** interjecting in real time | An Opus-class rebuttal is 10–30 s; human turn-taking is sub-second | **Reserved AI speaking slot** in the running order, with diegetic "prep time". Judge runs **between rounds**, not per-turn |

Everything else — professor console, dynamic QR join, name + team, live
attributed transcript, AI judge, AI debater, results — is built as specified.

---

## 2. Architecture

```
   Professor console (vta-web)            Student phone (vta-web)
   ─ start/stop activity                  ─ scan QR → claim name + team
   ─ advance phase, grant floor            ─ consent gate
   ─ live transcript + timers              ─ "Speak" (push-to-talk) → mic opens
   ─ review/override AI judge              ─ live transcript + own-turn playback
            │                                        │
            │  POST (commands)          SSE (state)  │  POST (audio chunks)
            ▼                                        ▼
   ┌──────────────────────────────────────────────────────────┐
   │  vta-web (Next.js, Azure Container Apps, min=max=1)      │
   │   • /api/debate/**        route handlers (nodejs)        │
   │   • in-process fan-out hub  →  SSE to all clients        │
   │   • Postgres = source of truth (phase_seq optimistic CC) │
   └──────────────┬───────────────────────┬───────────────────┘
                  │                       │
        ┌─────────▼─────────┐   ┌─────────▼──────────┐
        │ STT vendor (new)  │   │ @vta/llm ModelRouter│
        │ streaming WS,     │   │ Opus 4.8 / Sonnet   │
        │ 1 stream at a time│   │ judge + AI debater  │
        └───────────────────┘   └────────────────────┘
                  │                       │
              ┌───▼───────────────────────▼───┐
              │ Postgres (existing, B1ms)     │
              │ debate_* tables               │
              └───────────────────────────────┘
```

Three deliverables: **(a)** schema + repository in `@vta/data`, **(b)** professor
console + join UI + API routes in `apps/web`, **(c)** a thin STT adapter package.
**No new service, no Redis, no WebSocket server** for the pilot (§7).

---

## 3. Why voiceprints are deleted (the most important decision)

Not a preference — three independent blockers:

1. **The service layer is gone.** Azure AI **Speaker Recognition was retired
   2025-09-30** (Speech SDK 1.47 lists its removal as a breaking change), and
   Amazon Connect Voice ID reaches end-of-support **2026-05-20** **[verify]**.
   *Independently confirmed:* Microsoft's `speaker-recognition-overview` doc page
   now redirects to the general Azure Speech overview, and Speaker Recognition no
   longer appears anywhere in that page's capability list (STT, TTS, TTS avatar,
   speech translation, LLM speech, language ID, pronunciation assessment).
   Both hyperscalers exited voice biometrics within ~8 months — a strong signal.
   Of surveyed streaming-STT vendors, **only Speechmatics** still offers
   enrollment-based speaker ID, capped at **50 speaker identifiers per session**
   — under a 60-student cohort. Everyone else (Deepgram, AssemblyAI, Soniox,
   Gladia, OpenAI, pyannoteAI) does **anonymous** diarization only: "Speaker 1/2",
   with no way to bind a cluster to a person.
2. **It's regulated biometric data.** A voiceprint bound to a graded activity is
   a biometric identifier *and* a FERPA education record. Maryland's **MODPA**
   (effective 2025-10-01, enforceable 2026-04-01) treats biometric data as
   **sensitive** regardless of use, with a *strict necessity* standard; Maryland
   **PIPA** names a "voice print" as personal information (breach-notification
   trigger); JHU enrolls students from **Illinois (BIPA)** and **Texas (CUBI)**
   whose statutes follow the resident **[verify with counsel]**. The reflexive
   trap: because a non-biometric design works, the biometric one fails MODPA's
   necessity test.
3. **It isn't even needed.** A debate is turn-based. The app already knows who
   holds the floor. Attribution from floor control is **100% correct by
   construction** — better than any voiceprint system, which in real classroom
   audio reports ~34% DER (and ~45% in all-speaker conditions).

> **If the professor still wants voice verification** ("nobody speaks for a
> teammate"), the compromise is **Picovoice Eagle on-device** (WASM, TypeScript):
> the template never leaves the phone; the phone returns only a similarity score.
> Phase 2, opt-in, never a join gate.

---

## 4. Data model (`packages/data/src/schema/debate.ts`)

Follows the existing Drizzle patterns; every table carries `course_id` (the
tenant unit). Students are **not** written to `users` (that table requires a
Discord id) — participants are session-scoped.

| Table | Purpose | Key columns |
|---|---|---|
| `debate_sessions` | one classroom activity | `id, course_id→courses, created_by, topic, format_id, status, phase, phase_seq, phase_started_at, phase_ends_at, join_code (unique), config jsonb, created_at, ended_at` |
| `debate_participants` | the roster for one session | `id, session_id, display_name, team_no, role_slot, device_id, consent_at, consent_policy_version, joined_at` |
| `debate_events` | append-only event log (drives SSE replay) | `id, session_id, seq bigint, type, payload jsonb, created_at`, `UNIQUE(session_id, seq)` |
| `debate_turns` | **final** transcript segments only | `id, session_id, participant_id, phase, text, started_at_ms, ended_at_ms, confidence, edited_by` |
| `debate_judgements` | AI + professor scores | `id, session_id, round, target (participant\|team), rubric_id, scores jsonb, rationale text, model, is_final, confirmed_by` |

Rules that matter:
- **Do not reuse `audit_log`** for transcripts — it mandates *redacted* text
  (the opposite of what this feature needs) and is length-capped. Write **one**
  `audit_log` row per AI judge/debater output for provenance.
- Persist **finalized utterances only** (~300–600 rows/class). Interim partials
  stay in memory — never write partials to Postgres.
- Every phase transition is `UPDATE … SET phase=$new, phase_seq=phase_seq+1 …
  WHERE id=$1 AND phase_seq=$2 RETURNING *` — optimistic concurrency makes a
  double-tapped button, a duplicate timer, and a transient second replica all
  idempotent. **Postgres is truth; memory is cache.**

---

## 5. Join flow (QR → roster claim → consent)

1. **Two identifiers, two lifetimes.** A stable per-course URL (`/j/<slug>`) that
   always resolves to whichever activity is live (Mentimeter's pattern: the QR
   never changes, the digits do), plus a per-activity **6-character code**
   (Crockford base32, no I/L/O/U) as a co-primary typed path. Project QR + short
   URL + code together — a back-row-readable QR is physically impossible
   (10:1 rule), so the typed code is not optional.
2. **The QR carries a rotating ticket, not a session.** `/j/<slug>?t=<jws>` with
   a `jose` HS256 JWS over `{activityId, window}` (30 s window, 90 s exp, accept
   current + previous). `jose` is already an `apps/web` dependency and
   `lib/auth.ts` is the template. Not single-use (60 students redeem the same
   window); cap redemptions at ~1.5× roster and alert above it.
3. **Name from the roster, not the keyboard.** Free text yields "bob", "Bob",
   "Robert", two "Wang Wei"s and four wrong teams. The professor already has a
   **Canvas API key** and `@vta/canvas` has an enrollment path — pull the course
   roster and have each student **claim** a real name (prefix search, one claim
   per entry, duplicates → professor approval queue). Keep a visibly-marked
   "unrostered guest" lane. Teams: pre-assigned in the console, or capped
   self-select (show remaining slots) to stop the everyone-picks-Team-1 stampede.
4. **Device-bound cookie on first load.** Redemption creates the participant row
   and sets a signed HttpOnly cookie `{activityId, participantId, deviceId}`
   (TTL = activity end + 4 h), so refresh / backgrounding / Wi-Fi drop silently
   resume the same seat — strictly better than Kahoot, where a refresh cost you
   your score.
5. **Consent gate before any mic.** A blocking, unchecked-by-default screen:
   what is captured, retention, who sees it, that an AI judges and debates, and
   a **text-only lane** for anyone who declines. Write a consent row
   (participant, activity, UTC ts, policy version hash). This row is the Maryland
   §10-402 evidence and the FERPA notice record.
6. **Onboarding happens before class.** Post the join link the day before:
   students claim their name and grant mic permission from their dorm. In class
   the flow is "open link → press Speak". 30 students × (QR + permissions + name
   + team) in-period is ~15 minutes of a 50-minute class; that alone kills the
   activity.

---

## 6. Audio capture + attribution — floor control

**The single highest-value design decision.** Mics are **closed by default**.

- The professor (or the phase FSM) grants the floor to a role slot; that
  student's phone shows **"You have the floor — press to speak"**. Pressing it is
  the user gesture that opens `getUserMedia`, and closing the turn releases it.
- Exactly **one** stream is open at a time (1–2 during an open "clash" phase).
- Attribution: the stream *is* that participant's, because the server minted
  their session. No diarization needed, no DER, no "Speaker 3" reconciliation.

What this buys, all at once:
- **Cost:** ~1 audio-hour per class (**~$0.15–0.50**) instead of 30 concurrent
  streams × 50 min = 25 audio-hours (~$12–27).
- **iOS:** the speaker is holding and looking at their phone, so backgrounding /
  screen-lock suspension mostly evaporates (still set a **Screen Wake Lock**).
- **Consent:** nothing is recorded except someone who just deliberately pressed
  "Speak" — the bystander-capture problem largely disappears.
- **Transcript quality:** one clean turn = one clip = one STT call, instead of
  the same sentence transcribed 30 times at 30 different SNRs.

Capture settings: 16 kHz mono PCM16 (or Opus), `echoCancellation: true`. Show a
persistent recording indicator and a working mute (mute = consent withdrawn for
that interval).

**Optional Phase 2 — room mic.** For free-form "clash" phases, add one USB
boundary mic on the podium as a second, diarized source of truth. Keep floor
control as the primary attribution mechanism; use the room mic to fill gaps.

---

## 7. Realtime transport — SSE, not WebSocket

Traffic is ~99% server→client (phase, deadline, transcript, roster, judge
output); upstream is low-rate and request-shaped, so plain POSTs cover it.

- **SSE** works through Container Apps ingress with **zero** infra change, and
  gives reconnect + resume + late-joiner replay free via `Last-Event-ID`
  (replayed from `debate_events.seq`).
- Next.js App Router **cannot** do WebSocket upgrades in route handlers; a WS
  server means a custom server that breaks the working `output: 'standalone'`
  Docker build — regression risk for a capability 60 clients don't need.
- Managed realtime (Pusher/Ably/Web PubSub) is ~$49/mo minimum vs ~$0.08 of ACA
  compute per session **[verify]** — a large premium for a problem we don't have.
- Keep **min=max=1 replica** for the pilot. The `phase_seq` optimistic-concurrency
  invariant means a transient second replica is safe but not required. Redis
  pub/sub is the prerequisite *if and when* we scale out — not now.

---

## 8. Debate format + rubric

A concrete, code-drivable format sized for one class period (~28 min of
debate + prep, leaving room for setup and feedback):

```ts
// 3 v 3, derived from Public Forum's clock + Karl Popper's team size
phases: prep 5:00 · A1 3:00 · B1 3:00 · A2 3:00 · B2 3:00
      · open clash 4:00 · AI slot 2:00 · A3 2:00 · B3 2:00
```

`speaker` is a **role slot**, not a person — the FSM, not voice activity, is the
authority on whose turn it is. POIs are offered via a button (queued to the
speaker's phone as accept/decline), never by interrupting the audio.

**Rubric** — 5 criteria, 0–5 bands, weights summing to 100, published to students
*before* the debate. Band 3 is explicitly "meets expectations" to anchor against
LLM judges' documented tendency to compress or exaggerate spread.

| id | Criterion | Weight | Scored by |
|---|---|---|---|
| `ARG` | Argumentation & reasoning (claim→warrant→impact) | 30 | AI |
| `EVI` | Evidence & grounding (specific, attributable) | 25 | AI (+ code checks vs course materials) |
| `REF` | Refutation & clash | 25 | AI |
| `ORG` | Organization & role fulfilment | 10 | AI |
| `DEL` | Delivery | 10 | **Human only** — AI must not score delivery from a transcript |

---

## 9. AI judge and AI debater

**AI judge — advisory, never a grader.**
- Runs **between rounds** (60–90 s window), not per turn. Asynchronous judging is
  also pedagogically better: students get one consistent verdict, not a running
  commentary.
- **Bias controls** (LLM-judge bias is documented and reproducible: position,
  verbosity, self-preference, name bias): score **per speaker in isolated
  passes**; run win/loss passes with **swapped side order** and keep it only if
  the verdict is stable; **strip names** from the transcript sent to the judge
  (use role slots); anchor every band with explicit descriptors; use a
  **2-model panel** (Opus 4.8 + Sonnet 4.6, already wired) and flag disagreement
  for the professor.
- **The professor holds the pen.** Scores land as `is_final = false` and require
  confirm/override; overrides are recorded. Nothing auto-writes a grade.

**AI debater — a reserved slot, not an interrupter.**
- Occupies a scheduled 2-minute turn with diegetic "prep time" (30–60 s of
  thinking is *normal* in real debate), so generation latency reads as
  deliberation rather than a hang.
- Grounded in the course materials via the existing `retrieve` tool, so it argues
  from the syllabus, not from the open internet.
- Rendered as text on the projector; **TTS is Phase 2**.
- Reuse `@vta/llm`'s `ModelRouter` by logical role. Add **prompt caching** on the
  transcript prefix (`cache_control` on the stable block) — the judge re-sends
  the whole transcript each round, and caching cuts that cost substantially.
  Set an explicit `max_tokens` on every debate-path call.

---

## 10. Compliance checklist (must clear **before** the first enrolled student)

Maryland is an **all-party consent** state (Md. Cts. & Jud. Proc. §10-402;
violation is a felony, §10-410 adds civil liability). HB 688, which would have
downgraded it, **died in the Senate at sine die 2026-04-13** **[verify]**.

- [ ] Per-participant, affirmative, **logged** consent before any capture; hard
      interlock — no track opens without both professor start **and** that
      device's consent row.
- [ ] A real **text-only participation lane** for students who decline, with no
      grade penalty.
- [ ] **No biometrics** collected (voiceprints deleted → BIPA/CUBI/MODPA-sensitive
      /GDPR Art.9/DPIA surface removed at zero feature cost).
- [ ] Retention + deletion schedule for audio (delete raw audio after transcript
      finalization) and transcripts; documented student access path (FERPA §99.10).
- [ ] **Named STT vendor** under an institutional agreement/DPA; student audio is
      the largest disclosure in the system and is currently an unfilled blank.
- [ ] FERPA school-official review of the STT vendor **and** of routing
      student-identifiable text through OpenRouter (a *router*: the upstream
      provider is chosen per request). Consider an institutionally-contracted
      endpoint (Azure OpenAI in JHU's tenant) for the debate path.
- [ ] **IRB/HIRB up front** if publication or "does the AI judge improve
      argumentation?" evaluation is even possible — approval cannot be granted
      retroactively.
- [ ] AI scores are advisory; professor of record confirms every score.

> **Sequencing:** run a *build track* (staff, volunteers, synthetic transcripts,
> no grades) in parallel with an *approval track*. Every gate above is a
> prior-approval gate.

---

## 11. Repo changes required

Reusable as-is: `@vta/data` patterns, `@vta/llm` ModelRouter, `@vta/tools`
`retrieve`, `@vta/tenancy` course resolution, `apps/web` professor auth
(`lib/auth.ts`), the CI/CD workflows.

Must be built / changed:

| Change | Where | Note |
|---|---|---|
| Debate schema + `DebateRepository` | `packages/data` | new `schema/debate.ts`, export from `schema/index.ts`, `pnpm db:push` |
| **`apps/web` gains a `@vta/data` dependency** | `apps/web/package.json` | it currently depends on only `jose/next/react/react-dom` — **it cannot reach Postgres at all today** |
| Dockerfile must build workspace deps | `apps/web/Dockerfile` | `pnpm --filter=@vta/web... build` (note the `...`) |
| CI path filter | `.github/workflows/web-build-deploy.yml` | add `packages/**` |
| Pool singleton | `apps/web/lib/db.ts` | cache on `globalThis` — `createDb` makes a new pool per call; Next dev HMR would leak one per reload |
| DB connection budget | `CreateDbOptions.maxConnections` | B1ms allows ~35 connections; the current `POOL_MAX = 10` per process is too generous once web + worker both connect |
| Participant session | `apps/web/lib/participant.ts` | a *separate* `vta_participant` JWT — do **not** extend `SessionClaims` (its `Role` is literally `'professor'` and is re-checked against `ADMIN_EMAILS`) |
| STT adapter | new `packages/audio` (or `@vta/stt`) | narrow `SttProvider` interface so the vendor is swappable |
| Debate FSM | new `packages/classroom` | pure, I/O-free state machine + zod event schemas, unit-tested (mirrors `@vta/governance`'s shape) |
| Per-course token budget / rate limit | `@vta/llm` router | deliberately deferred in Wave C; a runaway judge loop on a shared OpenRouter key would also degrade the **production Discord bot** |

---

## 12. Cost model (per 50-minute class, 30 students) **[verify]**

| Item | Estimate |
|---|---|
| STT (floor-controlled, ~1 audio-hour) | $0.15 – $0.50 |
| AI judge (Opus 4.8, ~4 rounds, with prompt caching) | ~$0.30 – $1.00 |
| AI debater (1–2 turns) | ~$0.10 – $0.30 |
| Container Apps compute | ~$0.08 |
| **Total** | **≈ $0.60 – $2 per class** |

Compare: naive 30-phone continuous streaming is **$12–27 of STT alone**, for a
worse transcript. Add a hard per-session token budget that fails closed with a
visible "AI judge paused — budget reached".

---

## 13. Phased delivery

| Phase | Scope | Gate to start |
|---|---|---|
| **0. Approvals (parallel, starts now)** | STT vendor selection + DPA, FERPA/privacy review, IRB decision, consent copy | — |
| **1. Core (no audio)** | Schema, professor console, QR + roster claim + consent, SSE state, phase FSM + timers, **manual/typed** turn entry, AI judge on typed transcript | none — fully buildable today |
| **2. Audio** | Floor-controlled push-to-talk capture, STT adapter, live transcript, per-turn playback | STT vendor contracted |
| **3. AI debater** | Reserved AI slot grounded in course materials, projector view | Phase 1 |
| **4. Polish** | Room mic for clash phases, TTS voice, analytics, exports, optional on-device Eagle verification | pilot feedback |

Phase 1 is genuinely useful on its own: a structured, timed, attributed debate
with an instant rubric-anchored AI verdict — even if turns are typed, not spoken.

---

## 14. Open decisions (need the professor / product owner)

1. **Voiceprints: confirm deletion** (recommended) or accept on-device-only Eagle
   in Phase 2?
2. **Student identity:** roster claim via the professor's Canvas API key
   (recommended) vs free-text name + team?
3. **Does the AI score ever touch a grade?** Recommendation: **no** — advisory
   only, professor confirms. This is also the position most likely to clear review.
4. **STT vendor:** cheapest (Soniox ~$0.12/hr), best-in-noise (AssemblyAI
   ~$0.15–0.57/hr), best concurrency (Deepgram), or institutional (Azure Speech in
   JHU's tenant — easiest FERPA sell, likely the deciding factor)?
5. **Debate format:** adopt the 3v3 / 28-minute format in §8, or match a format
   the professor already teaches?
6. **Pilot scope:** consenting volunteers first, or a real graded section
   (the latter requires the full §10 checklist first)?
