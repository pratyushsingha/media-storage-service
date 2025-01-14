import { Router } from "express";
import fs from "fs";
import { upload } from "../utils/multer.js";
import { IndexFacesCommand } from "@aws-sdk/client-rekognition";
import { rekognitionClient } from "../utils/rekognition.js";
import path from "path";
import Queue from "bull";
import sharp from "sharp";

const router = Router();

const imageProcessingQueue = new Queue("image-processing", {
  redis: { host: "localhost", port: 6379 },
});

const storageDirectory = path.join(process.cwd(), "media_storage");

// Target file size in bytes (450KB as middle point between 400-500KB)
const TARGET_FILE_SIZE = 450 * 1024;
const MIN_FILE_SIZE = 400 * 1024;
const MAX_FILE_SIZE = 500 * 1024;

// Initial compression options
const getCompressionOptions = (quality = 80) => ({
  jpeg: {
    quality,
    chromaSubsampling: "4:4:4",
  },
  png: {
    quality,
    palette: true,
    compressionLevel: 9,
  },
  webp: {
    quality,
    effort: 6,
  },
});

router.route("/upload").post(upload.single("image"), async (req, res) => {
  const albumPin = req.body.albumPin;
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: "No image uploaded." });
  }

  if (!albumPin) {
    return res.status(400).json({ error: "Album PIN is required." });
  }

  try {
    if (!fs.existsSync(storageDirectory)) {
      fs.mkdirSync(storageDirectory, { recursive: true });
    }

    const tempFilePath = file.path;
    const fileExtension = path.extname(file.originalname).toLowerCase();
    const compressedFileName = `${path.basename(
      file.filename,
      fileExtension
    )}_compressed${fileExtension}`;
    const savedFilePath = path.join(storageDirectory, compressedFileName);

    await imageProcessingQueue.add("compression", {
      albumPin,
      tempFilePath,
      savedFilePath,
      originalFileName: file.originalname,
      fileExtension,
    });

    const imageUrl = `${process.env.BASE_URL}/media/${compressedFileName}`;

    res.json({
      message: "Image uploaded and queued for compression",
      imageUrl,
      albumPin,
    });
  } catch (error) {
    console.error("Error processing the image:", error);
    res.status(500).json({ error: "Error processing the image" });
  }
});

// Existing routes remain the same...
router.route("/:fileName").delete(async (req, res) => {
  const { fileName } = req.params;
  const imagePath = path.join(storageDirectory, fileName);

  try {
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
      await prisma.faceMetadata.deleteMany({
        where: { imagePath: fileName },
      });
      res.status(200).json({ message: "Image deleted successfully." });
    } else {
      res.status(404).json({ error: "Image not found" });
    }
  } catch (error) {
    console.error("Error deleting the image:", error);
    res.status(500).json({ error: "Error deleting the image" });
  }
});

router.route("/download/:fileName").get((req, res) => {
  const { fileName } = req.params;
  const imagePath = path.join(storageDirectory, fileName);

  res.download(imagePath, (err) => {
    if (err) {
      res.status(404).send("Image not found");
    }
  });
});

async function compressWithTargetSize(sharpInstance, format, outputPath) {
  let minQuality = 10;
  let maxQuality = 100;
  let currentQuality = 80;
  let attempts = 0;
  const maxAttempts = 5;

  while (attempts < maxAttempts) {
    const options = getCompressionOptions(currentQuality)[format];

    await sharpInstance[format](options).toFile(outputPath);

    const stats = fs.statSync(outputPath);
    const fileSize = stats.size;

    if (fileSize >= MIN_FILE_SIZE && fileSize <= MAX_FILE_SIZE) {
      break;
    } else if (fileSize > MAX_FILE_SIZE) {
      maxQuality = currentQuality;
      currentQuality = Math.floor((minQuality + currentQuality) / 2);
    } else {
      minQuality = currentQuality;
      currentQuality = Math.floor((currentQuality + maxQuality) / 2);
    }

    attempts++;

    if (attempts < maxAttempts) {
      fs.unlinkSync(outputPath);
    }
  }
}

imageProcessingQueue.process("compression", async (job) => {
  const { tempFilePath, savedFilePath, fileExtension } = job.data;

  try {
    const sharpImage = sharp(tempFilePath);

    let outputFormat = "jpeg";
    switch (fileExtension.toLowerCase()) {
      case ".jpg":
      case ".jpeg":
        outputFormat = "jpeg";
        break;
      case ".png":
        outputFormat = "png";
        break;
      case ".webp":
        outputFormat = "webp";
        break;
    }

    await compressWithTargetSize(sharpImage, outputFormat, savedFilePath);

    fs.unlinkSync(tempFilePath);

    const stats = fs.statSync(savedFilePath);
    const finalSize = stats.size / 1024;

    return {
      success: true,
      path: savedFilePath,
      size: Math.round(finalSize) + "KB",
    };
  } catch (error) {
    console.error("Error compressing image:", error);
    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    throw error;
  }
});

export default router;
