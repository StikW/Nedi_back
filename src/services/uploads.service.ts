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
  private readonly courseBucketName: string;
  private readonly modulesBucketName: string;

  constructor(private readonly configService: ConfigService) {
    const region = this.configService.get<string>('AWS_REGION');
    const courseBucket = this.configService.get<string>('S3_BUCKET');
    const modulesBucket = this.configService.get<string>('S3_BUCKET_MODULES');
    
    if (!region || !courseBucket || !modulesBucket) {
      throw new Error('AWS_REGION, S3_BUCKET, and S3_BUCKET_MODULES environment variables are required');
    }
    
    this.s3Client = new S3Client({ region });
    this.courseBucketName = courseBucket;
    this.modulesBucketName = modulesBucket;
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
  async getModuleDownloadUrl(courseId: string, moduleId: string, fileKey: string): Promise<string> {
    // Validate that the fileKey belongs to the course and module
    const prefix = `courses/${courseId}/modules/${moduleId}/`;
    // Create the GetObject command
    const getObjectCommand = new GetObjectCommand({
      Bucket: this.modulesBucketName,
      Key: fileKey,
    });

    // Generate pre-signed URL valid for 60 seconds
    const downloadUrl = await getSignedUrl(this.s3Client, getObjectCommand, {
      expiresIn: 60, // 60 seconds
    });

    return downloadUrl;
  }

  /**
   * Delete all files in a module folder from S3
   * Note: S3 doesn't have "folders" - they're just prefixes. We need to delete all objects with the prefix.
   */
  async deleteModuleFolder(courseId: string, moduleId: string): Promise<number> {
    const prefix = `courses/${courseId}/modules/${moduleId}/`;
    let totalDeleted = 0;
    
    try {
      let continuationToken: string | undefined;
      
      do {
        // List objects with pagination
        const listCommand = new ListObjectsV2Command({
          Bucket: this.modulesBucketName,
          Prefix: prefix,
          MaxKeys: 1000, // Maximum objects per request
          ContinuationToken: continuationToken,
        });

        const listResult = await this.s3Client.send(listCommand);
        
        if (!listResult.Contents || listResult.Contents.length === 0) {
          break; // No more objects to delete
        }

        // Prepare delete requests for this batch
        const objectsToDelete = listResult.Contents.map(obj => ({
          Key: obj.Key!,
        }));

        // Delete this batch immediately
        const deleteCommand = new DeleteObjectsCommand({
          Bucket: this.modulesBucketName,
          Delete: {
            Objects: objectsToDelete,
          },
        });

        await this.s3Client.send(deleteCommand);
        totalDeleted += objectsToDelete.length;
        
        // Set continuation token for next iteration
        continuationToken = listResult.NextContinuationToken;
        
      } while (continuationToken);
      
      return totalDeleted;
    } catch (error) {
      console.error('Error deleting module folder from S3:', error);
      throw new Error(`Failed to delete module folder: ${error.message}`);
    }
  }
}
