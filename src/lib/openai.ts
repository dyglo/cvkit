import OpenAI from 'openai';
import {loadConfig} from './config.js';

export const VISION_MODEL = 'gpt-5-mini-2025-08-07';
export const TEXT_MODEL = 'gpt-5-nano-2025-08-07';

let _client: OpenAI | null = null;
let _clientFactory: (() => OpenAI) | null = null;

export function getOpenAIClient(): OpenAI {
  if (_client) return _client;
  if (_clientFactory) {
    _client = _clientFactory();
    return _client;
  }
  const config = loadConfig();
  const apiKey = config.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OpenAI API key not set.\nRun: cvkit config set OPENAI_API_KEY=sk-...');
  }
  _client = new OpenAI({apiKey});
  return _client;
}

export function setOpenAIClientFactoryForTests(factory: (() => OpenAI) | null): void {
  _clientFactory = factory;
  _client = null;
}
