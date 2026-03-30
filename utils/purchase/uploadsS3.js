const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
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
  const allowedTypes = /jpeg|jpg|png|pdf|doc|docx|xls|xlsx/;
  const mimetype = allowedTypes.test(file.mimetype);
  const extname = allowedTypes.test(file.originalname.toLowerCase());

  if (mimetype && extname) {
    return cb(null, true);
  }
  cb(new Error("Only documents and images are allowed"));
};

const upload = multer({
  storage: storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB limit
  fileFilter: fileFilter,
});

// Upload file to S3
const uploadToS3 = async (file, folder = "purchase") => {
  const fileName = `${folder}/${Date.now()}-${file.originalname}`;
  const bucketName = process.env.AWS_S3_BUCKET_NAME || "mnt-ecommerce-2025";

  const params = {
    Bucket: bucketName,
    Key: fileName,
    Body: file.buffer,
    ContentType: file.mimetype,
  };

  try {
    await s3Client.send(new PutObjectCommand(params));
    console.log("✅ Upload successful:", fileName);
    return fileName; // Return just the key
  } catch (error) {
    console.error("❌ Error uploading to S3:", error);
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
      console.log("⚠️ Not an S3 URL, skipping delete:", key);
      return;
    }
  }
  
  const bucketName = process.env.AWS_S3_BUCKET_NAME || "mnt-ecommerce-2025";
  
  const params = {
    Bucket: bucketName,
    Key: key,
  };
  
  try {
    await s3Client.send(new DeleteObjectCommand(params));
    console.log("✅ Delete successful:", key);
  } catch (error) {
    console.error("❌ Error deleting from S3:", error);
  }
};

module.exports = { upload, uploadToS3, getPresignedUrl, deleteFromS3 };
