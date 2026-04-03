import type { MessageType } from '../shared/types.js';

export const VALID_TYPES: MessageType[] = [
  'finding',
  'task',
  'question',
  'status',
  'handoff',
  'review',
  'chat',
  'context',
];

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
    description:
      'Join a teammate\'s workspace using their invite code (e.g. "ABC123" for local, "ABC123@host" for remote, or a full join code)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        code: { type: 'string' as const, description: 'Short invite code (ABC123 or ABC123@host) or full join code' },
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
        priority: {
          type: 'string' as const,
          enum: ['critical', 'high', 'medium', 'low'],
          description: 'Task priority (default: medium)',
        },
        depends_on: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description:
            'Task IDs that must complete before this task can start. Task will be created as "blocked" until all dependencies are done.',
        },
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
    name: 'intandem_unclaim_task',
    description: 'Release a claimed task back to open status so another peer can pick it up',
    inputSchema: {
      type: 'object' as const,
      properties: {
        task_id: { type: 'string' as const, description: 'The task ID to release' },
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
          enum: ['open', 'blocked', 'claimed', 'in_progress', 'done'],
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
              priority: {
                type: 'string' as const,
                enum: ['critical', 'high', 'medium', 'low'],
                description: 'Task priority (default: medium)',
              },
              depends_on: {
                type: 'array' as const,
                items: { type: 'string' as const },
                description: 'Task IDs this depends on (use IDs from earlier tasks in this plan)',
              },
            },
            required: ['title'],
          },
        },
      },
      required: ['tasks'],
    },
  },
  {
    name: 'intandem_share',
    description:
      'Share a code file or snippet with peers. Includes the actual code content so peers can see exactly what you are looking at.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        file: { type: 'string' as const, description: 'File path to share' },
        start_line: { type: 'number' as const, description: 'Start line number (optional, defaults to 1)' },
        end_line: { type: 'number' as const, description: 'End line number (optional, defaults to start+20)' },
        message: { type: 'string' as const, description: 'Context message explaining what to look at (optional)' },
        to: { type: 'string' as const, description: 'Specific peer (omit to share with all)' },
      },
      required: ['file'],
    },
  },
  {
    name: 'intandem_set_var',
    description:
      'Set a shared workspace variable. Use this to share discovered config, context, or state that all peers need (e.g., datasource UIDs, API endpoints, time ranges).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        key: { type: 'string' as const, description: 'Variable name (e.g., "grafana_uid", "time_range")' },
        value: { type: 'string' as const, description: 'Variable value' },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'intandem_get_var',
    description: 'Get a shared workspace variable. Use key "*" to list all variables.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        key: {
          type: 'string' as const,
          description: 'Variable name to look up, or "*" to list all',
        },
      },
      required: ['key'],
    },
  },
  {
    name: 'intandem_peers',
    description: 'See who is online in the workspace',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'intandem_activity_log',
    description:
      'View the workspace activity log — timestamped history of joins, leaves, task changes, messages, and other events',
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number' as const, description: 'Number of entries to show (default: 30)' },
      },
    },
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
