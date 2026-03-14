export type ToolStatus = 'success' | 'error' | 'not-found' | 'permission-denied';

export interface ToolResult {
  status: ToolStatus;
  output: string;
  data?: unknown;
  error?: string;
}
