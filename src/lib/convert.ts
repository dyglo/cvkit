import type {ConvertFormat} from '../types/index.js';

export const SUPPORTED_CONVERT_FORMATS = ['yolo', 'coco', 'pascal-voc', 'labelme', 'cvat'] as const;

export function isConvertFormat(value: string): value is ConvertFormat {
  return SUPPORTED_CONVERT_FORMATS.includes(value as ConvertFormat);
}

export function parseConvertFormat(value: string): ConvertFormat {
  if (isConvertFormat(value)) {
    return value;
  }

  throw new Error(`Unsupported format "${value}". Supported formats: ${formatList()}`);
}

export function formatPairLabel(fromFormat: ConvertFormat, toFormat: ConvertFormat): string {
  return `${fromFormat} → ${toFormat}`;
}

export function formatList(): string {
  return SUPPORTED_CONVERT_FORMATS.join(', ');
}
