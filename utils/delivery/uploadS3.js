const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const multer = require("multer");
require("dotenv").config();

console.log("AWS S3 Config (Delivery):", {
  region: process.env.AWS_REGION,
  bucket: process.env.AWS_S3_BUCKET_NAME,
  hasAccessKey: !!process.env.AWS_ACCESS_KEY_ID,
  hasSecretKey: !!process.env.AWS_SECRET_ACCESS_KEY,
});

const s3Client = new S3Client({
  region: process.env.AWS_REGION || "eu-north-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const storage = multer.memoryStorage();

const imageFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|webp/;
  const mimetype = allowedTypes.test(file.mimetype);
  const extname = allowedTypes.test(file.originalname.toLowerCase());

  if (mimetype && extname) {
    return cb(null, true);
  }
  cb(new Error("Only image files (JPEG, JPG, PNG, WEBP) are allowed"));
};

const documentFilter = (req, file, cb) => {
  // Allow all file types for delivery partner documents
  // No restrictions on file format
  cb(null, true);
};

const uploadProfilePhoto = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // Increased to 10MB
  fileFilter: imageFilter,
});

const uploadDocument = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: documentFilter,
});

const uploadToS3 = async (file, folder = "delivery-partners", subfolder = "") => {
  const timestamp = Date.now();
  const sanitizedFileName = file.originalname.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9.-]/g, "");
  const folderPath = subfolder ? `${folder}/${subfolder}` : folder;
  const fileName = `${folderPath}/${timestamp}-${sanitizedFileName}`;
  
  const bucketName = process.env.AWS_S3_BUCKET_NAME || "mnt-ecommerce-2025";

  const params = {
    Bucket: bucketName,
    Key: fileName,
    Body: file.buffer,
    ContentType: file.mimetype,
  };

  try {
    await s3Client.send(new PutObjectCommand(params));
    return fileName;
  } catch (error) {
    console.error("Error uploading to S3:", error);
    throw new Error(`Failed to upload file to S3: ${error.message}`);
  }
};

const uploadProfilePhotoToS3 = async (file, partnerId) => {
  return uploadToS3(file, "delivery-partners", `${partnerId}/profile-photo`);
};

const uploadAadharToS3 = async (file, partnerId) => {
  return uploadToS3(file, "delivery-partners", `${partnerId}/id-proofs/aadhar`);
};

const uploadLicenseToS3 = async (file, partnerId) => {
  return uploadToS3(file, "delivery-partners", `${partnerId}/id-proofs/license`);
};

const uploadVehicleRCToS3 = async (file, partnerId) => {
  return uploadToS3(file, "delivery-partners", `${partnerId}/vehicle-documents/rc`);
};

const uploadInsuranceToS3 = async (file, partnerId) => {
  return uploadToS3(file, "delivery-partners", `${partnerId}/vehicle-documents/insurance`);
};

const uploadPollutionCertToS3 = async (file, partnerId) => {
  return uploadToS3(file, "delivery-partners", `${partnerId}/vehicle-documents/pollution`);
};

const uploadIdProofToS3 = async (file, partnerId) => {
  return uploadToS3(file, "delivery-partners", `${partnerId}/id-proofs/other`);
};

const deleteFromS3 = async (fileUrl) => {
  try {
    let key = fileUrl;
    if (fileUrl.includes("amazonaws.com/")) {
      key = fileUrl.split("amazonaws.com/")[1].split("?")[0];
    }

    const bucketName = process.env.AWS_S3_BUCKET_NAME || "mnt-ecommerce-2025";

    await s3Client.send(new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key,
    }));
    
    return true;
  } catch (error) {
    console.error("Error deleting from S3:", error);
    throw new Error(`Failed to delete file from S3: ${error.message}`);
  }
};

const getPresignedUrl = async (key, expiresIn = 3600) => {
  if (!key) return null;
  
  if (key.includes('X-Amz-Algorithm') || key.includes('X-Amz-Signature')) {
    return key;
  }
  
  if (key.startsWith('http://') || key.startsWith('https://')) {
    const bucketName = process.env.AWS_S3_BUCKET_NAME || "mnt-ecommerce-2025";
    const region = process.env.AWS_REGION || "eu-north-1";
    const s3UrlPattern = new RegExp(`https://${bucketName}\\.s3\\.${region}\\.amazonaws\\.com/([^?]+)`);
    const match = key.match(s3UrlPattern);
    
    if (match) {
      key = decodeURIComponent(match[1]);
    } else {
      return key;
    }
  }
  
  const bucketName = process.env.AWS_S3_BUCKET_NAME || "mnt-ecommerce-2025";
  
  try {
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    });
    
    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn });
    return presignedUrl;
  } catch (error) {
    console.error("Error generating pre-signed URL:", error);
    return null;
  }
};

module.exports = {
  uploadProfilePhoto,
  uploadDocument,
  uploadProfilePhotoToS3,
  uploadAadharToS3,
  uploadLicenseToS3,
  uploadVehicleRCToS3,
  uploadInsuranceToS3,
  uploadPollutionCertToS3,
  uploadIdProofToS3,
  deleteFromS3,
  getPresignedUrl,
};
