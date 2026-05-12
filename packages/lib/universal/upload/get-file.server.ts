import { DocumentDataType } from '@prisma/client';
import { base64 } from '@scure/base';
import { match } from 'ts-pattern';

import { getPresignGetUrl } from './server-actions';

export type GetFileOptions = {
  type: DocumentDataType;
  data: string;
};

export type GetFileStreamResult = {
  stream: ReadableStream<Uint8Array>;
  contentLength?: number;
};

export const getFileServerSide = async ({ type, data }: GetFileOptions) => {
  return await match(type)
    .with(DocumentDataType.BYTES, () => getFileFromBytes(data))
    .with(DocumentDataType.BYTES_64, () => getFileFromBytes64(data))
    .with(DocumentDataType.S3_PATH, async () => getFileFromS3(data))
    .exhaustive();
};

/**
 * D2DHQ fork: streaming variant of {@link getFileServerSide}. Returns a
 * `ReadableStream` so the recipient signing route can pipe bytes straight
 * from S3 → browser without buffering the full PDF on the Dokploy node.
 *
 * For an N-MB PDF this cuts time-to-first-byte from
 *   (S3 first-byte + full transfer + Dokploy first-byte)
 * down to
 *   (S3 first-byte).
 * pdfjs-dist can begin parsing the linearized PDF header while bytes are
 * still in flight.
 *
 * The non-S3 paths (BYTES / BYTES_64) materialize the buffer once and
 * wrap it in a single-chunk stream so call sites can use one code path.
 */
export const getFileStreamServerSide = async ({
  type,
  data,
}: GetFileOptions): Promise<GetFileStreamResult> => {
  if (type === DocumentDataType.S3_PATH) {
    const { url } = await getPresignGetUrl(data);
    const response = await fetch(url, { method: 'GET' });

    if (!response.ok || !response.body) {
      throw new Error(`Failed to get file "${data}", status ${response.status}`);
    }

    const contentLengthHeader = response.headers.get('content-length');
    const contentLength = contentLengthHeader ? Number(contentLengthHeader) : undefined;

    return {
      stream: response.body,
      contentLength: Number.isFinite(contentLength) ? contentLength : undefined,
    };
  }

  // BYTES / BYTES_64 — small enough that buffering is fine; wrap in a
  // one-chunk stream so the caller has a uniform interface.
  const bytes = await match(type)
    .with(DocumentDataType.BYTES, () => getFileFromBytes(data))
    .with(DocumentDataType.BYTES_64, () => getFileFromBytes64(data))
    .otherwise(() => {
      throw new Error(`Unsupported DocumentDataType ${type}`);
    });

  return {
    stream: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    contentLength: bytes.byteLength,
  };
};

const getFileFromBytes = (data: string) => {
  const encoder = new TextEncoder();

  const binaryData = encoder.encode(data);

  return binaryData;
};

const getFileFromBytes64 = (data: string) => {
  const binaryData = base64.decode(data);

  return binaryData;
};

const getFileFromS3 = async (key: string) => {
  const { url } = await getPresignGetUrl(key);

  const response = await fetch(url, {
    method: 'GET',
  });

  if (!response.ok) {
    throw new Error(`Failed to get file "${key}", failed with status code ${response.status}`);
  }

  const buffer = await response.arrayBuffer();

  const binaryData = new Uint8Array(buffer);

  return binaryData;
};
