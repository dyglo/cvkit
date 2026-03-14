import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import React from 'react';
import {Box, Text} from 'ink';
import {Command} from 'commander';
import {renderOnce} from '../lib/render.js';
import {callStructuredVision} from '../lib/vision.js';

type AskOptions = {
  image: string;
  save?: string;
};

type AskPayload = {
  answer: string;
};

type AskResult = {
  imageName: string;
  question: string;
  answer: string;
  model: string;
  tokensUsed: number;
};

export function registerAsk(program: Command): void {
  program
    .command('ask')
    .description('Ask a question about an image')
    .argument('<question>', 'Question to answer from the image')
    .requiredOption('--image <path>', 'Image path')
    .option('--save <path>', 'Save the answer to a text file')
    .action(async (question: string, options: AskOptions) => {
      const result = await askImageQuestion(question, options.image);

      if (options.save) {
        const resolvedSavePath = path.resolve(options.save);
        await mkdir(path.dirname(resolvedSavePath), {recursive: true});
        await writeFile(resolvedSavePath, `${result.answer}\n`, 'utf8');
      }

      await renderOnce(<AskView result={result} />);
    });
}

export async function askImageQuestion(question: string, imagePath: string): Promise<AskResult> {
  const response = await callStructuredVision<AskPayload>({
    imagePath,
    prompt: [
      'You are a computer vision assistant.',
      `Answer this question about the image: ${question}`,
      'Return strict JSON only.',
      '{',
      '  "answer": "concise technical answer"',
      '}',
      'Reference only what is visible in the image and clearly state uncertainty when needed.'
    ].join('\n'),
    maxTokens: 1000
  });

  return {
    imageName: path.basename(imagePath),
    question,
    answer: String(response.data.answer ?? '').trim(),
    model: response.model,
    tokensUsed: response.tokensUsed
  };
}

function AskView({result}: {result: AskResult}): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Box paddingLeft={2}>
        <Text>{`Image:    ${result.imageName}`}</Text>
      </Box>
      <Box paddingLeft={2}>
        <Text>{`Question: ${result.question}`}</Text>
      </Box>
      <Divider />
      {result.answer
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => (
          <Box key={line} paddingLeft={2}>
            <Text>{line}</Text>
          </Box>
        ))}
      <Divider />
      <Box paddingLeft={2}>
        <Text>{`Model: ${result.model}  |  Tokens used: ${result.tokensUsed}`}</Text>
      </Box>
    </Box>
  );
}

function Divider(): React.JSX.Element {
  return (
    <Box paddingLeft={2}>
      <Text>─────────────────────────────────────────</Text>
    </Box>
  );
}
