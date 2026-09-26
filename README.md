# Cathedral Guesser

One message. Three guesses. Who sent it?

A Discord-native daily guessing game on **Cloudflare Workers + D1**. No always-on server or Gateway connection is required.

## Playing

Every day at **midnight America/New_York** (including daylight saving changes), the bot posts a random historical message, image, video, or link. Click **Guess** to open your private member selector. Selecting a name uses one attempt.

- Each player gets up to three guesses; a correct answer ends their round.
- The picker lists only current human members with more than 100 messages in the source channel, alphabetically in groups of 25 (up to 100 per page). Incorrect guesses show private progress and remove the chosen name. A correct guess replaces the private picker with a link to the original message. After three misses, the bot dismisses its private picker after verifying that it is an ephemeral response owned by this application. Channel messages are never deleted.
- A public result appears only after a correct answer or the third miss, e.g. “got it right in 2 guesses” followed by `🟥🟩⬜`. Guessed names stay private.
- The nightly recap lists **everyone who played**, with all correct players first and all incorrect players afterward. Long recaps are paginated.
- At the next reset, yesterday’s original post reveals the author, a link to the source message.
- Each new puzzle includes short excerpts of the immediately preceding and following messages, without before/after labels. An arrow and bold text mark the target; attachments use “See attachment below.” Each message shows its original date and time. Other speakers use their current display name (or account name if no longer a member); the target author is labeled `???`. Context links are shown as `[link]`, and attachments as `[Attachment]`. Command-like targets (slash commands and common bot prefixes) are excluded.
- Quotes redact user/role and channel mentions; they never ping anyone. Links remain clickable.
- `/guesser-admin practice` creates an independent practice round. Practice never affects daily standings.

### Commands

| Command | Purpose |
| --- | --- |
| `/guesser play` | Open today’s private guessing menu |
| `/guesser help` | Rules and commands |
| `/guesser stats` | Your daily correct/incorrect totals and accuracy |
| `/guesser leaderboard` | Top ten by correct answers, with medals for the top three |
| `/guesser-admin status` | History search and last successful maintenance |
| `/guesser-admin sync` | Admin: retry today’s puzzle and pending results |
| `/guesser-admin practice` | Admin: post a practice puzzle; optional `message` accepts a source message ID or link |
| `/guesser-admin finish-practice` | Admin: reveal and recap the latest open practice round |

Administrative commands live under `/guesser-admin` and are hidden by default from members without **Manage Server** or Administrator permission. The Worker also enforces these permissions when commands run. The bot itself does **not** need Administrator.

## How it works

Discord delivers signed HTTP interactions to `/interactions`. The Worker verifies Ed25519 signatures and rejects stale or mismatched requests, immediately acknowledges accepted interactions, then completes private responses asynchronously.

D1 holds selected puzzles, guesses, cached per-author message counts, a cached history start date, search cooldowns, and short-lived maintenance locks. It does not keep a copy of the source channel. Atomic attempt inserts validate the expected attempt count, reject repeat names and stale controls, and stop after a correct answer or three misses. A database trigger creates exactly one final result; incomplete players are recorded as incorrect at close. Buttons never encode the author. Saved guesses are authoritative even if Discord temporarily fails to deliver the confirmation.

A five-minute Cron Trigger retries unpublished results, closes old rounds, and posts the current daily puzzle if needed. Once the daily puzzle exists, it does not search for another one. The midnight tick starts the new day; scheduling/network delays can postpone posting by a few minutes, but submissions against yesterday are rejected immediately at the date boundary.

The bot uses Discord's search API, scoped to the source channel. It discovers the oldest human message with one search, then chooses a random month from that date through today. It requests a message count and jumps to a random result; unusually busy months are split into smaller date ranges to stay within Discord's offset limit. Older quiet periods get a chance alongside busy recent ones. Empty periods are retried within a bounded request budget; if no playable message is found, the next scheduled tick tries again.

There is no bulk import or channel replica. Search responses stay in memory; only the chosen puzzle is saved. Discord rate-limit and indexing responses persist a cooldown so later invocations also wait. New messages are available through Discord search without a separate import. Source and game channels remain independently configured.

Eligible messages are ordinary messages and replies by humans, containing text or image/video attachments, with safely rendered text of at most 3,500 characters. Authors must still be human members and have more than 100 messages in the source channel when selected. An optional source-scoped exclusion list in D1 state (`excluded_authors:CHANNEL_ID`, a JSON array of user IDs) removes manually excluded authors from both selection and choices. The same eligible-author IDs are saved with the round and used for its dropdown. Discord search supplies the counts without downloading channel history; qualifying counts are cached for seven days, other counts for one day. Refreshes check at most six members per invocation and honor search cooldowns. A new source needs its initial count check completed before its first puzzle; legacy rounds retain their original choices. The original message is fetched again to check edits, deletion, and current attachment URLs. Daily messages used in the past year are skipped; practice does not consume that history. Each attempt validates at most three candidates. The bot does not enumerate unrelated channels or threads.

