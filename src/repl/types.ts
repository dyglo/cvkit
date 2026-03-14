export type MessageRole = 'input' | 'output' | 'error' | 'thinking';

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
}

export type CommandResult =
  | {type: 'empty'}
  | {type: 'output'; message: string}
  | {type: 'error'; message: string}
  | {type: 'exit'; message: string};
