# Agent workflow

- Complete changes end to end, including appropriate checks and deployment when requested.
- Commit and push completed milestones to GitHub without waiting for reminders.
- Never commit credentials, local environment files, or private Discord data.
- The Cathedral setup/deployment and scoped API reads/posts are authorized. Never use computer/browser UI automation inside that server.
- Never delete messages, channels, or other server data in The Cathedral, including bot messages. Exception explicitly authorized: dismiss only the bot’s completed ephemeral guess picker after verifying it is private and owned by this application. Do not run cleanup scripts against it. Do not grant destructive permissions. Preserve the existing test database.
- Live launch is authorized: daily puzzles/results/recaps go to channel 1387873171813957673 (#games). The private testing channel 1553417537457496154 is also authorized for ongoing practice tests, routed to its separate TEST_DB binding. Never copy testing puzzles or scores into the live database.