Before selection, links are checked with bounded timeouts and safe redirects; inaccessible links are skipped for 24 hours. YouTube videos and X posts are verified through their official oEmbed endpoints. Other pages use HTTP availability and Open Graph metadata where available; this cannot detect every soft-error page. Messages support up to three links and four image/video attachments. Fresh attachment URLs are fetched from Discord. Native Discord previews and video players are preferred, with verified metadata as a fallback on a later maintenance tick when no native preview appears. Provider restrictions and Discord client preferences can affect previews.

Pending public posts use deterministic Discord nonces and recent-message recovery markers to reduce duplicates after delivery failures. Recovery checks the most recent 100 messages in the game channel; this is intended for a dedicated low-volume game channel, not a busy general chat. Cron retries persist across Worker restarts.

## Setup / deployment

Requires Node 24+, a Discord application, a Cloudflare account, and Wrangler authentication.

```sh
npm ci
npm run check
npx wrangler login
npx wrangler d1 create cathedral-guesser
```

Update `wrangler.jsonc` with your new database ID, guild/source/game channel IDs, Discord application ID and public key. These IDs and the verification public key are not credentials. The current checked-in configuration targets The Cathedral’s live `games` channel, with five-minute scheduled maintenance and a midnight Eastern daily reset.

1. In the Discord developer portal, enable **Message Content Intent** and **Server Members Intent**. The member picker uses the REST member-list endpoint; no Gateway connection or Presence intent is needed.
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

6. Run `/guesser-admin sync` or wait for the next scheduled tick. No history import is required. For a new source, repeat sync as needed to finish the bounded initial author-count checks, or let the enabled schedule do so. `/guesser-admin status` shows search readiness.

Never commit `.dev.vars`, `.env` files, credentials, downloaded message archives, or database exports. `.gitignore` excludes local secret files and Wrangler state. GitHub Actions only runs checks and a dry-run build; deployment credentials are not stored in GitHub.

## Live and testing data

The same bot and Worker now use the dedicated `cathedral-guesser-cathedral-live` D1 database. Live standings start empty. Only the source-history timestamp, author-count cache, exclusions and search cooldown were carried over; no testing puzzles, guesses or recaps were copied.

The former `cathedral-guesser-cathedral-test` database and private testing channel are preserved as archives. Interactions in the private testing channel route to the separate TEST_DB binding. Practice tests there do not affect live scores; automatic scheduled maintenance runs only against the live database. Practice rounds created in the live deployment still remain excluded from daily statistics.

## Operations

- `/health` is a minimal HTTP liveness endpoint; it does not expose archive contents, answers, tokens, or database access.
- `/guesser-admin status` reports the last successful scheduled/manual maintenance run.
- Use `npx wrangler tail` (requires tail permission) or the Cloudflare dashboard for runtime diagnostics.
- The schedule is `*/5 * * * *`; the first tick at midnight Eastern starts the new game day and closes yesterday’s puzzle.
- Rate-limited or indexing searches pause and retry automatically. Failed result posts remain queued.
- Search requests are bounded per run. No paid plan is enabled; free-tier usage is shared with other applications on the account.
- No paid plan or always-running Railway service is required by this architecture.

## Development

```sh
npm run dev
npm run check
npx wrangler deploy --dry-run
```

Tests exercise real SQLite constraints, signature validation, date boundaries, history sampling, rate-limit recovery, answer reveal, and durable result delivery. External Discord responses are mocked; live Discord testing is also needed after installation.

## Current live deployment

The bot sources `everything` and posts daily puzzles, results and recaps in `games` (channel `1387873171813957673`). The daily schedule is enabled. Earlier testing databases and channels remain untouched. See [verification notes](docs/VERIFICATION.md) for validation. Because it uses HTTP interactions without a Gateway connection, the bot may appear offline in Discord even while its buttons and commands work.

The Cathedral policy: no computer-use UI automation in the server, no message/channel deletion, and live posting only in the authorized `games` channel. The general Discord API helper blocks DELETE and bulk-delete requests. A separate, explicitly authorized helper may dismiss only this application’s completed ephemeral picker after verifying its private flag and author. Command registration upserts commands without bulk deletion.

Migration 0005 preserves existing rounds and results under their original one-guess rules. Newly created rounds use three guesses and context. Practice rounds remain excluded from daily stats.
