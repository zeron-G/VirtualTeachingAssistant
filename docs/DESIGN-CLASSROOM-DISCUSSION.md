# Classroom Discussion Module — Design & Status

Status: **shipped and deployed** (`vta-web`, pilot). This document describes what
is actually built. Where the original design was overtaken by a decision, the
superseded part is kept with a note — the reasoning is often still load-bearing.

The activity: a professor opens a discussion on a question; students scan a
rotating QR, type their name and pick a group; anyone may speak; every spoken
turn is transcribed and attributed; and the AI reads the room back to the class.

> **Renamed 2026-07-31.** This was specced as a *debate* with a scoring AI judge.
> The professor clarified the real activity: **two to four groups putting their
> views on a question, with AI help** — a discussion, not a competition. §8 (a
> fixed debate format) and the scoring rubric are **deleted**; §9 is now a
> synthesis, not a verdict. Everything about attribution, consent and transport
> was unaffected. The tables and route prefix remain `debate_*` / `/api/debate`
> to avoid a rename migration on a live pilot.

---

## 1. The three substitutions

Three parts of the original concept did not survive contact with reality. Each
substitution preserves the intent.

| # | Original step | Problem | What shipped |
|---|---|---|---|
| 1 | Students **enroll a voiceprint** so the system can identify their voice | Dead end on 3 independent axes (§3) | **Deleted.** Attribution is **device identity**, not biometrics — deterministic, zero regulated data |
| 2 | **Recording starts automatically** for everyone | Illegal-by-default in Maryland (all-party consent), and browsers forbid it (mic needs a user gesture; iOS suspends background capture) | **Press to speak**: a mic opens only when its owner presses, which is both the consent act and the required gesture |
| 3 | A live **AI debater** interjecting in real time | An Opus-class turn is 10–30 s; human turn-taking is sub-second | **AI on demand, between turns** — the professor presses "Ask the AI" and gets a synthesis of the discussion so far |

---

## 2. Architecture

```
   Professor console (vta-web)            Student phone (vta-web)
   ─ start/end the discussion             ─ scan rotating QR → name + group
   ─ rotating QR on the projector         ─ consent gate
   ─ live attributed transcript           ─ press to speak → mic opens
   ─ "Ask the AI" → synthesis             ─ live transcript
            │                                        │
            │  POST (commands)          SSE (state)  │  POST (audio clip)
            ▼                                        ▼
   ┌──────────────────────────────────────────────────────────┐
   │  vta-web (Next.js, Azure Container Apps, min=max=1)      │
   │   • /api/debate/**        route handlers (nodejs)        │
   │   • in-process fan-out hub  →  SSE to all clients        │
   │   • Postgres = source of truth                           │
   └──────────────┬───────────────────────┬───────────────────┘
                  │                       │
        ┌─────────▼─────────┐   ┌─────────▼──────────┐
        │ OpenRouter STT    │   │ OpenRouter chat    │
        │ openai/whisper-1  │   │ Opus 4.8 synthesis │
        │ batch, per clip   │   │                    │
        └───────────────────┘   └────────────────────┘
                  │                       │
              ┌───▼───────────────────────▼───┐
              │ Postgres (existing, B1ms)     │
              │ debate_* tables               │
              └───────────────────────────────┘
```

No new service, no Redis, no WebSocket server, **no new vendor**: STT goes
through the OpenRouter key the rest of the system already uses, which removed
the procurement blocker that gated the original Phase 2.

---

## 3. Why voiceprints are deleted (the most important decision)

Not a preference — three independent blockers:

1. **The service layer is gone.** Azure AI **Speaker Recognition was retired
   2025-09-30** (Speech SDK 1.47 lists its removal as a breaking change), and
   Amazon Connect Voice ID reaches end-of-support **2026-05-20** **[verify]**.
   *Independently confirmed:* Microsoft's `speaker-recognition-overview` doc page
   now redirects to the general Azure Speech overview, and Speaker Recognition no
   longer appears anywhere in that page's capability list. Both hyperscalers
   exited voice biometrics within ~8 months — a strong signal. Of surveyed
   streaming-STT vendors, **only Speechmatics** still offers enrollment-based
   speaker ID, capped at **50 speaker identifiers per session** — under a
   60-student cohort. Everyone else (Deepgram, AssemblyAI, Soniox, Gladia,
   OpenAI, pyannoteAI) does **anonymous** diarization only: "Speaker 1/2", with
   no way to bind a cluster to a person.
