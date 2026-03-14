import type OpenAI from 'openai';

export type MockResponseStep = {
  response: {
    id: string;
    output: Array<Record<string, unknown>>;
  };
  deltas?: string[];
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

  createClient(): OpenAI {
    return {
      responses: {
        stream: (body: Record<string, unknown>) => {
          this.requests.push(body);
          const step = this.resolveStep(body, this.callIndex);
          this.callIndex += 1;
          return new FakeResponseStream(step);
        }
      }
    } as unknown as OpenAI;
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
  responseId: string,
  callId: string,
  name: string,
  args: Record<string, unknown>
): MockResponseStep {
  return {
    response: {
      id: responseId,
      output: [
        {
          type: 'function_call',
          id: `${callId}-item`,
          call_id: callId,
          name,
          arguments: JSON.stringify(args),
          status: 'completed'
        }
      ]
    }
  };
}

export function createMessageResponse(
  responseId: string,
  text: string,
  deltas?: string[]
): MockResponseStep {
  return {
    response: {
      id: responseId,
      output: [
        {
          type: 'message',
          id: `${responseId}-message`,
          status: 'completed',
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text,
              annotations: []
            }
          ]
        }
      ]
    },
    deltas
  };
}

class FakeResponseStream {
  private readonly listeners = new Map<string, Array<(event: {delta: string}) => void>>();
  private readonly step: MockResponseStep;

  constructor(step: MockResponseStep) {
    this.step = step;
  }

  on(event: string, listener: (event: {delta: string}) => void): this {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  async finalResponse(): Promise<MockResponseStep['response']> {
    for (const delta of this.step.deltas ?? []) {
      for (const listener of this.listeners.get('response.output_text.delta') ?? []) {
        listener({delta});
      }
    }

    return this.step.response;
  }
}
