// Model strings verified at https://platform.openai.com/docs/models
// Always verify these before use — OpenAI updates model names frequently
export const MODELS = {
  NANO: 'gpt-5-nano-2025-08-07',
  MINI: 'gpt-5-mini-2025-08-07',
  POWER: 'gpt-5.4'
} as const;

export type ModelKey = keyof typeof MODELS;

export function getModel(key: ModelKey): string {
  return MODELS[key];
}
