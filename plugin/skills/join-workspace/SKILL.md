---
name: join-workspace
description: Join an existing InTandem workspace using a join code from a teammate. Use when the user pastes a join code or says they want to join a session.
---

Join an InTandem workspace:

1. Call `intandem_join` with the join code from $ARGUMENTS.
2. After connecting, call `intandem_board` to see what tasks exist.
3. If there are unclaimed tasks, claim one with `intandem_claim_task`.
4. Announce yourself with `intandem_send` (type: "status") describing what you'll work on.
