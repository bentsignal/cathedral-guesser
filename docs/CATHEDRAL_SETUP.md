# Set up The Cathedral yourself

This moves the existing bot deployment from Shawn's Server to The Cathedral. It does not support both servers simultaneously. No server or channel is deleted. The old test database is retained, and The Cathedral starts with a fresh database.

## 1. Install the bot

Open this link while signed into Discord:

https://discord.com/oauth2/authorize?client_id=1553236610722832406&scope=bot%20applications.commands&permissions=84992

Choose **The Cathedral**, then authorize. It requests View Channels, Send Messages, Embed Links, and Read Message History. Do not grant Administrator or Manage Messages.

## 2. Choose the channels

Create a private text channel such as `cathedral-guesser-admin-test`. Give your admin role and **Cathedral Guesser** access. Give the bot View Channel, Send Messages, Embed Links, and Read Message History there.

Choose a separate source channel. You can use `everything` immediately to test real historical picks while all puzzle posts remain private. Give the bot View Channel and Read Message History there; it does not need Send Messages in the source channel. Alternatively, use a separate private source channel with a few messages from human accounts.

In Server Settings → Roles, review the bot role and remove unnecessary server-wide posting permissions. Channel-specific permissions above can allow posting only in the game channel. No Administrator or Manage Messages permission is needed.

In Server Settings → Integrations → Cathedral Guesser, restrict command use to the private test channel during testing. Keep `/guesser-admin` restricted to admins/Manage Server.

## 3. Copy three IDs

Enable User Settings → Advanced → Developer Mode. Right-click to copy:

- The Cathedral → Copy Server ID (`GUILD_ID`).
- The source channel → Copy Channel ID (`SOURCE_CHANNEL_ID`).
- The private game channel → Copy Channel ID (`GAME_CHANNEL_ID`).

IDs are not bot tokens. Never paste the bot token into chat or GitHub.

## 4. Configure the existing deployment

In a terminal:

```sh
cd /Users/shawn/dev/cathedral-guesser
npx wrangler d1 create cathedral-guesser-cathedral-test
```

Copy the new database ID printed by that command. Edit `wrangler.jsonc`:

- Replace the three IDs in `vars` with the values copied above.
- Change the D1 `database_name` to `cathedral-guesser-cathedral-test` and `database_id` to the new ID. Keep `binding` as `DB`.
- Set `triggers` to `{ "crons": [] }` while testing. This prevents automatic daily posts.
- Keep the Worker name, account ID, application ID, public key, and time zone unchanged.

Apply the schema, then deploy:

```sh
npx wrangler d1 migrations apply cathedral-guesser-cathedral-test --remote
npx wrangler deploy
```

The existing Worker token secret and interactions URL remain valid. Do not reset the bot token or create another application. This deployment will stop accepting interactions from Shawn's Server because it is now configured for The Cathedral.

Set `GUILD_ID` in the ignored local `.dev.vars` file to The Cathedral's server ID, keeping the other values unchanged. Register its commands:

```sh
node --env-file=.dev.vars scripts/register-commands.mjs
```

Installing the bot alone is not enough: these configuration/deployment/registration steps are required.

## 5. Test privately

In the private game channel:

1. Run `/guesser-admin practice`.
2. Click Guess and select a person. The public result should appear only in this private channel.
3. Run `/guesser-admin finish-practice` to reveal the author and recap.
4. Run `/guesser-admin status` if a puzzle does not appear. Discord may need time to index historical messages; retry practice after the reported cooldown.

During this manual-only test, scheduled retries are paused too. Do not run `sync` unless you want it to create today's daily puzzle. Practice does not affect daily stats.

## 6. Go public later

Create/choose the public game channel and give the bot the same output-channel permissions. Set `GAME_CHANNEL_ID` to it and `SOURCE_CHANNEL_ID` to `everything` if not already selected.

For a completely clean launch, create a second fresh database (`cathedral-guesser-cathedral`), update the D1 binding to it, and apply its migrations just as above. This prevents private test rounds or cached source-channel information from carrying into the public game. Keep the private test database; no deletion is needed.

Restore `triggers` to `{ "crons": ["*/5 * * * *"] }` and deploy. The next scheduled tick (usually within five minutes) can post today's first puzzle; subsequent puzzles reset at midnight Eastern. Adjust the integration's command-channel permissions to the public game channel. Normal players use the Guess button, `/guesser stats`, and `/guesser leaderboard`.

Do not enable the schedule until you are ready for public posting. Keep the bot's source-channel access read-only.
