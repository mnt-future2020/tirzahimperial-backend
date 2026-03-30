const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const multer = require("multer");
const { getProxyImageUrl } = require("../common/imageProxy");
require("dotenv").config();

// Configure S3 Client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || "eu-north-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Configure Multer for memory storage
const storage = multer.memoryStorage();

// File filter for images only
const imageFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|webp|gif/;
  const mimetype = allowedTypes.test(file.mimetype);
  const extname = allowedTypes.test(file.originalname.toLowerCase());

  if (mimetype && extname) {
    return cb(null, true);
  }
  cb(new Error("Only image files (JPEG, JPG, PNG, WEBP, GIF) are allowed"));
};

// Multer upload configuration for images
const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: imageFilter,
});

// Upload file to S3 (accepts buffer, filename, mimetype)
const uploadToS3 = async (buffer, originalname, mimetype) => {
  const fileName = `online/${Date.now()}-${originalname.replace(/\s+/g, "-")}`;
  const bucketName = process.env.AWS_S3_BUCKET_NAME || "mnt-ecommerce-2025";

  const params = {
    Bucket: bucketName,
    Key: fileName,
    Body: buffer,
    ContentType: mimetype,
  };

  try {
    await s3Client.send(new PutObjectCommand(params));
    return fileName;
  } catch (error) {
    console.error("Error uploading to S3:", error);
    throw new Error(`Failed to upload file to S3: ${error.message}`);
  }
};

// Delete file from S3
const deleteFromS3 = async (fileUrl) => {
  try {
    let key = fileUrl;
    if (fileUrl.includes("amazonaws.com/")) {
      key = fileUrl.split("amazonaws.com/")[1];
    }

    const bucketName = process.env.AWS_S3_BUCKET_NAME || "mnt-ecommerce-2025";

    const params = {
      Bucket: bucketName,
      Key: key,
    };

    await s3Client.send(new DeleteObjectCommand(params));
    return true;
  } catch (error) {
    console.error("Error deleting from S3:", error);
    throw new Error(`Failed to delete file from S3: ${error.message}`);
  }
};

// Get proxy image URL (returns backend proxy URL instead of presigned URL)
const getPresignedUrl = (key, expiresIn = 3600) => {
  // Use proxy URL instead of presigned URL
  return getProxyImageUrl(key);
};

module.exports = {
  upload,
  uploadToS3,
  deleteFromS3,
  getPresignedUrl,
  s3Client,
};
