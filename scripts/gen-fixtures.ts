import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = process.cwd();

async function main(): Promise<void> {
  await generateSampleFixture();
  await generateSyntheticYoloFixture();
}

async function generateSampleFixture(): Promise<void> {
  const target = path.join(root, 'test', 'fixtures');
  await mkdir(target, {recursive: true});
  await sharp({
    create: {
      width: 100,
      height: 100,
      channels: 3,
      background: {r: 255, g: 0, b: 0}
    }
  })
    .png()
    .toFile(path.join(target, 'sample.png'));
}

async function generateSyntheticYoloFixture(): Promise<void> {
  const baseDir = path.join(root, 'test', 'fixtures', 'synthetic_yolo');
  const imagesDir = path.join(baseDir, 'images');
  const labelsDir = path.join(baseDir, 'labels');
  await mkdir(imagesDir, {recursive: true});
  await mkdir(labelsDir, {recursive: true});

  const colors = [
    {r: 255, g: 99, b: 71},
    {r: 255, g: 165, b: 0},
    {r: 255, g: 215, b: 0},
    {r: 60, g: 179, b: 113},
    {r: 64, g: 224, b: 208},
    {r: 70, g: 130, b: 180},
    {r: 123, g: 104, b: 238},
    {r: 199, g: 21, b: 133},
    {r: 220, g: 20, b: 60},
    {r: 112, g: 128, b: 144}
  ];

  for (let index = 0; index < 10; index += 1) {
    const fileName = `sample_${String(index + 1).padStart(2, '0')}.png`;
    await sharp({
      create: {
        width: 640,
        height: 640,
        channels: 3,
        background: colors[index]
      }
    })
      .png()
      .toFile(path.join(imagesDir, fileName));

    const labelLines = [
      `${index % 2} 0.5 0.5 0.25 0.25`,
      `${(index + 1) % 2} 0.25 0.25 0.18 0.18`
    ];

    if (index % 3 === 0) {
      labelLines.push(`${index % 2} 0.75 0.75 0.15 0.15`);
    }

    await writeFile(
      path.join(labelsDir, `${path.parse(fileName).name}.txt`),
      `${labelLines.join('\n')}\n`,
      'utf8'
    );
  }

  await writeFile(path.join(baseDir, 'classes.txt'), 'car\nperson\n', 'utf8');
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Fixture generation failed.';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
