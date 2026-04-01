---
name: board
description: View and manage the InTandem shared task board. Use when the user asks about tasks, progress, or what peers are working on.
---

Show the InTandem task board:

1. Call `intandem_board` to get the current task list.
2. Summarize the board state: how many tasks total, how many open/claimed/in-progress/done.
3. If the user wants to add tasks, use `intandem_add_task` or `intandem_plan` for multiple.
4. If the user wants to claim or update a task, use `intandem_claim_task` or `intandem_update_task`.
