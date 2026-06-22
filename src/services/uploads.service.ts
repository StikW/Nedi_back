import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface UploadUrlResponse {
  uploadUrl: string;
  fileKey: string;
}

@Injectable()
export class UploadsService {
  private readonly s3Client: S3Client;
  private readonly awsRegion: string;
  private readonly courseBucketName: string;
  private readonly modulesBucketName: string;

  constructor(private readonly configService: ConfigService) {
    const region = this.configService.get<string>('AWS_REGION');
    const courseBucket = this.configService.get<string>('S3_BUCKET');
    const modulesBucket = this.configService.get<string>('S3_BUCKET_MODULES');

    if (!region || !courseBucket || !modulesBucket) {
      throw new Error('AWS_REGION, S3_BUCKET, and S3_BUCKET_MODULES environment variables are required');
    }

    this.awsRegion = region;
    this.s3Client = new S3Client({ region });
    this.courseBucketName = courseBucket;
    this.modulesBucketName = modulesBucket;
  }

  /** Bucket de imagenes/recursos del curso (`S3_BUCKET` en .env). */
  getCourseBucketName(): string {
    return this.courseBucketName;
  }

  /** Bucket de PDFs de modulos (`S3_BUCKET_MODULES` en .env). */
  getModulesBucketName(): string {
    return this.modulesBucketName;
  }

  /** URL publica del bucket de recursos, derivada de .env. */
  getResourcesPublicBaseUrl(): string {
    return this.buildPublicBaseUrl(this.courseBucketName);
  }

  /** URL publica del bucket de modulos, derivada de .env. */
  getModulesPublicBaseUrl(): string {
    return this.buildPublicBaseUrl(this.modulesBucketName);
  }

  private buildPublicBaseUrl(bucketName: string): string {
    return `https://${bucketName}.s3.${this.awsRegion}.amazonaws.com`;
  }

  /**
   * Generate a pre-signed URL for uploading a file to S3 (original method)
   */
  async getUploadUrl(
    courseId: string,
    filename: string,
    contentType: string,
  ): Promise<UploadUrlResponse> {
    // Generate a unique file key with timestamp to avoid conflicts
    const timestamp = Date.now();
    
    // Sanitize filename: remove spaces, special chars, and ensure safe format
    const sanitizedFilename = filename
      .replace(/[^a-zA-Z0-9.-]/g, '_') // Replace special chars with underscore
      .replace(/_{2,}/g, '_') // Replace multiple underscores with single
      .replace(/^_+|_+$/g, '') // Remove leading/trailing underscores
      .toLowerCase(); // Convert to lowercase
    
    const fileKey = `courses/${courseId}/${timestamp}-${sanitizedFilename}`;

    // Create the PutObject command
    const putObjectCommand = new PutObjectCommand({
      Bucket: this.courseBucketName,
      Key: fileKey,
      ContentType: contentType,
    });

    // Generate pre-signed URL valid for 15 minutes
    const uploadUrl = await getSignedUrl(this.s3Client, putObjectCommand, {
      expiresIn: 900, // 15 minutes
    });

    return {
      uploadUrl,
      fileKey,
    };
  }

  /**
   * Generate a pre-signed URL for uploading module resources to S3
   */
  async getModuleUploadUrl(
    courseId: string,
    moduleId: string,
    filename: string,
    contentType: string,
  ): Promise<UploadUrlResponse> {
    // Generate a unique file key with timestamp to avoid conflicts
    const timestamp = Date.now();
    
    // Sanitize filename: remove spaces, special chars, and ensure safe format
    const sanitizedFilename = filename
      .replace(/[^a-zA-Z0-9.-]/g, '_') // Replace special chars with underscore
      .replace(/_{2,}/g, '_') // Replace multiple underscores with single
      .replace(/^_+|_+$/g, '') // Remove leading/trailing underscores
      .toLowerCase(); // Convert to lowercase
    
    const fileKey = `courses/${courseId}/modules/${moduleId}/${timestamp}-${sanitizedFilename}`;

    // Create the PutObject command
    const putObjectCommand = new PutObjectCommand({
      Bucket: this.modulesBucketName,
      Key: fileKey,
      ContentType: contentType,
    });

    // Generate pre-signed URL valid for 15 minutes
    const uploadUrl = await getSignedUrl(this.s3Client, putObjectCommand, {
      expiresIn: 900, // 15 minutes
    });

    return {
      uploadUrl,
      fileKey,
    };
  }

