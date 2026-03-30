const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const path = require("path");
const { getProxyImageUrl } = require("../common/imageProxy");

const s3Client = new S3Client({
  region: process.env.AWS_REGION || "eu-north-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const S3_BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME || "mnt-ecommerce-2025";

/**
 * Upload file to S3
 * @param {Buffer} fileBuffer - File buffer
 * @param {string} fileName - Original file name
 * @param {string} mimeType - File MIME type
 * @returns {Promise<string>} - S3 file key
 */
const uploadToS3 = async (fileBuffer, fileName, mimeType) => {
  try {
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 15);
    const fileExtension = path.extname(fileName);
    const uniqueFileName = `items/${timestamp}-${randomString}${fileExtension}`;

    const command = new PutObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: uniqueFileName,
      Body: fileBuffer,
      ContentType: mimeType,
    });

    await s3Client.send(command);
    console.log(`✅ File uploaded to S3: ${uniqueFileName}`);
    return uniqueFileName;
  } catch (error) {
    console.error("❌ Error uploading to S3:", error);
    throw new Error("Failed to upload file to S3");
  }
};

/**
 * Delete file from S3
 * @param {string} fileKeyOrUrl - S3 file key or full URL
 * @returns {Promise<boolean>}
 */
const deleteFromS3 = async (fileKeyOrUrl) => {
  try {
    let key = fileKeyOrUrl;
    
    if (fileKeyOrUrl.includes("amazonaws.com/")) {
      key = fileKeyOrUrl.split("amazonaws.com/")[1].split("?")[0];
    } else if (fileKeyOrUrl.startsWith("http://") || fileKeyOrUrl.startsWith("https://")) {
      const url = new URL(fileKeyOrUrl);
      key = url.pathname.substring(1);
    }

    const command = new DeleteObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: key,
    });

    await s3Client.send(command);
    console.log(`✅ File deleted from S3: ${key}`);
    return true;
  } catch (error) {
    console.error("❌ Error deleting from S3:", error);
    return false;
  }
};

/**
 * Get proxy image URL (returns backend proxy URL instead of presigned URL)
 * @param {string} key - S3 file key or full URL
 * @param {number} expiresIn - Not used anymore (kept for backward compatibility)
 * @returns {string} - Backend proxy URL
 */
const getPresignedUrl = (key, expiresIn = 3600) => {
  // Use proxy URL instead of presigned URL
  return getProxyImageUrl(key);
};

module.exports = {
  uploadToS3,
  deleteFromS3,
  getPresignedUrl,
};
