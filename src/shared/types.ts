// Message types flowing between peers through the hub
export type MessageType = 'finding' | 'task' | 'question' | 'status' | 'handoff' | 'review' | 'chat';

export interface PeerMessage {
  type: MessageType;
  from: string;        // sender username
  to?: string;         // specific peer, or undefined for broadcast
  content: string;
  timestamp: number;
}

// Hub protocol messages (WebSocket frames)
export type HubMessage =
  | { kind: 'auth'; token: string; username: string }
  | { kind: 'auth_ok'; workspace: WorkspaceInfo }
  | { kind: 'auth_fail'; reason: string }
  | { kind: 'peer_joined'; username: string; peers: string[] }
  | { kind: 'peer_left'; username: string; peers: string[] }
  | { kind: 'message'; payload: PeerMessage }
  | { kind: 'board'; tasks: TaskItem[] }
  | { kind: 'board_update'; task: TaskItem }
  | { kind: 'peers'; list: PeerInfo[] }
  | { kind: 'error'; message: string };

export interface WorkspaceInfo {
  name: string;
  id: string;
  peers: string[];
  maxPeers: number;
}

export interface PeerInfo {
  username: string;
  connectedAt: number;
  currentTask?: string;
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
  hubUrl: string;        // primary URL (tunnel for joiners, local for creator)
  localUrl?: string;     // local hub URL (ws://127.0.0.1:<port>)
  workspaceId: string;
  token: string;
  username: string;
  workspaceName: string;
  isCreator?: boolean;
}
