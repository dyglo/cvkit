export type ConfigValues = Record<string, string>;

export type ImageMetadata = {
  fileName: string;
  format: string;
  width: number;
  height: number;
  channels: number;
  channelLabel: string;
  colorMode: string;
  fileSizeBytes: number;
  hasAlpha: boolean;
  bitDepth: string;
};

export type AnnotationFormat = 'yolo' | 'coco' | 'pascal-voc';

export type ConvertFormat = 'yolo' | 'coco' | 'pascal-voc' | 'labelme' | 'cvat';

export type DatasetInspectResult = {
  datasetPath: string;
  imageCount: number;
  annotatedCount: number;
  unannotatedCount: number;
  formatBreakdown: Array<{label: string; count: number}>;
  annotationFormat: AnnotationFormat | null;
  mixedAnnotationFormats: boolean;
  classBreakdown: Array<{id: number; name: string; imageCount: number}>;
  totalSizeBytes: number;
};

export type ValidationIssueType =
  | 'Missing label'
  | 'Empty label'
  | 'Malformed line'
  | 'Out-of-bound box'
  | 'Invalid class ID'
  | 'JSON parse error'
  | 'Missing required keys'
  | 'Annotation image missing'
  | 'Zero-sized bbox'
  | 'XML parse error'
  | 'Missing required tags'
  | 'Invalid bounding box';

export type ValidationIssue = {
  file: string;
  type: ValidationIssueType;
  detail: string;
};

export type ValidationResult = {
  format: AnnotationFormat;
  scannedImages: number;
  validImages: number;
  issues: ValidationIssue[];
  fixedCount: number;
  manualReviewCount: number;
};

export type SplitResult = {
  outputDir: string;
  splits: Array<{
    name: 'train' | 'val' | 'test';
    percent: number;
    imageCount: number;
    classCounts: Record<string, number>;
  }>;
};

export type DuplicateGroup = {
  distance: number;
  files: string[];
};

export type DupesWorkerResult = {
  scanned: number;
  groups: DuplicateGroup[];
  total_dupes: number;
};

export type StatsWorkerResult = {
  channel_stats: Record<string, {mean: number; std: number}>;
  dimensions: Record<string, {min: number; max: number; mean: number}>;
  aspect_ratios: Record<string, number>;
  file_sizes: {
    min_kb: number;
    max_kb: number;
    mean_kb: number;
    median_kb: number;
  };
  scanned: number;
};

export type ConvertWorkerResult = {
  success: boolean;
  images_processed: number;
  annotations_converted: number;
  classes: string[];
  output_dir: string;
  dry_run: boolean;
  warnings: string[];
};

export type ConvertWorkerErrorPayload = Partial<ConvertWorkerResult> & {
  success?: false;
  error: string;
};
