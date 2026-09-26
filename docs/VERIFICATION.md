# Verification

Verified September 25, 2026 in the private testing server.

- Deployed the Worker, D1 schema, and five-minute schedule on Cloudflare.
- Discord verified the signed interactions endpoint successfully.
- Imported all four source test messages and posted one daily puzzle.
- Tested the same practice round with both existing accounts: one incorrect guess and one correct guess.
- Confirmed private menus and confirmations stay private, while both public results appear in the game channel.
- Confirmed the first player’s submission does not stop the second player from answering.
- Confirmed selecting a bot is rejected without consuming a guess.
- Confirmed reopening a completed player’s menu refuses a second guess.
- Confirmed a non-admin cannot finish a practice round.
- Finished the practice round as server owner: original author revealed, original-message link shown, controls removed, and recap lists the correct player before the incorrect player.
- Daily guesses and daily standings were left unused for the owner’s testing.
- Cloudflare’s scheduled job ran successfully after deployment.
- Unsigned live endpoint requests return HTTP 401.
- Checked that the bot token is absent from tracked files; local secret file is ignored and has mode 0600.
- Automated tests and GitHub Actions pass.

The midnight transition is covered by date-boundary/DST tests and the same reveal path exercised in practice. A real midnight transition was not waited for during this session.

## September 26: copy cleanup and media

- Deployed media schema migration and optional `/guesser practice message:` argument.
- Updated nine existing puzzle/result/recap posts to the new concise layout, preserving scores.
- Tested targeted practice rounds against the user's uploaded PNG, MP4, and X post in the private game channel. Discord displayed the image, played the 48-second video inline, and showed the X author/content preview. All three rounds were left available for user testing.
- Checked the real YouTube oEmbed endpoint: a valid video produced metadata; an invalid video was rejected. YouTube playback in a live puzzle still needs a user-posted source sample.
- Typecheck and all 36 automated tests passed, covering link failures, redirect restrictions, preview metadata, media eligibility, concise output, and existing game behavior.
- Link checks establish availability at selection time; they cannot guarantee later uptime or detect every HTTP-200 error page. Native previews remain subject to provider/client restrictions.

## September 26: on-demand history sampling

- Replaced bulk history import with Discord search scoped to the configured source channel. Random month selection spans the oldest human message through today; dense periods are narrowed before choosing a result offset.
- Removed the copied message archive with migration 0004. Existing puzzles and scores are preserved. No paid services were enabled.
- Persisted search cooldowns for rate-limit and indexing responses; bounded search work per invocation and retries through existing Cron maintenance.
- Verified a live `/guesser-admin practice` with no source argument after dropping the archive: a random X-link puzzle posted successfully with its native preview.
- All 40 tests passed, including old/recent period selection, dense-period subdivision, request caps, cooldown persistence, former-member rejection, and daily repeat avoidance.
- Production-scale history has not yet been tested because the bot still targets the private test server.

## September 26: Cathedral private deployment

- User authorized API/CLI setup in The Cathedral, explicitly excluding computer-use navigation and all server deletion. Recorded this in AGENTS.md.
- Validated supplied server/source/private-output/future-output IDs through read-only API calls. Source and server sharing an ID is valid; the source is `everything`.
- Provisioned a separate D1 database for Cathedral private testing; retained the previous server's database. Deployed with an empty Cron schedule.
- Removed private-reply deletion. The selector becomes “Guess submitted.”; Discord DELETE and bulk-delete calls are blocked before any network request. Commands are upserted individually rather than bulk replaced.
- Posted and fetched one real randomly sampled practice puzzle in the private test channel. Confirmed the Guess button, application identity, and channel. Verified command registration and admin permissions, plus Worker health. No posts were sent to the future public channel.
- All 41 automated tests passed. User interaction testing in The Cathedral remains for the user; no server UI automation was performed.
