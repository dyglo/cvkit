// Model strings verified at https://ai.google.dev/gemini-api/docs/models
// Always verify these before use — Gemini preview model names can change frequently.
export const MODELS = {
  FLASH_PREVIEW: 'gemini-3-flash-preview',
  FLASH: 'gemini-2.5-flash',
  PRO: 'gemini-2.5-pro'
} as const;

export type ModelKey = keyof typeof MODELS;

export function getModel(key: ModelKey): string {
  return MODELS[key];
}
