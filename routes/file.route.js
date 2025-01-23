import { Router } from "express";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { upload } from "../utils/multer.js";
import Queue from "bull";
import { rekognitionClient } from "../utils/rekognition.js";
import { IndexFacesCommand } from "@aws-sdk/client-rekognition";
import axios from "axios";

const router = Router();
const mediaStoragePath = path.join(process.cwd(), "media");

const imageProcessingQueue = new Queue("image-processing", {
  redis: {
    host: process.env.REDIS_HOST || "localhost",
    port: process.env.REDIS_PORT || 6379,
  },
});

if (!fs.existsSync(mediaStoragePath)) {
  fs.mkdirSync(mediaStoragePath);
}

const MAX_FILE_SIZE = 600 * 1024;
const MIN_FILE_SIZE = 500 * 1024;
const MIN_QUALITY = 15;

async function resizeImageForRekognition(inputPath) {
  const imageBuffer = await sharp(inputPath)
    .resize(1024, 1024, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 80 })
    .toBuffer();

  if (imageBuffer.length > 15 * 1024 * 1024) {
    throw new Error("Image is still too large after resizing.");
  }

  return imageBuffer;
}

async function compressImage(inputPath, outputPath) {
  let quality = 80;
  const qualityStep = 5;
  let lastSuccessfulFileSize = null;
  let bestOutputPath = null;

  const tempOutputPath = `${outputPath}.tmp`;

  while (quality >= MIN_QUALITY) {
    await sharp(inputPath).jpeg({ quality }).toFile(tempOutputPath);
    const fileSize = fs.statSync(tempOutputPath).size;

    if (fileSize >= MIN_FILE_SIZE && fileSize <= MAX_FILE_SIZE) {
      fs.renameSync(tempOutputPath, outputPath);
      return outputPath;
    }

    if (!lastSuccessfulFileSize || fileSize < lastSuccessfulFileSize) {
      lastSuccessfulFileSize = fileSize;
      bestOutputPath = tempOutputPath;
    }

    quality -= qualityStep;
  }

  if (bestOutputPath) {
    fs.renameSync(bestOutputPath, outputPath);
    return outputPath;
  }

  throw new Error(`Failed to compress image.`);
}

imageProcessingQueue.process(async (job) => {
  const { inputPath, outputPath, albumPin, fileUrl, compressedFileUrl } =
    job.data;

  if (!fs.existsSync(inputPath)) {
    return { success: false, error: "Input file not found" };
  }

  try {
    const resizedImageBuffer = await resizeImageForRekognition(inputPath);

    const params = {
      Image: {
        Bytes: resizedImageBuffer,
      },
      CollectionId: "global-album-collection",
      ExternalImageId: albumPin,
      MaxFaces: 5,
      QualityFilter: "AUTO",
      DetectionAttributes: ["ALL"],
    };

    const command = new IndexFacesCommand(params);
    const response = await rekognitionClient.send(command);

    const compressedPath = await compressImage(inputPath, outputPath);

    fs.unlinkSync(inputPath);
    fs.renameSync(compressedPath, inputPath);

    const faceRecords = response.FaceRecords || [];
    for (const faceRecord of faceRecords) {
      try {
        await axios.post(
          `${process.env.MAIN_BACKEND_URL}/album/face-metadata`,
          {
            key: compressedFileUrl,
            faceId: faceRecord.Face.FaceId,
            imageId: faceRecord.Face.ImageId,
          }
        );
      } catch (error) {
        console.error(`Error saving face metadata: ${error.message}`);
      }
    }

    return { success: true, path: inputPath };
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
      const tempFileName = `temp_${albumPin}_${timestamp}.jpg`;
      const compressedFileName = `${albumPin}_${timestamp}.jpg`;

      const tempFilePath = path.join(mediaStoragePath, tempFileName);
      const compressedFilePath = path.join(
        mediaStoragePath,
        compressedFileName
      );

      const tempFileUrl = `https://media.shaadialbum.in/media/${tempFileName}`;
      const compressedFileUrl = `https://media.shaadialbum.in/media/temp_${compressedFileName}`;

      fs.renameSync(file.path, tempFilePath);

      imageProcessingQueue.add({
        inputPath: tempFilePath,
        outputPath: compressedFilePath,
        albumPin,
        fileUrl: tempFileUrl,
        compressedFileUrl,
      });

      fileLinks.push({
        tempUrl: tempFileUrl,
        compressedUrl: compressedFileUrl,
      });
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
    const fileExtension = path.extname(fileName).toLowerCase();
    let contentType = "application/octet-stream";
    switch (fileExtension) {
      case ".jpg":
      case ".jpeg":
        contentType = "image/jpeg";
        break;
      case ".png":
        contentType = "image/png";
        break;
      case ".gif":
        contentType = "image/gif";
        break;
      case ".pdf":
        contentType = "application/pdf";
        break;
      default:
        contentType = "application/octet-stream";
    }

    res.setHeader("Content-Type", contentType);

    res.download(imagePath, fileName, (err) => {
      if (err) {
        console.error("Error downloading file:", err);
        res.status(500).json({ error: "Failed to download file." });
      }
    });
  } else {
    res.status(404).json({ error: "Image not found." });
  }
});

