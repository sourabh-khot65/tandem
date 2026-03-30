# Tandem

**Real-time pair programming between multiple Claude Code sessions.**

Tandem connects up to 5 Claude Code sessions into a shared workspace where they can exchange findings, divide tasks, ask questions, and coordinate work — the same way human pair programmers do, but between AI-assisted sessions.

```
  Teammate A's Claude        Teammate B's Claude        Teammate C's Claude
        |                          |                          |
   [MCP Channel]              [MCP Channel]              [MCP Channel]
     (stdio)                    (stdio)                    (stdio)
        |                          |                          |
   +---------+    WebSocket   +---------+    WebSocket   +---------+
   | Tandem  |<------------->| Tandem  |<------------->| Tandem  |
   | Channel |               |   Hub   |               | Channel |
   +---------+               +---------+               +---------+
                              (hosted by
                             workspace creator)
```

## Installation

```bash
npm install -g tandem-pair
```

Requires **Node.js 18+**. No other runtime dependencies.

## Quick Start

### 1. Create a workspace (one person does this)

```bash
tandem create --name "my-project"
```

Output:

```
  +================================+
  |          T A N D E M           |
  |   Pair Programming for Claude  |
  +================================+

  Creating workspace "my-project"...
  Your username: CosmicYoda

  Hub running on 127.0.0.1:9900
  Workspace: TNM-7kx9-Qp2R

  +------------------------------------------+
  |  Share this code with your team:          |
  |                                          |
  |  eyJoIjoid3M6Ly8xMjcuMC4wLjE6OTkw...   |
  |                                          |
  |  They run: tandem join <code>             |
  +------------------------------------------+

  .mcp.json configured
  Start Claude Code with: claude --dangerously-load-development-channels server:tandem

  Waiting for peers... (0/5 slots)
```

### 2. Join the workspace (teammates do this)

Copy the join code from the creator and run:

```bash
tandem join eyJoIjoid3M6Ly8xMjcuMC4wLjE6OTkw...
```

Output:

```
  Joined workspace
  Hub: ws://127.0.0.1:9900
  Your username: NeonNaruto
  .mcp.json configured

  Start Claude Code with:
  claude --dangerously-load-development-channels server:tandem
```

### 3. Start Claude Code (everyone does this)

```bash
claude --dangerously-load-development-channels server:tandem
```

That's it. Your Claude sessions are now connected.

## How It Works

When you start Claude Code with tandem configured, the MCP channel server:

