const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const multer = require("multer");
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

// Configure Multer for memory storage
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|svg|ico/;
  const mimetype = allowedTypes.test(file.mimetype);
  const extname = allowedTypes.test(file.originalname.toLowerCase());

  if (mimetype && extname) {
    return cb(null, true);
  }
  cb(new Error("Only image files (JPEG, PNG, SVG, ICO) are allowed"));
};

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: fileFilter,
});

// Upload file to S3
const uploadToS3 = async (file, folder = "web-settings") => {
  const fileName = `${folder}/${Date.now()}-${file.originalname}`;
  const bucketName = process.env.AWS_S3_BUCKET_NAME || "mnt-ecommerce-2025";
  const region = process.env.AWS_REGION || "eu-north-1";

  const params = {
    Bucket: bucketName,
    Key: fileName,
    Body: file.buffer,
    ContentType: file.mimetype,
  };

  try {
    console.log("Uploading to S3:", {
      bucket: bucketName,
      key: fileName,
      region,
    });
    await s3Client.send(new PutObjectCommand(params));
    
    console.log("Upload successful:", fileName);
    return fileName; // Return only the key/path
  } catch (error) {
    console.error("Error uploading to S3:", error);
    throw new Error("Failed to upload file to S3");
  }
};

// Get proxy image URL (returns backend proxy URL instead of presigned URL)
const getPresignedUrl = (key, expiresIn = 3600) => {
  // Use proxy URL instead of presigned URL
  return getProxyImageUrl(key);
};

// Delete file from S3
const deleteFromS3 = async (key) => {
  if (!key) return;
  
  // Extract key from URL if it's a full URL
  if (key.startsWith('http://') || key.startsWith('https://')) {
    const bucketName = process.env.AWS_S3_BUCKET_NAME || "mnt-ecommerce-2025";
    const region = process.env.AWS_REGION || "eu-north-1";
    const s3UrlPattern = new RegExp(`https://${bucketName}\\.s3\\.${region}\\.amazonaws\\.com/(.+)`);
    const match = key.match(s3UrlPattern);
    
    if (match) {
      key = match[1];
    } else {
      console.log("Not an S3 URL, skipping delete:", key);
      return;
    }
  }
  
  const bucketName = process.env.AWS_S3_BUCKET_NAME || "mnt-ecommerce-2025";
  
  const params = {
    Bucket: bucketName,
    Key: key,
  };
  
  try {
    console.log("Deleting from S3:", { bucket: bucketName, key });
    await s3Client.send(new DeleteObjectCommand(params));
    console.log("Delete successful:", key);
  } catch (error) {
    console.error("Error deleting from S3:", error);
  }
};

// Get S3 object (for streaming)
const getS3Object = async (key) => {
  if (!key) {
    throw new Error("S3 key is required");
  }

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

module.exports = { upload, uploadToS3, getPresignedUrl, deleteFromS3, getS3Object };
