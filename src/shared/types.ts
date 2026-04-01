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
  refs?: CodeReference[]; // structured code context attached to message
  encrypted?: boolean; // true if content is E2E encrypted
  signature?: string; // HMAC signature for sender verification
}

// Hub protocol messages (WebSocket frames)
export type HubMessage =
  | { kind: 'auth'; token: string; username: string; sessionId: string }
  | { kind: 'auth_ok'; workspace: WorkspaceInfo }
  | { kind: 'auth_fail'; reason: string }
  | { kind: 'peer_joined'; username: string; peers: string[] }
  | { kind: 'peer_left'; username: string; peers: string[] }
  | { kind: 'message'; payload: PeerMessage }
  | { kind: 'board'; tasks: TaskItem[] }
  | { kind: 'board_update'; task: TaskItem }
  | { kind: 'board_reject'; taskId: string; reason: string }
  | { kind: 'peers'; list: PeerInfo[] }
  | { kind: 'invite_register'; inviteCode: string } // register short invite code with hub
  | { kind: 'invite_resolve'; inviteCode: string } // client asks hub to resolve a short code
  | { kind: 'invite_result'; hubUrl: string; workspaceId: string; token: string } // hub responds
  | { kind: 'invite_fail'; reason: string }
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
  workingOn?: string; // what file/task they're focused on
}

export interface TaskItem {
  id: string;
  title: string;
  description?: string;
  status: 'open' | 'claimed' | 'in_progress' | 'done';
  assignee?: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
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
