import type {AIClient, AIResponse} from '../../src/lib/ai-client.js';

export type MockResponseStep = {
  response: AIResponse;
};

export type MockResponseScript =
  | MockResponseStep[]
  | ((body: Record<string, unknown>, callIndex: number) => MockResponseStep);

export class MockResponsesController {
  public readonly requests: Record<string, unknown>[] = [];
  private readonly steps: MockResponseScript;
  private callIndex = 0;

  constructor(steps: MockResponseScript) {
    this.steps = steps;
  }

  createClient(): AIClient {
    return {
      models: {
        generateContent: async (body: Record<string, unknown>) => {
          this.requests.push(body);
          const step = this.resolveStep(body, this.callIndex);
          this.callIndex += 1;
          return step.response;
        }
      }
    };
  }

  private resolveStep(body: Record<string, unknown>, callIndex: number): MockResponseStep {
    if (typeof this.steps === 'function') {
      return this.steps(body, callIndex);
    }

    const step = this.steps[callIndex];
    if (!step) {
      throw new Error(`No mock response configured for call ${callIndex + 1}.`);
    }

    return step;
  }
}

export function createFunctionCallResponse(
  callId: string,
  name: string,
  args: Record<string, unknown>
): MockResponseStep {
  return {
    response: {
      functionCalls: [
        {
          id: callId,
          name,
          args
        }
      ]
    }
  };
}

export function createMessageResponse(text: string): MockResponseStep {
  return {
    response: {
      text
    }
  };
}
