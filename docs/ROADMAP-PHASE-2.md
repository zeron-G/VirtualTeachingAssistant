# VTA Phase 2 — Roadmap & backlog

Status: **planning**. Captures three requested workstreams beyond the Phase‑1
hardening (Waves A–D): (1) a guided **onboarding + auto‑provisioning** system for
new professors, (2) a **web frontend** (login + dashboard), and (3) exploratory
**classroom features** (recording, auto‑organization, games).

This document is grounded in the current code and in external‑platform research
(Canvas API policy, Discord.js provisioning, Next.js/Auth.js/Azure). Where a
product decision is still open it is called out in **Open questions**.

## Assumed decisions (defaults — revise freely)

| # | Decision | Default taken | Alternative |
|---|----------|---------------|-------------|
| A | Dashboard auth | **Discord OAuth** (MVP) — reuses the bot's identity | JHU SSO (SAML) later; email+password |
| B | Onboarding auto‑provision scope | **Full auto**: course + config + per‑course agent config + Discord channel(s) + routing | Course+config+ingest only; multi‑bot |
| C | Frontend stack/hosting | **Next.js in this monorepo**, Azure Container Apps, default `*.azurecontainerapps.io` host until a domain lands | Vite SPA + separate API |
| D | Sequencing | **Backend onboarding/provision API first** (CLI + dashboard share it), frontend in parallel, features as a research track | Frontend first; both at once |

---

## 0. Current state (what onboarding costs today)

Bringing up one course is a manual, operator‑run sequence via the `@vta/admin`
CLI (`apps/admin/src/main.ts`), with no dashboard/API:

1. **Out‑of‑band**: provision + migrate the Postgres/pgvector DB (the CLI runs no
   migrations); hand‑create `.env` / inject env.
2. Set per‑course secrets **by hand**, honoring the name‑mangling in
   `packages/shared/src/secrets.ts` (`canvas.token.cs101` → env `CANVAS_TOKEN_CS101`,
   Key Vault `canvas-token-cs101`): the Canvas token `CANVAS_TOKEN_<SLUG>`, optional
   `CANVAS_BASEURL_<SLUG>`, and an embeddings key (`OPENROUTER_API_KEY`).
3. `course:add --slug --name --canvas-id` → upserts `courses`, seeds `course_config`
   (`DEFAULT_CONTENT_RULES`, empty channel map) if none exists.
4. `course:map-channel --slug --channel [--guild]` → appends a Discord channel id to
   `course_config.channel_map.discord` (a flat `string[]`). **`--guild` is accepted
   but NOT persisted** — a schema gap for multi‑guild routing.
5. `course:set-role --slug --discord-id --role admin` → makes the professor a course admin.
6. `course:ingest --slug` → the long‑running Canvas sync (token/baseUrl resolved
   from secrets inside `CourseIngestionService.ingestCourse`; a bad token surfaces
   only here, at runtime).
7. `course:list` → verify.

**Discord servers/channels/roles are created manually by a human today**; the CLI
only records the resulting channel‑id string. Nothing calls the Discord API to
create guilds/channels or assign roles.

---

## 1. Workstream — Onboarding & auto‑provisioning

Goal: a professor goes from "I have a Canvas course" to "the bot is live in my
Discord, grounded in my materials" with near‑zero manual steps.

### 1a. A shared onboarding/management service (backend, unblocked — do first)

Extract the five CLI commands' logic into one `OnboardingService` in `@vta/core`
(or a new `@vta/onboarding`) so the **CLI, the dashboard API, and any future
automation call the same path** (mirrors how `TeachingService`/`CourseIngestionService`
are composed). Operations: `createOrUpdateCourse`, `setCanvasCredentials`,
`mapChannel`/`provisionChannels`, `setMemberRole`, `ingest`, `listCourses`,
`getCourseStatus` (new: ingest coverage + token validity).

Prereqs it also forces us to fix:
- **A real migration runner.** Today the schema is assumed pre‑migrated. Onboarding
  from a UI needs `db:push`/drizzle migrations run as a deploy step, not by hand.
- **A `validateCanvasToken` step** (a cheap `GET /api/v1/courses/:id`) so a bad
  token fails at *connect* time in the UI, not silently at ingest.

### 1b. Canvas access — **use OAuth2, not pasted tokens** (has an external blocker)

