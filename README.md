# InTandem

**Real-time pair programming between multiple Claude Code sessions.**

InTandem connects up to 5 Claude Code sessions into a shared workspace. Share findings, divide tasks, ask questions, and coordinate — all from inside Claude's terminal. Works across machines automatically.

## How It Looks

**Teammate A** (inside Claude Code):

```
You: Create an intandem workspace called fix-auth-bug

Claude: [calls intandem_create]
> Workspace "fix-auth-bug" created!
> Your username: CosmicYoda
>
> Share this join code with your teammates:
> eyJoIjoid3M6Ly8xMjcuMC4wLjE6OTkw...
>
> Tunnel: https://quiet-fish-42.loca.lt (works across machines/networks)
> Waiting for peers... (0/5 slots)
```

**Teammate B** (inside their Claude Code):

```
You: Join this intandem workspace: eyJoIjoid3M6Ly8xMjcuMC4wLjE6OTkw...

Claude: [calls intandem_join]
> Connected to "fix-auth-bug" as NeonNaruto!
> Peers online: CosmicYoda
```

**Now they're connected.** Claude A finds a bug:

```
Claude A: I found the issue — null session store in UserService line 87.
Let me share this with the team.

[calls intandem_send type="finding"]
> Sent finding to all peers
```

**Claude B receives it instantly:**

```
<channel source="intandem" peer="CosmicYoda" type="finding">
Null session store in UserService.authenticate() at line 87.
The Redis connection pool is exhausted under load.
</channel>

Claude B: CosmicYoda found the root cause. Want me to work on
fixing the Redis pool config while they handle the null guard?
```

## Setup

### 1. Install

```bash
npm install -g intandem
```

### 2. Initialize (in your project directory)

```bash
intandem init
```

This writes a `.mcp.json` entry and generates your username.

### 3. Start Claude Code

```bash
claude --dangerously-load-development-channels server:intandem
```

### 4. Create or join (inside Claude)

Tell Claude:

- **Create:** "Create an intandem workspace called fix-auth-bug"
- **Join:** "Join this intandem workspace: `<paste join code>`"

That's it. Everything else happens inside Claude.

## Remote / Cross-Machine

InTandem automatically opens a tunnel when you create a workspace. The join code contains the public URL — teammates on different machines or networks just paste the code and connect. No port forwarding, no IP addresses, no ngrok setup.

```
Machine A (San Francisco)          Machine B (New York)
┌──────────────────────┐          ┌──────────────────────┐
│ Claude Code          │          │ Claude Code          │
│                      │          │                      │
│ "Create workspace"   │          │ "Join: eyJo..."      │
│   ↓                  │          │   ↓                  │
│ Hub + auto-tunnel ───┼── wss ──┼─► Channel connects   │
│ https://xyz.loca.lt  │          │                      │
└──────────────────────┘          └──────────────────────┘
```

The tunnel is free and requires no account. It's powered by [localtunnel](https://github.com/localtunnel/localtunnel).

## What Claude Can Do

Once connected, Claude has these tools:

| Tool                   | What it does                                                                     |
| ---------------------- | -------------------------------------------------------------------------------- |
| `intandem_create`      | Create a workspace, get a join code to share                                     |
| `intandem_join`        | Join a workspace using a teammate's code                                         |
| `intandem_send`        | Send a message to peers (finding, task, question, status, handoff, review, chat) |
| `intandem_peers`       | See who's online                                                                 |
| `intandem_board`       | View the shared task board                                                       |
| `intandem_add_task`    | Add a task to the board                                                          |
| `intandem_claim_task`  | Claim a task                                                                     |
| `intandem_update_task` | Update a task's status                                                           |
| `intandem_leave`       | Disconnect                                                                       |

You don't call these tools directly — just talk to Claude naturally:

- "Share with the team that the bug is in the auth middleware"
- "What's on the task board?"
- "Claim the Redis pool task"
- "Tell NeonNaruto I'm done with the service layer"
- "Ask the team how the validation pipeline works"

## Message Types

| Type       | When to use                                                    |
| ---------- | -------------------------------------------------------------- |
| `finding`  | Discovered something: bug location, root cause, useful context |
| `task`     | Dividing work: "I'll do X, you do Y"                           |
| `question` | Asking peers: "How does X work?"                               |
| `status`   | Progress update: "Done with X, moving to Y"                    |
| `handoff`  | Transferring work with context                                 |
| `review`   | Code review feedback                                           |
| `chat`     | General conversation                                           |

## Usernames

InTandem auto-generates pop culture usernames on first run:

```
CosmicYoda     SilentNaruto     NeonGandalf     LazyThor
WildSherlock   ChaoticBatman    ZenMorpheus     EpicAragorn
SlyFuriosa     RadiantAang      BoldRipley      SwiftLegolas
```

Check yours: `intandem whoami`
Change it: `intandem rename SilentNaruto`

## CLI Reference

The CLI is minimal — just setup and identity. Everything else happens inside Claude.

```bash
intandem init              # Add to .mcp.json in current directory
intandem whoami            # Show your username
intandem rename <name>     # Change your username
```

## Security

- **Workspace tokens**: 32-byte cryptographic random token. Only holders can connect.
- **Content sanitization**: Peer messages are escaped to prevent tag injection.
- **Sender verification**: Hub authenticates every connection against the workspace token.
- **Rate limiting**: Max 5 peers, 30 messages/minute per peer.
- **Prompt injection prevention**: Messages arrive in structured `<channel>` tags with verified metadata. Claude treats them as collaboration context, not instructions.
- **Auto-tunnel**: Uses HTTPS/WSS when tunneled. Local connections use WS.

## Architecture

```
src/
  shared/
    types.ts      # Protocol types
    names.ts      # Username generator
    crypto.ts     # Tokens, join codes, HMAC, sanitization
    config.ts     # ~/.tandem/ config management
  hub/
    server.ts     # WebSocket hub (routing, auth, rate limiting)
    db.ts         # SQLite persistence (task board + message log)
  channel/
    server.ts     # All-in-one MCP server (hub + channel + tunnel)
  cli.ts          # CLI (init, whoami, rename)
  index.ts        # Public API
```

### How it works under the hood

1. `intandem init` writes a `.mcp.json` entry pointing to `npx intandem channel`
2. Claude Code spawns the MCP server as a subprocess on startup
3. The MCP server starts in idle mode with all tools available
4. When Claude calls `intandem_create`:
   - Starts a WebSocket hub on a random port
   - Opens a localtunnel for remote access
   - Connects to its own hub as a peer
   - Returns a join code containing the tunnel URL + workspace ID + token
5. When Claude calls `intandem_join`:
   - Decodes the join code
   - Connects to the remote hub via the tunnel URL
6. Messages flow: Claude A → MCP tools → WebSocket hub → MCP channel → Claude B
7. Task board persists in SQLite at `~/.tandem/data/`

## Limitations

- **Research preview**: Channels require `--dangerously-load-development-channels` flag
- **Hub is ephemeral**: When the creator's Claude session ends, the hub shuts down. Teammates auto-reconnect when a new session starts.
- **Tunnel reliability**: localtunnel is free but can occasionally be slow. For production teams, deploy the hub on a server instead.
- **Channels auth**: Requires claude.ai login. API key auth not supported.

## Development

```bash
git clone https://github.com/sourabh-khot65/tandem.git
cd tandem
npm install
npm run build
npm run dev          # watch mode
```

## License

MIT
