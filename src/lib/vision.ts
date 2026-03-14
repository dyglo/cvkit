import fs from 'fs';
import path from 'path';

export function imageToBase64(imagePath: string): string {
  const ext = path.extname(imagePath).slice(1).toLowerCase();
  const mimeMap: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg',
    png: 'image/png', webp: 'image/webp',
    gif: 'image/gif', bmp: 'image/bmp',
  };
  const mime = mimeMap[ext] ?? 'image/jpeg';
  const data = fs.readFileSync(imagePath).toString('base64');
  return `data:${mime};base64,${data}`;
}

export async function callVision(
  prompt: string,
  imagePath: string,
  maxTokens = 1000
): Promise<string> {
  const {getOpenAIClient, VISION_MODEL} = await import('./openai.js');
  const client = getOpenAIClient();
  const base64 = imageToBase64(imagePath);
  const response = await client.chat.completions.create({
    model: VISION_MODEL,
    max_tokens: maxTokens,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: base64 } },
      ],
    }],
  });
  return response.choices[0]?.message?.content ?? '';
}
