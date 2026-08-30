import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export type ArtifactHead = {
  sizeBytes: number;
  checksum: string | null;
};

export interface ArtifactObjectStore {
  createUploadUrl(input: {
    objectKey: string;
    contentType: string;
    sizeBytes: number;
    checksum: string;
    expiresInSeconds: number;
  }): Promise<string>;
  headObject(objectKey: string): Promise<ArtifactHead>;
  deleteObject(objectKey: string): Promise<void>;
}

export type S3ArtifactStoreConfiguration = {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
};

export function createS3ArtifactObjectStore(
  configuration: S3ArtifactStoreConfiguration,
): ArtifactObjectStore {
  const client = new S3Client({
    endpoint: configuration.endpoint,
    region: configuration.region,
    forcePathStyle: configuration.forcePathStyle ?? Boolean(configuration.endpoint),
    credentials: {
      accessKeyId: configuration.accessKeyId,
      secretAccessKey: configuration.secretAccessKey,
    },
  });

  return {
    async createUploadUrl(input) {
      return getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: configuration.bucket,
          Key: input.objectKey,
          ContentType: input.contentType,
          ContentLength: input.sizeBytes,
          Metadata: { checksum: input.checksum },
        }),
        { expiresIn: input.expiresInSeconds },
      );
    },
    async headObject(objectKey) {
      const result = await client.send(
        new HeadObjectCommand({ Bucket: configuration.bucket, Key: objectKey }),
      );
      return {
        sizeBytes: Number(result.ContentLength ?? -1),
        checksum: result.Metadata?.checksum ?? null,
      };
    },
    async deleteObject(objectKey) {
      await client.send(new DeleteObjectCommand({ Bucket: configuration.bucket, Key: objectKey }));
    },
  };
}
