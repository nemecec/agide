/** A command result that carries a picture. MCP maps it to an image content block, IPC passes it as JSON. */
export interface ImageResult {
  readonly type: 'image';
  readonly mimeType: 'image/png';
  /** Base64 of the PNG. */
  readonly data: string;
  readonly [key: string]: unknown;
}

export const isImageResult = (value: unknown): value is ImageResult =>
  typeof value === 'object' &&
  value !== null &&
  (value as { type?: unknown }).type === 'image' &&
  typeof (value as { data?: unknown }).data === 'string' &&
  (value as { mimeType?: unknown }).mimeType === 'image/png';
