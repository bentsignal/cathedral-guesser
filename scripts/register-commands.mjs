// Run with: node --env-file=.dev.vars scripts/register-commands.mjs
const {DISCORD_TOKEN, DISCORD_APPLICATION_ID, GUILD_ID}=process.env;
if (!DISCORD_TOKEN||!DISCORD_APPLICATION_ID||!GUILD_ID) throw new Error('Set DISCORD_TOKEN, DISCORD_APPLICATION_ID, and GUILD_ID');
const descriptions={play:'Make your one guess for today',help:'Learn how Cathedral Guesser works',stats:'See your daily guessing record',leaderboard:'See the server’s daily standings',status:'Check history import and bot health',sync:'Admin: import history and run daily maintenance',practice:'Admin: post a separate practice puzzle'};
const response=await fetch(`https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}/guilds/${GUILD_ID}/commands`,{
  method:'PUT',headers:{Authorization:`Bot ${DISCORD_TOKEN}`,'Content-Type':'application/json'},
  body:JSON.stringify([{name:'guesser',description:'One message. One guess. Who said it?',type:1,options:Object.entries(descriptions).map(([name,description])=>({type:1,name,description}))}]),
});
if (!response.ok) throw new Error(`Command registration failed (${response.status})`);
console.log('Registered /guesser commands in the configured test server.');
