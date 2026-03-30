const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
require("dotenv").config();

// Configure S3 Client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || "eu-north-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

/**
 * Convert S3 key to image proxy URL
 * @param {string} key - S3 file key or full URL
 * @returns {string|null} - Image proxy URL (/image/...)
 */
const getProxyImageUrl = (key) => {
  if (!key) return null;
   
  // If already a proxy URL, return as-is
  if (key.startsWith('/image/')) {
    return key;
  }
  
  // If it's a full S3 URL, extract the key
  if (key.startsWith('http://') || key.startsWith('https://')) {
    const bucketName = process.env.AWS_S3_BUCKET_NAME || "mnt-ecommerce-2025";
    const region = process.env.AWS_REGION || "eu-north-1";
    const s3UrlPattern = new RegExp(`https://${bucketName}\\.s3\\.${region}\\.amazonaws\\.com/(.+)`);
    const match = key.match(s3UrlPattern);
    
    if (match) {
      key = match[1];
    } else {
      // Not an S3 URL, return as-is
      return key;
    }
  }
  
  // Return proxy URL path (ready for Next.js Image component)
  return `/image/${key}`;
};

/**
 * Get S3 object for streaming
 * @param {string} key - S3 file key
 * @returns {Promise<Object>} - S3 object response
 */
const getS3Object = async (key) => {
  if (!key) {
    throw new Error("S3 key is required");
  }

  // Decode if it's URL encoded
  key = decodeURIComponent(key);

  const bucketName = process.env.AWS_S3_BUCKET_NAME || "mnt-ecommerce-2025";

  const params = {
    Bucket: bucketName,
    Key: key,
  };

  try {
    const command = new GetObjectCommand(params);
    const response = await s3Client.send(command);
    return response;
  } catch (error) {
    console.error("Error getting S3 object:", error);
    throw new Error("Failed to get file from S3");
  }
};

module.exports = { 
  getProxyImageUrl, 
  getS3Object 
};
