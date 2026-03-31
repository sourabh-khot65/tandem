import type { MessageType } from '../shared/types.js';

export const VALID_TYPES: MessageType[] = ['finding', 'task', 'question', 'status', 'handoff', 'review', 'chat'];

export const TOOL_DEFINITIONS = [
  {
    name: 'intandem_create',
    description:
      'Create a new pair programming workspace. Starts a hub and returns a join code to share with teammates. Works across machines automatically.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' as const, description: 'Workspace name (e.g., "fix-auth-bug")' },
        max_peers: { type: 'number' as const, description: 'Max teammates (1-5, default: 5)' },
      },
    },
  },
  {
    name: 'intandem_join',
    description: "Join a teammate's workspace using their share code",
    inputSchema: {
      type: 'object' as const,
      properties: {
        code: { type: 'string' as const, description: 'The join code from the workspace creator' },
      },
      required: ['code'],
    },
  },
  {
    name: 'intandem_send',
    description: 'Send a message to peers in the workspace',
    inputSchema: {
      type: 'object' as const,
      properties: {
        type: {
          type: 'string' as const,
          enum: VALID_TYPES,
          description: 'Message type: finding, task, question, status, handoff, review, or chat',
        },
        message: { type: 'string' as const, description: 'The message content' },
        to: { type: 'string' as const, description: 'Specific peer username (omit to broadcast to all)' },
      },
      required: ['type', 'message'],
    },
  },
  {
    name: 'intandem_board',
    description: 'View the shared task board',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'intandem_add_task',
    description: 'Add a new task to the shared board',
    inputSchema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string' as const, description: 'Task title' },
        description: { type: 'string' as const, description: 'Task description' },
      },
      required: ['title'],
    },
  },
  {
    name: 'intandem_claim_task',
    description: 'Claim a task from the shared board',
    inputSchema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string' as const, description: 'The task ID to claim' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'intandem_update_task',
    description: 'Update a task status on the shared board',
    inputSchema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string' as const, description: 'The task ID' },
        status: {
          type: 'string' as const,
          enum: ['open', 'claimed', 'in_progress', 'done'],
          description: 'New status',
        },
      },
      required: ['task_id', 'status'],
    },
  },
  {
    name: 'intandem_plan',
    description:
      'Create a work plan: multiple tasks at once, optionally assigned to peers. Use this when starting a collaborative session to break work into pieces.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tasks: {
          type: 'array' as const,
          description: 'List of tasks to create',
          items: {
            type: 'object' as const,
            properties: {
              title: { type: 'string' as const, description: 'Task title' },
              description: { type: 'string' as const, description: 'Task description' },
              assignee: { type: 'string' as const, description: 'Username to assign to (optional)' },
            },
            required: ['title'],
          },
        },
      },
      required: ['tasks'],
    },
  },
  {
    name: 'intandem_peers',
    description: 'See who is online in the workspace',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'intandem_leave',
    description: 'Disconnect from the current workspace',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'intandem_rejoin',
    description: 'Reconnect to a previously joined workspace using saved config (no join code needed)',
    inputSchema: { type: 'object' as const, properties: {} },
  },
];
