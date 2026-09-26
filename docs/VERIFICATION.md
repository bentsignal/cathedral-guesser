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