Research finding (decisive): asking a professor to paste a **personal access token**
is a documented **violation of Canvas's API Policy**, and since ~Sept 2024 Canvas
can disable self‑service token creation for non‑admins — so it may not even be
available at JHU.

Correct path: **Canvas OAuth2 authorization‑code flow** against an
**admin‑registered developer key**:
- The professor clicks "Authorize" once (true self‑service; never handles a secret).
- The developer key can be **scoped read‑only** (`url:GET|/api/v1/...`), enforced by
  Canvas — strictly better than a full‑privilege personal token.
- Access tokens expire in **1 hour**; we must store the **refresh token** and refresh
  server‑side (`grant_type=refresh_token`) without re‑prompting.

**BLOCKER / dependency to start now:** a **JHU Canvas root‑account admin must create
and enable a developer key** (client_id/secret + our redirect URIs), scoped to the
GET endpoints the ingestor uses. Keys are per‑institution.

- **MVP fallback** while the key is pending: keep the operator‑provisioned token path
  (current behavior), but store tokens in Key Vault, never in the dashboard DB.
- **New storage**: per‑course Canvas OAuth tokens (access+refresh+expiry) → Key Vault
  under the existing `canvas.token.<slug>` convention; add refresh plumbing.

### 1c. Discord auto‑provisioning ("多个 channel 自动派发")

Once the professor's guild is linked, auto‑create the course's space:
- `guild.channels.create({ type: GuildCategory, ... })` for a per‑course category,
  then child `GuildText` channels (`parent: category.id`).
- **Private/course‑only** via `permissionOverwrites`: deny `ViewChannel` to
  `@everyone` (addressed by `guild.id`), allow it to a **per‑course Discord role**
  (role‑per‑course strategy scales better than per‑member overwrites and maps cleanly
  to `@vta/tenancy` routing). Children sync to the category (`lockPermissions()`).
- Persist the created channel ids **with their guildId** into `channel_map` so
  `CourseResolver.resolveByChannel` routes correctly.

**Constraints (from Discord docs):**
- A bot **cannot add itself to a guild** — a human with *Manage Server* must click an
  OAuth2 invite URL. The dashboard should generate/show that URL.
- The bot must be **re‑invited with new permissions** before it can provision:
  `MANAGE_CHANNELS + MANAGE_ROLES + VIEW_CHANNEL + SEND_MESSAGES + READ_MESSAGE_HISTORY`
  (permissions integer **268504080**). A bot cannot grant a permission it lacks.
- Bot's role must sit **above** any role it creates/manages; watch channel/role rate limits.

