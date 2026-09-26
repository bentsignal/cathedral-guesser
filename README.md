# Cathedral Guesser

A daily, one-guess Discord game powered by Cloudflare Workers and D1.

The bot samples a historical message from one configured channel, lets each server member privately select its author, and publishes spoiler-free results. Answers are revealed when the next day begins.

## Architecture

- Discord HTTP interactions (no persistent Gateway connection).
- Cloudflare Worker for signed interactions and scheduled maintenance.
- D1 for resumable history import, daily rounds, and atomic one-guess enforcement.
- A private selector per player; the public play button remains available to others.
- Only current human server members are eligible authors and guesses.
- Credentials are stored as Worker secrets and never committed.

Implementation and deployment instructions will be added with the working bot.
