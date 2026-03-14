import type {PendingAIToolCall} from '../ai/loop.js';

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

export type ConfirmationRequest =
  | {
      type: 'write-overwrite';
      filePath: string;
      content: string;
    }
  | {
      type: 'ai-tool';
      pending: PendingAIToolCall;
      prompt: string;
    };

export type CommandResult =
  | {type: 'empty'}
  | {type: 'output'; message: string}
  | {type: 'error'; message: string}
  | {type: 'ai'; input: string}
  | {type: 'ai-confirm'; approved: boolean; pending: PendingAIToolCall}
  | {type: 'confirm'; message: string; request: ConfirmationRequest}
  | {type: 'exit'; message: string};
