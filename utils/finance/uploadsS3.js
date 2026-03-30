const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getProxyImageUrl } = require("../common/imageProxy");
require("dotenv").config();

// Configure S3 Client
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Get proxy image URL (returns backend proxy URL instead of presigned URL)
const getPresignedUrl = (key, expiresIn = 3600) => {
  // Use proxy URL instead of presigned URL
  return getProxyImageUrl(key);
};

module.exports = { getPresignedUrl };
