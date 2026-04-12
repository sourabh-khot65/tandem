// Message types flowing between peers through the hub
export type MessageType = 'finding' | 'task' | 'question' | 'status' | 'handoff' | 'review' | 'chat' | 'context';

export interface CodeReference {
  file: string;
  startLine?: number;
  endLine?: number;
  snippet?: string; // code excerpt
  language?: string;
}

export interface PeerMessage {
  type: MessageType;
  from: string; // sender username
  to?: string; // specific peer, or undefined for broadcast
  content: string;
  timestamp: number;
  msgId?: string; // unique message ID for delivery receipts
  refs?: CodeReference[]; // structured code context attached to message
  encrypted?: boolean; // true if content is E2E encrypted
  signature?: string; // HMAC signature for sender verification
}

// Hub protocol messages (WebSocket frames)
export type HubMessage =
  | { kind: 'auth'; token: string; username: string; sessionId: string }
  | { kind: 'auth_ok'; workspace: WorkspaceInfo; username: string; token: string }
  | { kind: 'auth_fail'; reason: string }
  | { kind: 'peer_joined'; username: string; peers: string[] }
  | { kind: 'peer_left'; username: string; peers: string[] }
  | { kind: 'message'; payload: PeerMessage }
  | { kind: 'board'; tasks: TaskItem[] }
  | { kind: 'board_update'; task: TaskItem; triggeredBy?: string }
  | { kind: 'board_reject'; taskId: string; reason: string }
  | { kind: 'peers'; list?: PeerInfo[] }
  | { kind: 'invite_register'; inviteCode: string } // register short invite code with hub
  | { kind: 'invite_resolve'; inviteCode: string } // client asks hub to resolve a short code
  | { kind: 'invite_result'; hubUrl: string; workspaceId: string; token: string } // hub responds
  | { kind: 'invite_fail'; reason: string }
  | { kind: 'capabilities'; username: string; cwd: string; tools: string[] }
  | { kind: 'msg_ack'; msgId: string; deliveredTo: string[] }
  | { kind: 'var_set'; key: string; value: string; setBy: string }
  | { kind: 'var_get'; key: string }
  | { kind: 'var_result'; key: string; value: string | null; setBy?: string }
  | { kind: 'vars_list'; vars: Array<{ key: string; value: string; setBy: string }> }
  | { kind: 'activity_log_request'; limit?: number }
  | { kind: 'activity_log'; entries: Array<{ timestamp: number; actor: string; action: string; detail?: string }> }
  | { kind: 'finding_submit'; finding: Finding }
  | { kind: 'finding_broadcast'; finding: Finding }
  | { kind: 'findings_request'; severity?: FindingSeverity; service?: string }
  | { kind: 'findings_list'; findings: Finding[] }
  | { kind: 'error'; message: string };

export interface WorkspaceInfo {
  name: string;
  id: string;
  peers: string[];
  maxPeers: number;
  inviteCode?: string; // short human-readable invite code
}

export interface PeerInfo {
  username: string;
  connectedAt: number;
  lastActiveAt: number; // timestamp of last message/action
  workingOn?: string; // what file/task they're focused on
}

export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';

export interface TaskItem {
  id: string;
  title: string;
  description?: string;
  status: 'open' | 'blocked' | 'claimed' | 'in_progress' | 'done' | 'failed';
  priority?: TaskPriority;
  assignee?: string;
  dependsOn?: string[]; // task IDs that must complete first
  result?: string; // outcome/findings when task is done
  error?: string; // optional error message if task failed
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface FindingPattern {
  pattern: string;
  count: number;
  source?: string;
}

export interface Finding {
  id: string;
  service: string;
  severity: FindingSeverity;
  summary: string; // what was found — the main content
  category?: string;
  count?: number; // generic count (errors, warnings, occurrences, affected records)
  patterns?: FindingPattern[];
  recommendation?: string;
  taskId?: string; // link to related task
  reportedBy: string;
  timestamp: number;
}

// Workspace config stored locally after create/join
export interface WorkspaceConfig {
  hubUrl: string; // primary URL (tunnel for joiners, local for creator)
  localUrl?: string; // local hub URL (ws://127.0.0.1:<port>)
  workspaceId: string;
  token: string;
  username: string;
  workspaceName: string;
  isCreator?: boolean;
  maxPeers?: number;
  inviteCode?: string; // short invite code for easy sharing
}