2. **It's regulated biometric data.** A voiceprint bound to a class activity is a
   biometric identifier *and* a FERPA education record. Maryland's **MODPA**
   (effective 2025-10-01, enforceable 2026-04-01) treats biometric data as
   **sensitive** regardless of use, with a *strict necessity* standard; Maryland
   **PIPA** names a "voice print" as personal information; JHU enrolls students
   from **Illinois (BIPA)** and **Texas (CUBI)** whose statutes follow the
   resident **[verify with counsel]**. The trap: because a non-biometric design
   works, the biometric one fails MODPA's necessity test.
3. **It isn't needed.** One clip comes from one phone, and that phone already
   authenticated its owner when they claimed a seat. Attribution is correct by
   construction — better than any voiceprint system, which in real classroom
   audio reports ~34% DER.

> **If voice verification is ever wanted** ("nobody speaks for a teammate"), the
> compromise is **Picovoice Eagle on-device** (WASM): the template never leaves
> the phone, which returns only a similarity score. Opt-in, never a join gate.

---

## 4. Data model (`packages/data/src/schema/debate.ts`)

Every session hangs off `course_id` (the tenant unit). Students are **not**
written to `users` (that table requires a Discord id) — participants are
session-scoped, and identity here is "good enough for a classroom activity",
not an authentication claim.