  /**
   * Generate a pre-signed URL for downloading a file from S3 (original method)
   */
  async getDownloadUrl(courseId: string, fileKey: string): Promise<string> {
    // Validate that the fileKey belongs to the course
    if (!fileKey.startsWith(`courses/${courseId}/`)) {
      throw new Error('Invalid file key for this course');
    }

    // Create the GetObject command
    const getObjectCommand = new GetObjectCommand({
      Bucket: this.courseBucketName,
      Key: fileKey,
    });

    // Generate pre-signed URL valid for 60 seconds
    const downloadUrl = await getSignedUrl(this.s3Client, getObjectCommand, {
      expiresIn: 60, // 60 seconds
    });

    return downloadUrl;
  }

  /**
   * Generate a pre-signed URL for downloading a module resource from S3
   */
  async getModuleDownloadUrl(
    courseId: string,
    moduleId: string,
    fileKey: string,
    expiresIn = 60,
  ): Promise<string> {
    const getObjectCommand = new GetObjectCommand({
      Bucket: this.modulesBucketName,
      Key: fileKey,
    });

    return getSignedUrl(this.s3Client, getObjectCommand, { expiresIn });
  }

  /**
   * Lista las keys de los archivos subidos a un modulo (bucket de modulos).
   * Usado por la vectorizacion para procesar PDF/TXT del modulo.
   */
  async listModuleFileKeys(courseId: string, moduleId: string): Promise<string[]> {
    const prefix = `courses/${courseId}/modules/${moduleId}/`;
    const keys: string[] = [];
    let continuationToken: string | undefined;

    do {
      const listResult = await this.s3Client.send(
        new ListObjectsV2Command({
          Bucket: this.modulesBucketName,
          Prefix: prefix,
          MaxKeys: 1000,
          ContinuationToken: continuationToken,
        }),
      );

      for (const obj of listResult.Contents || []) {
        // Ignorar "carpetas" (keys que terminan en /)
        if (obj.Key && !obj.Key.endsWith('/')) keys.push(obj.Key);
      }
      continuationToken = listResult.NextContinuationToken;
    } while (continuationToken);

    return keys;
  }

  /**
   * Descarga el contenido binario de un objeto del bucket de modulos.
   */
  async getModuleFileBuffer(key: string): Promise<Buffer> {
    const result = await this.s3Client.send(
      new GetObjectCommand({ Bucket: this.modulesBucketName, Key: key }),
    );
    const stream = result.Body as NodeJS.ReadableStream;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  /**
   * Delete all files in a module folder from S3 (bucket de módulos).
   */
  async deleteModuleFolder(courseId: string, moduleId: string): Promise<number> {
    const prefix = `courses/${courseId}/modules/${moduleId}/`;
    return this.deleteObjectsWithPrefix(this.modulesBucketName, prefix);
  }

  /**
   * Elimina todos los objetos del curso en ambos buckets (imagen del curso + restos de módulos).
   */
  async deleteCourseAssets(courseId: string): Promise<number> {
    const prefix = `courses/${courseId}/`;
    let total = 0;
    total += await this.deleteObjectsWithPrefix(this.courseBucketName, prefix);
    total += await this.deleteObjectsWithPrefix(this.modulesBucketName, prefix);
    return total;
  }

  /** Lista keys bajo un prefijo (para diagnósticos / E2E). */
  async listObjectsWithPrefix(bucket: string, prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;

    do {
      const listResult = await this.s3Client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          MaxKeys: 1000,
          ContinuationToken: continuationToken,
        }),
      );

      for (const obj of listResult.Contents || []) {
        if (obj.Key && !obj.Key.endsWith('/')) {
          keys.push(obj.Key);
        }
      }
      continuationToken = listResult.NextContinuationToken;
    } while (continuationToken);

    return keys;
  }

  private async deleteObjectsWithPrefix(bucket: string, prefix: string): Promise<number> {
    let totalDeleted = 0;

    try {
      let continuationToken: string | undefined;

      do {
        const listResult = await this.s3Client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            MaxKeys: 1000,
            ContinuationToken: continuationToken,
          }),
        );

        if (!listResult.Contents || listResult.Contents.length === 0) {
          break;
        }

        const objectsToDelete = listResult.Contents.map((obj) => ({
          Key: obj.Key!,
        }));

        await this.s3Client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: objectsToDelete },
          }),
        );
        totalDeleted += objectsToDelete.length;
        continuationToken = listResult.NextContinuationToken;
      } while (continuationToken);

      return totalDeleted;
    } catch (error: any) {
      console.error(`Error deleting S3 prefix ${prefix} in ${bucket}:`, error);
      throw new Error(`Failed to delete S3 prefix: ${error.message}`);
    }
  }
}
