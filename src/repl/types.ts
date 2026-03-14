export type MessageRole = 'input' | 'output' | 'error' | 'thinking';

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
}

export interface ImageListItem {
  path: string;
  format: string;
  dimensions: string;
}

export interface ConfirmationRequest {
  type: 'write-overwrite';
  filePath: string;
  content: string;
}

export type CommandResult =
  | {type: 'empty'}
  | {type: 'output'; message: string}
  | {type: 'error'; message: string}
  | {type: 'confirm'; message: string; request: ConfirmationRequest}
  | {type: 'exit'; message: string};
