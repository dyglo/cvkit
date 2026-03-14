import {GoogleGenAI} from '@google/genai';
import {loadConfig} from './config.js';

export const VISION_MODEL = 'gemini-3-flash-preview';
export const TEXT_MODEL = 'gemini-3-flash-preview';

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

type AIClientFactory = () => AIClient | Promise<AIClient>;

let clientPromise: Promise<AIClient> | null = null;
let testFactory: AIClientFactory | null = null;

export async function getClient(): Promise<AIClient> {
  if (testFactory) {
    return await testFactory();
  }

  if (!clientPromise) {
    clientPromise = createClient();
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

  return new GoogleGenAI({apiKey}) as unknown as AIClient;
}
