import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();

async function main(): Promise<void> {
  await generateSampleFixture();
}

async function generateSampleFixture(): Promise<void> {
  const target = path.join(root, 'test', 'fixtures');
  await mkdir(target, {recursive: true});

  const image = sharp({
    create: {
      width: 100,
      height: 100,
      channels: 3,
      background: {r: 78, g: 205, b: 196}
    }
  });

  await Promise.all([
    image
      .clone()
      .jpeg({quality: 90})
      .toFile(path.join(target, 'sample.jpg')),
    image
      .clone()
      .png()
      .toFile(path.join(target, 'sample.png'))
  ]);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Fixture generation failed.';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