**Schema change required:** `course_config.channel_map.discord` is a flat `string[]`
with no guildId (the CLI already drops `--guild`). Persist
`DiscordChannelBinding { channelId, guildId }` (the tightened type already exists in
`packages/tenancy/src/types.ts` — it just isn't stored). Migrate the stored blob.

### 1d. "多个 agent 自动派发" — interpretation

The system is **already multi‑tenant**: one `TeachingService`, per‑course config
(`ContentRules`, locale, persona) resolved per request. "Multiple agents" is best
implemented as **per‑course agent configuration auto‑seeded at onboarding**
(persona/welcome text/rules), *not* multiple processes or bot tokens. Auto‑dispatch
= when a course is provisioned, seed its config + channels + routing so it behaves as
its own agent. (Multi‑bot — a token per course — is possible but high‑ops; not
recommended. See Open questions.)

### Data‑model changes summarized
- Persist `guildId` alongside channel bindings (1c).
- Store Canvas OAuth access+refresh+expiry per course (1b).
- Add a **professor allowlist / org‑admin** concept for dashboard auth gating (2).
- Wire the reserved `org_id` (courses) if multi‑department grouping is wanted.
- Reserved `users.jhed_id`/`email` support a later JHU‑SSO switch.

---

## 2. Workstream — Frontend (login + dashboard) — unblocked, parallel

Not blocked by the missing domain: **Azure Container Apps issues an immediate
`https://<app>.<region>.azurecontainerapps.io` FQDN with free TLS**; a custom domain
is added later via DNS + `az containerapp hostname add/bind` (subdomain = CNAME to the
app FQDN + `asuid` TXT verification).

**Stack:** Next.js (App Router) added to the monorepo; server actions/route handlers
import the existing `@vta/*` packages directly (reuse `OnboardingService`,
`TenancyService`, audit reads).

**Auth (Discord OAuth via Auth.js v5):**
- Root `auth.ts` with the Discord provider; route handler at
  `app/api/auth/[...nextauth]/route.ts`; env `AUTH_SECRET`, `AUTH_DISCORD_ID`,
  `AUTH_DISCORD_SECRET`; register redirect `https://<host>/api/auth/callback/discord`.
- **Restrict login to authorized professors** in the `signIn` callback (look up the
  Discord id against the professor allowlist; `return false` otherwise).
- Put Discord id + per‑course roles as **JWT claims** (jwt/session callbacks); gate
  routes at three layers (middleware, server components, server actions).

**Dashboard MVP scope:**
- Sign in; see the courses you administer.
- **Connect Canvas** (OAuth "Authorize" once, or paste‑token MVP fallback) + validate.
- **Link Discord** (show the bot invite URL with the right permissions) →
  **auto‑provision** category/channels/role.
- Trigger **ingest**; show coverage/status (materials, chunks, last sync, token health).
- Manage **channels** and **staff roles**; edit **content rules / persona / welcome**.
- Read‑only **audit/analytics** view (from the existing audit log).

---

## 3. Workstream — Classroom features (exploratory / research spikes)

Recording, auto‑organization, and classroom games are a different domain (real‑time
media, scheduling, game state) and need separate scoping. **Biggest open question:
where does "class" actually happen?** — a Discord **voice channel**, **Zoom/Panopto**,
or **in‑person**. That single answer changes the entire architecture:
- *Discord voice*: a voice‑receive bot (e.g. `@discordjs/voice`) + STT; heavy consent/
  FERPA implications; recording requires all participants' awareness/consent.
- *Zoom/Panopto*: integrate with their cloud‑recording + transcript APIs instead.

Recommended: treat each as a **time‑boxed research spike** with its own mini‑plan and
a legal/FERPA review, *after* Workstreams 1–2. "Auto‑organization" (summarize/index a
recorded session into course materials) reuses the existing RAG ingest once a
transcript source exists. "Games" is the most self‑contained (a Discord‑native
quiz/flashcard bot over course materials) and could be an early, low‑risk win.

---

## 4. Cross‑cutting concerns
- **Secrets:** professor Canvas tokens are sensitive — Key Vault only, never the app DB
  or logs; the repo is public, so no identifiers/tokens in tracked files.
- **FERPA:** the Canvas client already strips enrollment emails; extend the same care
  to any dashboard data and recording features.
- **Migrations:** adopt a real migration step before UI‑driven onboarding.
- **Testing/observability:** onboarding + provisioning need integration tests
  (mock Discord/Canvas) and audit entries for every provisioning action.

## 5. Dependencies & blockers (start chasing now)
1. **JHU Canvas developer key** (root‑admin issued, read‑only scoped) — gates true
   self‑service Canvas onboarding (1b). Longest lead time.
2. **Domain** (in progress via the other RA) — only gates *custom‑domain* launch, not
   dev/testing (2).
3. **Discord bot re‑invite** with provisioning permissions (1c) — one‑time, per guild.

## 6. Recommended sequencing
1. **Now (unblocked):** extract `OnboardingService` + migration runner + Canvas‑token
   validation (1a); scaffold the Next.js app + Discord‑OAuth login + course‑list
   (2). In parallel, request the JHU Canvas developer key and re‑invite the bot.
2. **Next:** Discord auto‑provisioning (1c) + the guildId schema migration; dashboard
   connect‑Canvas / link‑Discord / ingest / status flows (2).
3. **Then:** Canvas OAuth2 flow once the key lands (1b); per‑course persona/config UI (1d).
4. **Later / research:** classroom features (3), JHU SSO auth swap, custom domain.

## 7. Open questions
- Confirm the four assumed decisions (A–D above).
- **Where does "class" happen** (Discord voice / Zoom / in‑person)? — gates Workstream 3.
- Is a single bot across many guilds acceptable (recommended), or one bot per course?
- Are all professors expected to have Discord accounts (affects auth choice A)?
- Who administers the dashboard allowlist (who can even log in) at launch?