| Table | Purpose | Notable columns |
|---|---|---|
| `debate_sessions` | one classroom activity | `topic`, `teams jsonb` (2–4 `{id,label,color}`), `status`, `join_code` (unique), `require_ticket`, `open_floor`, `floor_participant_id`, `phase` |
| `debate_participants` | the roster for one session | `display_name`, `team`, `device_id`, `consent_at`, `hand_raised_at`, `UNIQUE(session_id, device_id)` |
| `debate_turns` | finalized transcript segments | `participant_id`, `speaker_name` (denormalized), `team`, `text`, `duration_sec` |
| `debate_judgements` | AI readings, append-only | `kind` (`discussion` \| `contributions`), `scores jsonb` (structured payload, shape owned by that kind's prompt), `rationale` (prose summary), `model` |

Rules that matter:
- **Groups are data, not code.** `teams` is a jsonb list on the session; the
  console, join page and transcript all render from it. Ids are positional and
  fixed (`red`, `blue`, `green`, `amber`) so a rename never orphans a turn.
- **Do not reuse `audit_log`** for transcripts — it mandates *redacted* text (the
  opposite of what this feature needs) and is length-capped.
- Persist **finalized utterances only**. Interim audio never reaches Postgres.
- `debate_judgements` is append-only: the professor can ask the AI repeatedly as
  the discussion develops, and every reading is kept.
- `phase` survives as an **optional free-text tag** ("Round 2"). It enforces
  nothing. The nine-phase FSM in the original spec was removed — see §8.

---

## 5. Join flow (rotating QR → name + group → consent)

1. **The QR carries a rotating ticket.** `/j/<code>?t=<jws>` — a `jose` HS256 JWS
   over `{sid, window}`, 30 s window, 90 s expiry, current + previous window
   accepted (`lib/joinTicket.ts`). This is the point of the QR: it is a check-in,
   proof you were in the room while it was on screen. A static QR would be a
   password that leaks the moment anyone photographs it. Not single-use — sixty
   students redeem the same window.
2. **The professor can let a latecomer in.** `require_ticket` is a per-session
   toggle; turning it off makes the plain join code sufficient.
3. **Name is typed, group is picked.** Roster claim via Canvas was specced and
   deliberately **deferred** — JHU has not issued a Canvas Developer Key, and the
   professor wanted no login friction for a pilot. Students type a display name
   and choose one of the session's groups, or "Just listening".
4. **Device-bound cookie on first load.** Redemption creates the participant row
   and sets a signed HttpOnly `vta_participant` cookie `{sessionId, deviceId}`, so
   a refresh, a backgrounded tab or a phone waking from sleep silently resume the
   same seat rather than creating a second person on the roster. The unique index
   on `(session_id, device_id)` makes this atomic.
5. **Consent gate before any mic.** A blocking, unchecked-by-default screen
   stating what is captured, that it is transcribed, and who sees it. It writes
   `consent_at`. That row is the Maryland §10-402 evidence and the FERPA notice
   record. Declining is a first-class state: you stay in the room and can follow
   the transcript, and no microphone will ever open.

---

## 6. Audio capture + attribution

**Open floor is the default** (`open_floor = true`): any consented participant
may press to speak whenever they want, which is what a discussion actually looks
like. The professor can switch it off to run strict turn-taking, in which case
only `floor_participant_id` may record and students raise a hand to be called on.

- Pressing "Speak" is the user gesture that opens `getUserMedia`; releasing ends
  the clip and uploads it. Attribution: the clip *is* that participant's, because
  the server minted their seat.
- The record button uses **pointer capture with an intent ref and a generation
  guard**. `startRecording` is async (the permission prompt) while
  `stopRecording` is sync, so a naive implementation opens the mic *after* the
  finger has already lifted — guaranteed on the first press, when the browser
  shows a permission dialog. That is a hot microphone, and it was a real bug.
  There is also an auto-stop ceiling so a stuck pointer cannot record forever.
- If the professor revokes the floor mid-sentence, the in-flight clip is still
  accepted (120 s grace in `lib/hub.ts`). Destroying someone's sentence because
  a button was pressed elsewhere is worse than accepting it.
- Capture is 16 kHz mono with `echoCancellation: true`, with a persistent
  recording indicator.

**Known limitation under open floor:** two people talking at once produce two
overlapping clips, each transcribed independently, each picking up the other's
voice as background. Mitigations (silence detection, or a soft
one-speaker-at-a-time lock) are **not implemented** — the professor asked for
free discussion first and the pilot will show whether it matters.

---

## 7. Realtime transport — SSE, not WebSocket

Traffic is ~99% server→client (roster, transcript, AI output); upstream is
low-rate and request-shaped, so plain POSTs cover it.

- **SSE** works through Container Apps ingress with zero infra change.
- Next.js App Router **cannot** do WebSocket upgrades in route handlers; a WS
  server means a custom server that breaks the working `output: 'standalone'`
  Docker build — regression risk for a capability 60 clients don't need.
- Managed realtime (Pusher/Ably/Web PubSub) is ~$49/mo minimum vs ~$0.08 of ACA
  compute per session **[verify]**.
- The fan-out hub is **in-process**, so **min = max = 1 replica** is a hard
  requirement, not a preference. Redis pub/sub is the prerequisite if we ever
  scale out.
- The stream coalesces bursts with a **trailing edge** and respects
  `controller.desiredSize` for backpressure. An earlier `pending` boolean dropped
  the last event of every burst — i.e. exactly the event that mattered.

---

## 8. ~~Debate format + rubric~~ — deleted

The original spec defined a 3v3 Public-Forum-derived format (prep · A1 · B1 · A2
· B2 · clash · AI slot · A3 · B3) driven by an FSM, plus a five-criterion
weighted rubric.

**All of it is gone.** The professor's actual activity has no running order and
no score. What had been built of it was a nine-item phase picker in the console
that enforced nothing — no timer, no speaking rights, just a label stamped on
turns — while contradicting the free-discussion default. Decorative state that
looks authoritative is worse than no state.

Group count and names are the only structure left, and they are per-session
configuration (2–4 groups) rather than a format baked into code.

---

## 9. The AI — a synthesis, not a verdict

`lib/judge.ts` → `analyzeDiscussion(topic, turns, teams)` returns:

| Field | What it is |
|---|---|
| `teams[]` | per group: the points they actually made, and **one constructive suggestion** |
| `agreements` | genuine common ground — not a restatement of the question |
| `disagreements` | where the groups really differ, and why |
| `gaps` | angles **nobody** raised |
| `nextQuestion` | one question to put to the room next |
| `summary` | short prose the professor can read aloud |

Design rules, enforced in the prompt:
- **It must not declare a winner, rank the groups, or score anything.** This is
  the difference between the module the professor asked for and the one that was
  specced. A class stops thinking once it is told who won.
- **Names are stripped** before the transcript reaches the model, and turns are
  labelled by group. LLM-judge name bias is documented and reproducible; there is
  no reason to expose the model to student names to summarise arguments.
- It is **on demand and repeatable** — the professor presses "Ask the AI" during
  or after the discussion, as often as useful. Each reading is stored.
- Runs on Opus 4.8 via the shared OpenRouter key. A seven-turn transcript takes
  ~30 s end to end, so the console shows progress rather than appearing hung.

The **AI debater** (a participant arguing its own side) is still unbuilt and is
no longer obviously wanted: in a discussion it competes with students for the
floor. Deferred pending the pilot.

### 9a. Contribution review — instructor only

A second reading, `lib/contributions.ts` → `assessContributions()`, for marking
participation. Per person: measured stats (turns, words, share of talk, counted
in code and never asked of the model) plus three ordinal bands 1-4 — substance,
engagement with others, moves it forward — with one piece of evidence and one
suggestion each. Plus whole-room notes and a list of people who joined but never
spoke, which is the single most actionable output and also where a broken
microphone hides.

Four constraints, each enforced somewhere other than the prompt:

| Constraint | How it is enforced |
|---|---|
| Students never see it | Not in `DebateSnapshot`. The SSE stream that carries the snapshot **has no authentication** — it is how every student's phone follows the transcript — so anything in it is public to the room. The review is fetched only by `POST/GET /api/debate/sessions/:id/contributions` behind the professor cookie, and the route deliberately does not call `publish()`. |
| Not a grade | No overall or averaged figure exists in the type. Three ordinal bands, rendered as segments, with anchor words. A single number is what gets pasted into a gradebook unexamined. |
| Not a ranking | The prompt forbids ordering or naming a best contributor; the UI renders roster order and offers no sort. |
| Names stay out of the model | The transcript goes in as `S1`, `S2`, …; names are restored locally on the way out, so the instructor reads "Tom's concern went unanswered" while the model never saw "Tom". |

**What it actually measures, stated in the UI.** Speech that a phone microphone
captured and Whisper transcribed. That under-counts quiet speakers, poor
microphones, non-native speakers, and anyone who contributed by listening and
prompting others. Band 1 is anchored as "little evidence *in this transcript*",
the model is barred from judging delivery, fluency, accent or grammar, and it is
barred from any quantitative claim about participation (it invented turn counts
on the first real run — those are measured in code).

---

## 10. Compliance checklist

Maryland is an **all-party consent** state (Md. Cts. & Jud. Proc. §10-402;
violation is a felony, §10-410 adds civil liability). HB 688, which would have
downgraded it, **died in the Senate at sine die 2026-04-13** **[verify]**.

Done:
- [x] Per-participant, affirmative, **logged** consent before any capture; no mic
      opens without that device's `consent_at`.
- [x] A real listen-only lane for students who decline.
- [x] **No biometrics** collected — the BIPA/CUBI/MODPA-sensitive/GDPR Art. 9
      surface is removed at zero feature cost.
- [x] No AI output touches a grade; there is no score to touch one with.

Outstanding before an enrolled, graded section:
- [ ] Retention + deletion schedule for audio and transcripts; documented student
      access path (FERPA §99.10). **Raw audio is currently not persisted at all**
      (transcribed and dropped), which is the easy half of this.
- [ ] FERPA school-official review of routing student audio and identifiable text
      through **OpenRouter** — a *router*, so the upstream provider is chosen per
      request. This is the largest disclosure in the system. Consider an
      institutionally-contracted endpoint (Azure OpenAI in JHU's tenant).
- [ ] **IRB/HIRB up front** if publication or any "does this improve discussion?"
      evaluation is possible — approval cannot be granted retroactively.
- [ ] Per-course token budget. A runaway loop on the shared OpenRouter key would
      degrade the **production Discord bot**, not just this feature.

---

## 11. Cost model (per 50-minute class, 30 students) **[verify]**

| Item | Estimate |
|---|---|
| STT — `openai/whisper-1` via OpenRouter, ~1 audio-hour (measured ~$0.0015 / 15 s) | ~$0.36 |
| AI synthesis — Opus 4.8, a few runs | ~$0.20 – $0.80 |
| Container Apps compute | ~$0.08 |
| **Total** | **≈ $0.65 – $1.25 per class** |

Press-to-speak is what makes this cheap: ~1 audio-hour per class instead of 30
concurrent streams × 50 min = 25 audio-hours (~$12–27) — for a *worse*
transcript, since the same sentence would be captured 30 times at 30 SNRs.

---

## 12. What's built, what isn't

Built and deployed: schema + `DebateRepository`, professor console, rotating-QR
join with consent, SSE state, press-to-speak capture, whisper-1 transcription,
attributed live transcript, configurable 2–4 groups, AI synthesis, instructor-only
contribution review (§9a).

Not built, in rough priority order:
1. Per-course token budget (see §10) — the only item with a blast radius outside
   this feature.
2. Cross-talk handling under open floor (§6).
3. Roster lock / remove a participant — the professor's only current recourse to
   a joker on the roster is ending the session.
4. Transcript export.
5. Canvas roster claim (blocked on a JHU Developer Key).
6. AI debater (§9), TTS, projector view.
