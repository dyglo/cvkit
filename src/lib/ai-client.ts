import {GoogleGenAI, FunctionCallingConfigMode} from '@google/genai';
import {loadConfig} from './config.js';
import {MODELS} from './models.js';

export const VISION_MODEL = MODELS.FLASH_PREVIEW;
export const TEXT_MODEL = MODELS.FLASH_PREVIEW;

export type AIContentPart = {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  inlineData?: {
    data?: string;
    mimeType?: string;
  };
  functionCall?: {
    id?: string;
    name?: string;
    args?: Record<string, unknown>;
  };
  functionResponse?: {
    id?: string;
    name?: string;
    response?: Record<string, unknown>;
  };
};

export type AIContent = {
  role: 'user' | 'model';
  parts: AIContentPart[];
};

export interface AIResponse {
  text?: string;
  functionCalls?: Array<{
    id?: string;
    name?: string;
    args?: Record<string, unknown>;
  }>;
  usageMetadata?: {
    totalTokenCount?: number;
  };
  candidates?: Array<{
    content?: {
      parts?: AIContentPart[];
    };
  }>;
}

export interface AIClient {
  models: {
    generateContent: (params: Record<string, unknown>) => Promise<AIResponse>;
    generateContentStream?: (params: Record<string, unknown>) => Promise<AsyncIterable<AIResponse>>;
  };
}

export {FunctionCallingConfigMode};

type AIClientFactory = () => AIClient | Promise<AIClient>;

let clientPromise: Promise<AIClient> | null = null;
let testFactory: AIClientFactory | null = null;

export async function getClient(): Promise<AIClient> {
  if (testFactory) {
    return await testFactory();
  }

  if (!clientPromise) {
    clientPromise = createClient().catch((error: unknown) => {
      clientPromise = null;
      throw error;
    });
  }

  return await clientPromise;
}

export function normalizeAIError(error: unknown): Error {
  const rawMessage = error instanceof Error ? error.message.trim() : 'Unexpected error';
  if (rawMessage.startsWith('Gemini API error:')) {
    return new Error(rawMessage);
  }

  return new Error(`Gemini API error: ${rawMessage || 'Unexpected error'}`);
}

export function setClientFactoryForTests(factory: AIClientFactory | null): void {
  testFactory = factory;
  clientPromise = null;
}

async function createClient(): Promise<AIClient> {
  const config = loadConfig();
  const apiKey = config.GEMINI_API_KEY || process.env.GEMINI_API_KEY || process.env.CVKIT_GEMINI_KEY;

  if (!apiKey) {
    throw new Error('Gemini API key not set.\nRun: cvkit config set GEMINI_API_KEY=your-key');
  }

  const client = new GoogleGenAI({apiKey});

  return {
    models: {
      generateContent: async (params: Record<string, unknown>) =>
        (await client.models.generateContent(params as never)) as unknown as AIResponse,
      generateContentStream: async (params: Record<string, unknown>) =>
        (await client.models.generateContentStream(params as never)) as unknown as AsyncIterable<AIResponse>
    }
  };
}