1. Connects to the hub via WebSocket
2. Authenticates using the workspace token
3. Registers as a Claude Code [channel](https://code.claude.com/docs/en/channels-reference)
4. Forwards peer messages to Claude as `<channel>` events
5. Exposes tools so Claude can send messages back

Messages from peers arrive in Claude's context like this:

```xml
<channel source="tandem" peer="NeonNaruto" type="finding">
The bug is in OrderMapper.java line 42 — the null check is missing after the stream filter
</channel>
```

Claude sees this as collaboration context from a known peer, not as a raw instruction.

## Message Types

| Type | Purpose | Example |
|------|---------|---------|
| `finding` | Share a discovery | "The auth failure is caused by expired JWT tokens not being refreshed" |
| `task` | Assign or divide work | "I'll handle the service layer, you take the controller tests" |
| `question` | Ask peers something | "How does the patient validation pipeline work in this codebase?" |
| `status` | Progress update | "Done refactoring the auth module, all tests passing" |
| `handoff` | Transfer work with context | "Here's what I've done so far: [context]. Your turn on the API layer" |
| `review` | Code review feedback | "The edge case on line 15 needs a null guard" |
| `chat` | General conversation | "Should we use the existing mapper or write a new one?" |

## Tools Available to Claude

Once connected, Claude gets these tools automatically:

### `tandem_send`

Send a message to peers.

```
Arguments:
  type     - Message type (finding, task, question, status, handoff, review, chat)
  message  - The message content
  to       - (optional) Specific peer username. Omit to broadcast to all
```

### `tandem_board`

View the shared task board. Shows all tasks with their status and assignee.

### `tandem_add_task`

Add a new task to the shared board.

```
Arguments:
  title       - Task title
  description - (optional) Task description
```

### `tandem_claim_task`

Claim an open task from the board.

```
Arguments:
  task_id - The task ID (e.g., T-a1b2c3)
```

### `tandem_update_task`

Update a task's status.

```
Arguments:
  task_id - The task ID
  status  - New status (open, claimed, in_progress, done)
```

### `tandem_peers`

See who is currently online in the workspace.

## CLI Reference

### `tandem create`

Create and host a new workspace.

```bash
tandem create [options]

Options:
  --name <name>         Workspace name (default: tandem-session)
  --port <port>         Hub port (default: 9900)
  --host <host>         Hub host (default: 127.0.0.1)
  --max-peers <n>       Max peers, 1-5 (default: 5)
```

The hub runs on your machine. Keep this terminal open — closing it shuts down the workspace.

### `tandem join <code>`

Join an existing workspace using the share code.

```bash
tandem join eyJoIjoid3M6Ly8xMjcuMC4wLjE6OTkw...
```

This saves the connection config to `~/.tandem/config.json` and writes a `.mcp.json` entry in your current directory.

### `tandem status`

Show current workspace connection info.

```bash
tandem status
```

### `tandem leave`

Disconnect from the current workspace.

```bash
tandem leave
```

### `tandem whoami`

Show your auto-generated username.

```bash
tandem whoami
# Output: CosmicYoda
```

### `tandem rename <name>`

Change your username.

```bash
tandem rename SilentNaruto
```

### `tandem channel`

*Internal command.* Starts the MCP channel server. Called automatically by Claude Code via `.mcp.json` — you don't need to run this manually.

## Usernames

Tandem auto-generates pop culture usernames on first run, combining an adjective with a character:

```
CosmicYoda        SilentNaruto      NeonGandalf
LazyThor          WildSherlock      ChaoticBatman
ZenMorpheus       EpicAragorn       SlyFuriosa
RadiantAang       BoldRipley        SwiftLegolas
```

Your username persists in `~/.tandem/username`. Change it anytime with `tandem rename`.

## Configuration Files

| File | Purpose |
|------|---------|
| `~/.tandem/config.json` | Current workspace connection (hub URL, token, username) |
| `~/.tandem/username` | Your persistent username |
| `~/.tandem/data/<id>.db` | SQLite database per workspace (task board + message log) |
| `.mcp.json` | MCP server config in your project directory (auto-written) |

### `.mcp.json` Entry

Tandem writes this automatically when you `create` or `join`:

```json
{
  "mcpServers": {
    "tandem": {
      "command": "npx",
      "args": ["tandem-pair", "channel"]
    }
  }
}
```

## Security

### Workspace Tokens

Every workspace gets a cryptographically random 32-byte token. The join code encodes the hub URL + workspace ID + token in base64url. Only holders of the token can connect.

### Message Signing

Messages between peers are signed with HMAC-SHA256 using the workspace token. The channel server verifies signatures before forwarding to Claude Code.

### Content Sanitization

All peer message content is escaped to prevent XML/tag injection. Raw `<channel>` or `</channel>` tags in message content are neutralized so they can't break out of the structured format Claude sees.

### Sender Verification

The hub authenticates every WebSocket connection against the workspace token before allowing any messages through. Unauthenticated connections are closed after a 10-second timeout.

### Rate Limiting

- Maximum 5 peers per workspace
- Maximum 30 messages per minute per peer
- Exceeding the limit returns an error; messages are dropped, not queued

### Prompt Injection Prevention

Peer messages arrive in Claude's context inside structured `<channel>` tags with verified `peer` and `type` attributes. The channel's system instructions tell Claude to treat these as **collaboration context from known peers**, not as commands to execute. Combined with content sanitization, this prevents peers from injecting instructions that Claude would blindly follow.

## Architecture

```
src/
  shared/
    types.ts      # Protocol types (messages, tasks, hub frames)
    names.ts      # Pop culture username generator
    crypto.ts     # Token generation, join codes, HMAC signing, sanitization
    config.ts     # ~/.tandem/ config file management
  hub/
    server.ts     # WebSocket hub (routing, auth, rate limiting, peer mgmt)
    db.ts         # SQLite persistence (task board + message history)
  channel/
    server.ts     # MCP channel server (Claude Code <-> hub bridge)
  cli.ts          # CLI entry point
  index.ts        # Public API exports
```

### Data Flow

```
Teammate A types a prompt
    -> Claude A decides to share a finding
    -> Claude A calls tandem_send tool
    -> MCP channel server sends WebSocket frame to hub
    -> Hub verifies sender, logs message, routes to peers
    -> Teammate B's channel server receives the frame
    -> Channel server pushes <channel> notification to Claude B
    -> Claude B tells Teammate B about the finding
```

### Task Board

The shared task board persists in SQLite on the hub host's machine (`~/.tandem/data/<workspace-id>.db`). It survives hub restarts. Every peer sees the same board and can create, claim, and update tasks.

## Example Session

**Teammate A** (working on a bug):

```
You: Find why the login endpoint returns 500

Claude: I found the issue. The UserService.authenticate() method throws
when the session store is null. Let me share this with the team.

[Claude calls tandem_send with type="finding"]
> Sent finding to all peers: "Login 500 is caused by null session store
> in UserService.authenticate() at line 87. The Redis connection pool
> is exhausted under load."
```

**Teammate B** (sees the finding arrive):

```
<channel source="tandem" peer="CosmicYoda" type="finding">
Login 500 is caused by null session store in UserService.authenticate()
at line 87. The Redis connection pool is exhausted under load.
</channel>

Claude: CosmicYoda found the root cause — the Redis connection pool is
exhausted. I can work on fixing the pool configuration while they
handle the null safety. Want me to claim that task?

You: Yes, go ahead

[Claude calls tandem_claim_task and tandem_send with type="task"]
> Claimed task T-a1b2c3
> Sent task to all peers: "I'll fix the Redis pool config. CosmicYoda,
> you handle the null guard in UserService."
```

## Limitations

- **Research preview**: Claude Code channels require `--dangerously-load-development-channels` flag during the research preview period
- **Local network**: The hub binds to localhost by default. For remote teammates, use `--host 0.0.0.0` and ensure the port is reachable (or use a tunnel like ngrok)
- **No encryption in transit**: WebSocket connections use `ws://` (unencrypted) by default. For production use over the internet, put the hub behind a TLS-terminating reverse proxy
- **Hub is single point**: If the hub host goes down, all peers disconnect (they auto-reconnect when it comes back)
- **Channels auth**: Requires claude.ai login. Console and API key auth is not supported. Team/Enterprise orgs must explicitly enable channels

## Development

```bash
git clone https://github.com/sourabh-khot65/tandem.git
cd tandem
npm install
npm run build        # compile TypeScript
npm run dev          # watch mode
```

## License

MIT