router.get("/album-status/:albumPin", async (req, res) => {
  const { albumPin } = req.params;

  try {
    const jobs = await imageProcessingQueue.getJobs([
      "active",
      "completed",
      "failed",
      "waiting",
    ]);

    const albumJobs = jobs.filter((job) => job.data.albumPin === albumPin);

    const processedJobs = albumJobs.filter((job) => job.finishedOn);
    const failedJobs = albumJobs.filter((job) => job.failedReason);
    const remainingJobs = albumJobs.filter(
      (job) => !job.finishedOn && !job.failedReason
    );

    const processedImages = processedJobs.map((job) => ({
      id: job.id,
      inputPath: job.data.inputPath,
      outputPath: job.data.outputPath,
      fileUrl: job.data.fileUrl,
      compressedUrl: job.data.compressedUrl,
      status: "processed",
    }));

    const failedImages = failedJobs.map((job) => ({
      id: job.id,
      inputPath: job.data.inputPath,
      outputPath: job.data.outputPath,
      fileUrl: job.data.fileUrl,
      compressedUrl: job.data.compressedUrl,
      status: "failed",
      error: job.failedReason,
    }));

    const remainingImages = remainingJobs.map((job) => ({
      id: job.id,
      inputPath: job.data.inputPath,
      outputPath: job.data.outputPath,
      fileUrl: job.data.fileUrl,
      compressedUrl: job.data.compressedUrl,
      status: "remaining",
    }));

    const totalFiles = albumJobs.length;
    const processedFiles = processedJobs.length;
    const failedFiles = failedJobs.length;
    const remainingFiles = remainingJobs.length;

    let overallStatus;
    if (failedFiles === 0 && remainingFiles === 0) {
      overallStatus = "success";
    } else if (processedFiles > 0 && (failedFiles > 0 || remainingFiles > 0)) {
      overallStatus = "partial_success";
    } else if (failedFiles === totalFiles) {
      overallStatus = "failed";
    } else {
      overallStatus = "in_progress";
    }

    return res.status(200).json({
      success: true,
      data: {
        totalFiles,
        processedFiles,
        failedFiles,
        remainingFiles,
        overallStatus,
        processed: processedImages,
        failed: failedImages,
        remaining: remainingImages,
      },
    });
  } catch (error) {
    console.error("Error fetching album status:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch album status",
    });
  }
});

router.post("/cancel-jobs/:albumPin", async (req, res) => {
  const { albumPin } = req.params;

  try {
    await imageProcessingQueue.pause();

    const jobs = await imageProcessingQueue.getJobs([
      "active",
      "waiting",
      "delayed",
      "paused",
    ]);

    const albumJobs = jobs.filter((job) => job.data.albumPin === albumPin);

    for (const job of albumJobs) {
      await job.remove();
    }

    await imageProcessingQueue.resume();

    return res.status(200).json({
      success: true,
      message: `Cancelled all jobs for albumPin: ${albumPin}`,
      cancelledJobsCount: albumJobs.length,
    });
  } catch (error) {
    console.error("Error cancelling jobs:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to cancel jobs",
    });
  }
});

export default router;
