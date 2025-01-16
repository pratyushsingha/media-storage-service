import { Router } from "express";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { upload } from "../utils/multer.js";
import Queue from "bull";

const router = Router();
const mediaStoragePath = path.join(process.cwd(), "media");

const imageProcessingQueue = new Queue("image-processing", {
  redis: {
    host: "localhost",
    port: 6379,
  },
});

if (!fs.existsSync(mediaStoragePath)) {
  fs.mkdirSync(mediaStoragePath);
}

const MAX_FILE_SIZE = 600 * 1024;
const MIN_FILE_SIZE = 500 * 1024;
const MIN_QUALITY = 15;

async function compressImage(inputPath, outputPath) {
  let quality = 80;
  const qualityStep = 5;
  let lastSuccessfulFileSize = null;
  let bestOutputPath = null;

  while (quality >= MIN_QUALITY) {
    await sharp(inputPath).webp({ quality }).toFile(outputPath);
    const fileSize = fs.statSync(outputPath).size;

    if (fileSize >= MIN_FILE_SIZE && fileSize <= MAX_FILE_SIZE) {
      console.log(
        `Image compressed to ${fileSize} bytes with quality ${quality}`
      );
      return outputPath;
    }

    if (!lastSuccessfulFileSize || fileSize < lastSuccessfulFileSize) {
      lastSuccessfulFileSize = fileSize;
      bestOutputPath = outputPath;
    }

    quality -= qualityStep;
  }

  if (bestOutputPath) {
    console.log(
      `Unable to compress image within 500-600 KB. Best size: ${lastSuccessfulFileSize} bytes.`
    );
    return bestOutputPath;
  }

  throw new Error(`Failed to compress image.`);
}

imageProcessingQueue.process(async (job) => {
  const { inputPath, outputPath } = job.data;
  if (!fs.existsSync(inputPath)) {
    return { success: false, error: "Input file not found" };
  }
  try {
    const compressedPath = await compressImage(inputPath, outputPath);
    fs.unlinkSync(inputPath);
    return { success: true, path: compressedPath };
  } catch (error) {
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
    if (fs.existsSync(inputPath)) {
      fs.unlinkSync(inputPath);
    }
    throw error;
  }
});

imageProcessingQueue.on("completed", (job, result) => {
  console.log(`Job ${job.id} completed. File processed: ${result.path}`);
});

imageProcessingQueue.on("failed", (job, error) => {
  console.error(`Job ${job.id} failed:`, error);
});

router.post("/upload", upload.array("files", 2), async (req, res) => {
  const albumPin = req.body.albumPin;

  if (!albumPin) {
    return res.status(400).json({ error: "Album pin is required" });
  }

  try {
    const fileLinks = [];
    const errors = [];

    for (const file of req.files) {
      const timestamp = Date.now();
      const outputFileName = `${albumPin}_${timestamp}.webp`;
      const outputFilePath = path.join(mediaStoragePath, outputFileName);

      const fileUrl = `${req.protocol}://${req.get(
        "host"
      )}/media/${outputFileName}`;
      fileLinks.push(fileUrl);

      imageProcessingQueue.add(
        {
          inputPath: file.path,
          outputPath: outputFilePath,
        },
        {
          attempts: 3,
          removeOnComplete: true,
        }
      );
    }

    return res.status(200).json({
      message: "Files uploaded successfully",
      fileLinks,
    });
  } catch (error) {
    console.error("Error uploading files:", error);
    return res.status(500).json({ error: "Failed to upload files" });
  }
});

router.delete("/:fileName", async (req, res) => {
  const { fileName } = req.params;
  const imagePath = path.join(mediaStoragePath, fileName);

  try {
    if (fs.existsSync(imagePath)) {
      fs.unlinkSync(imagePath);
      res.status(200).json({ message: "Image deleted successfully." });
    } else {
      res.status(404).json({ error: "Image not found." });
    }
  } catch (error) {
    console.error("Error deleting image:", error);
    res.status(500).json({ error: "Error deleting image." });
  }
});

router.get("/download/:fileName", (req, res) => {
  const { fileName } = req.params;
  const imagePath = path.join(mediaStoragePath, fileName);

  if (fs.existsSync(imagePath)) {
    res.download(imagePath);
  } else {
    res.status(404).json({ error: "Image not found." });
  }
});

router.post("/logo-cover-image", upload.single("image"), async (req, res) => {
  const timestamp = Date.now();
  const outputFileName = `${timestamp}.webp`;
  const outputFilePath = path.join(mediaStoragePath, outputFileName);

  try {
    fs.unlinkSync(req.file.path);

    const fileUrl = `${req.protocol}://${req.get(
      "host"
    )}/media/${outputFileName}`;
    return res
      .status(200)
      .json({ message: "File uploaded successfully", fileUrl });
  } catch (error) {
    console.error("Error uploading file:", error);
    return res.status(500).json({ error: "Failed to upload file" });
  }
});

export default router;
