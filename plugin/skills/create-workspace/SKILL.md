---
name: create-workspace
description: Create a new InTandem pair programming workspace. Use when the user wants to start a collaboration session with other Claude Code instances.
---

Create a new InTandem workspace:

1. Call `intandem_create` with the workspace name from $ARGUMENTS (or ask the user for one).
2. Display the join code prominently so the user can share it with teammates.
3. Check the board with `intandem_board` to see if there are existing tasks.
4. If the user described work to split, use `intandem_plan` to create and assign tasks.
