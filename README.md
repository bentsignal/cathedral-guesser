# Cathedral Guesser

One message. One guess. Who said it?

A Discord-native daily guessing game on **Cloudflare Workers + D1**. No always-on server or Gateway connection is required.

## Playing

Every day at **midnight America/New_York** (including daylight saving changes), the bot posts a random historical text message. Click **Make my guess** to open your private member selector. Selecting a name submits your one and only answer.

- Each current human server member can guess once per puzzle.
- The private selector disappears after answering. Everyone else can still play.
- The bot posts a public 🟩/🟥 result without revealing the guessed name or author.
- The nightly recap lists **everyone who played**, with all correct players first and all incorrect players afterward. Long recaps are paginated.
- At the next reset, yesterday’s original post reveals the author, a link to the source message, and the number of correct players.
- Quotes redact user/role mentions, channel mentions, and links; they never ping anyone.
- `/guesser practice` creates an independent practice round. Practice never affects daily standings.

### Commands

| Command | Purpose |
| --- | --- |
| `/guesser play` | Open today’s private guessing menu |
| `/guesser help` | Rules and commands |
| `/guesser stats` | Your daily correct/incorrect totals and accuracy |
| `/guesser leaderboard` | Top ten by correct answers, with medals for the top three |
| `/guesser status` | Archive progress and last successful maintenance |
| `/guesser sync` | Admin: run one maintenance/import batch |
| `/guesser practice` | Admin: post a practice puzzle |
| `/guesser finish-practice` | Admin: reveal and recap the latest open practice round |

Administrative commands require **Manage Server** or Administrator permission. The bot itself does **not** need Administrator.

## How it works

Discord delivers signed HTTP interactions to `/interactions`. The Worker verifies Ed25519 signatures and rejects stale or mismatched requests, immediately acknowledges accepted interactions, then completes private responses asynchronously.

D1 holds the archive, rounds, guesses, import cursors, and short-lived maintenance locks. A unique `(round_id, user_id)` key plus a conditional insert enforces the one-guess rule atomically. Buttons never encode the author. Saved guesses are authoritative even if Discord temporarily fails to deliver the confirmation.

A five-minute Cron Trigger imports up to 100 messages, retries unpublished results, closes old rounds, and posts the current daily puzzle if needed. The midnight tick starts the new day; scheduling/network delays can postpone posting by a few minutes, but submissions against yesterday are rejected immediately at the date boundary.

Initial import walks **the entire configured channel history** before choosing the first daily puzzle. This prevents a biased first puzzle drawn only from recent messages. Normal import speed is about **1,200 messages/hour**. Afterward it catches up on new messages using an ID cursor. The bot does not enumerate unrelated channels or thread histories.

Eligible messages are ordinary text messages and replies by humans, with nonempty text and a safely rendered length of at most 3,500 characters. Attachment-only messages, bots, webhooks, system events, and oversized messages are excluded. Authors must still belong to the server when the puzzle is chosen. Selected source messages are fetched again to respect edits and deletions. Departed authors and deleted messages are marked ineligible. Unused eligible messages are sampled uniformly; after exhausting the pool, oldest-used messages are recycled.

Pending public posts use deterministic Discord nonces and recent-message recovery markers to reduce duplicates after delivery failures. Recovery checks the most recent 100 messages in the game channel; this is intended for a dedicated low-volume game channel, not a busy general chat. Cron retries persist across Worker restarts.

## Setup / deployment

Requires Node 24+, a Discord application, a Cloudflare account, and Wrangler authentication.

```sh
npm ci
npm run check
npx wrangler login
npx wrangler d1 create cathedral-guesser
```

Update `wrangler.jsonc` with your new database ID, guild/source/game channel IDs, Discord application ID and public key. These IDs and the verification public key are not credentials. The current checked-in configuration targets only the private testing server.

1. In the Discord developer portal, enable **Message Content Intent**. Presence and Server Members intents are unnecessary.
2. Install the bot with the `bot` and `applications.commands` scopes. Required permissions: **View Channels**, **Read Message History**, **Send Messages**, **Embed Links** (integer `84992`). Restrict channel access to the intended source and game channels if desired.
3. Store the bot token as a Worker secret:

   ```sh
   npx wrangler secret put DISCORD_TOKEN
   npm run db:migrate
   npm run deploy
   ```

4. Set the Discord application’s Interactions Endpoint URL to `https://YOUR-WORKER.workers.dev/interactions`. Discord must successfully verify the signed ping before saving.
5. Copy `.env.example` to `.dev.vars`, fill it locally, then register server commands:

   ```sh
   node --env-file=.dev.vars scripts/register-commands.mjs
   ```

6. Run `/guesser sync` in Discord or wait for the next scheduled tick. Check `/guesser status`; the puzzle appears after initial import is complete.

Never commit `.dev.vars`, `.env` files, credentials, downloaded message archives, or database exports. `.gitignore` excludes local secret files and Wrangler state. GitHub Actions only runs checks and a dry-run build; deployment credentials are not stored in GitHub.

## Moving to The Cathedral later

The testing deployment is intentionally isolated. Provision a **separate Worker and D1 database** for The Cathedral and set its guild and channel IDs. Install the same application there, register its guild commands, and switch the application’s interactions endpoint to that Worker when ready. A Discord application has one interactions endpoint: use a second Discord application to keep independent testing and production bots active simultaneously. Do not just replace the channel IDs on a database containing another server’s archive.

The production setup should restrict the bot to the everything channel and a dedicated game channel, then allow the initial import to finish. Existing testing scores should not carry over.

## Operations

- `/health` is a minimal HTTP liveness endpoint; it does not expose archive contents, answers, tokens, or database access.
- `/guesser status` reports the last successful scheduled/manual maintenance run.
- Use `npx wrangler tail` (requires tail permission) or the Cloudflare dashboard for runtime diagnostics.
- Cron is set to `*/5 * * * *`. Clear that array and deploy to pause automatic posting/import.
- Failed history requests do not advance the cursor. Failed result posts remain queued.
- Initial import rate is deliberately bounded to fit a small server within free-tier request/write budgets; actual limits depend on Cloudflare’s current plan and other account usage.
- No paid plan or always-running Railway service is required by this architecture.

## Development

```sh
npm run dev
npm run check
npx wrangler deploy --dry-run
```

Tests exercise real SQLite constraints, signature validation, date boundaries, archive cursors, rate-limit recovery, answer reveal, and durable result delivery. External Discord responses are mocked; live Discord testing is also needed after installation.

## Current testing deployment

The bot is installed in the private testing server, with a live daily puzzle in the dedicated game channel. See [verification notes](docs/VERIFICATION.md) for what was tested. Use `/guesser practice` followed by `/guesser finish-practice` to test the full loop without changing daily standings. Because it uses HTTP interactions without a Gateway connection, the bot may appear offline in Discord even while its buttons and commands work.
