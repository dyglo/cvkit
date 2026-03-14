import OpenAI from 'openai';
import {loadConfig} from './config.js';

export const PRIMARY_MODEL = 'gpt-5-mini-2025-08-07';
export const VISION_MODEL = PRIMARY_MODEL;
export const TEXT_MODEL = 'gpt-5-nano-2025-08-07';

type OpenAIClientFactory = () => OpenAI | Promise<OpenAI>;

let clientPromise: Promise<OpenAI> | null = null;
let testFactory: OpenAIClientFactory | null = null;

export async function getOpenAIClient(): Promise<OpenAI> {
  if (testFactory) {
    return await testFactory();
  }

  if (!clientPromise) {
    clientPromise = createOpenAIClient();
  }

  return await clientPromise;
}

export function normalizeOpenAIError(error: unknown): Error {
  const rawMessage = error instanceof Error ? error.message.trim() : 'Unexpected error';
  if (rawMessage.startsWith('OpenAI API error:')) {
    return new Error(rawMessage);
  }

  return new Error(`OpenAI API error: ${rawMessage || 'Unexpected error'}`);
}

export function setOpenAIClientFactoryForTests(factory: OpenAIClientFactory | null): void {
  testFactory = factory;
  clientPromise = null;
}

async function createOpenAIClient(): Promise<OpenAI> {
  const config = loadConfig();
  const apiKey = config.OPENAI_API_KEY || process.env.CVKIT_OPENAI_KEY;

  if (!apiKey) {
    throw new Error('OpenAI API key not set.\nRun: cvkit config set OPENAI_API_KEY=sk-...');
  }

  return new OpenAI({apiKey});
}
