const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const multer = require("multer");
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

// Generate presigned URL for secure access (expires in 1 hour by default)
const getPresignedUrl = async (key, expiresIn = 3600) => {
  if (!key) return null;
  
  // If it's already a full URL, extract the key
  if (key.startsWith('http://') || key.startsWith('https://')) {
    const bucketName = process.env.AWS_S3_BUCKET_NAME || "mnt-ecommerce-2025";
    const region = process.env.AWS_REGION || "eu-north-1";
    const s3UrlPattern = new RegExp(`https://${bucketName}\\.s3\\.${region}\\.amazonaws\\.com/(.+)`);
    const match = key.match(s3UrlPattern);
    
    if (match) {
      key = match[1]; // Extract the key
    } else {
      return key; // Return as-is if not an S3 URL
    }
  }
  
  const bucketName = process.env.AWS_S3_BUCKET_NAME || "mnt-ecommerce-2025";
  
  try {
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    });
    
    // Generate presigned URL that expires in specified seconds
    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn });
    return presignedUrl;
  } catch (error) {
    console.error("Error generating presigned URL:", error);
    return null;
  }
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

module.exports = { upload, uploadToS3, getPresignedUrl, deleteFromS3 };
