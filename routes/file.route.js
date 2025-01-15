import { Router } from "express";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { upload } from "../utils/multer.js";

const router = Router();

const mediaStoragePath = path.join(process.cwd(), "media");

if (!fs.existsSync(mediaStoragePath)) {
  fs.mkdirSync(mediaStoragePath);
}

const MAX_FILE_SIZE = 600 * 1024; // 600 KB upper limit
const MIN_FILE_SIZE = 500 * 1024; // 500 KB lower limit
const MIN_QUALITY = 10; // Minimum quality for compression

async function compressImage(inputPath, outputPath) {
  let quality = 80;
  const qualityStep = 5; // Reduce quality in smaller steps for better precision
  let lastSuccessfulFileSize = null;
  let bestOutputPath = null;

  while (quality >= MIN_QUALITY) {
    // Generate compressed image
    await sharp(inputPath).jpeg({ quality }).toFile(outputPath);

    const fileSize = fs.statSync(outputPath).size;

    if (fileSize >= MIN_FILE_SIZE && fileSize <= MAX_FILE_SIZE) {
      console.log(`Image compressed to ${fileSize} bytes with quality ${quality}`);
      return outputPath; // Compression successful within range
    }

    // Track the closest file size and its quality if compression isn't perfect
    if (!lastSuccessfulFileSize || fileSize < lastSuccessfulFileSize) {
      lastSuccessfulFileSize = fileSize;
      bestOutputPath = outputPath;
    }

    quality -= qualityStep;
  }

  // If unable to meet size range, return the best achievable compression
  if (bestOutputPath) {
    console.log(
      `Unable to compress image within 500-600 KB. Best size: ${lastSuccessfulFileSize} bytes.`
    );
    return bestOutputPath;
  }

  throw new Error(`Failed to compress image.`);
}

router.post("/upload", upload.array("files", 2), async (req, res) => {
  const albumPin = req.body.albumPin;

  if (!albumPin) {
    return res.status(400).json({ error: "Album pin is required" });
  }

  try {
    const fileLinks = [];
    const errors = [];

    for (const file of req.files) {
      const outputFilePath = path.join(
        mediaStoragePath,
        `${albumPin}_${Date.now()}.jpg`
      );

      try {
        const compressedPath = await compressImage(file.path, outputFilePath);

        const fileUrl = `${req.protocol}://${req.get(
          "host"
        )}/media/${path.basename(compressedPath)}`;
        fileLinks.push(fileUrl);

        fs.unlinkSync(file.path);
      } catch (err) {
        console.error("Error processing file:", err);
        errors.push({
          fileName: file.originalname,
          error: err.message,
        });

        // Cleanup files
        if (fs.existsSync(outputFilePath)) {
          fs.unlinkSync(outputFilePath);
        }
        fs.unlinkSync(file.path);
      }
    }

    if (fileLinks.length > 0 && errors.length > 0) {
      return res.status(207).json({
        message: "Some files were processed successfully",
        fileLinks,
        errors,
      });
    }

    // If all files failed
    if (errors.length > 0 && fileLinks.length === 0) {
      return res.status(500).json({
        error: "Failed to process all files",
        details: errors,
      });
    }

    // All files processed successfully
    return res.status(200).json({
      message: "Files uploaded successfully",
      fileLinks,
    });
  } catch (error) {
    console.error("Error uploading files:", error);
    return res.status(500).json({ error: "Failed to upload files" });
  }
});

// Delete image API
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

// Download image API
router.get("/download/:fileName", (req, res) => {
  const { fileName } = req.params;
  const imagePath = path.join(mediaStoragePath, fileName);

  if (fs.existsSync(imagePath)) {
    res.download(imagePath);
  } else {
    res.status(404).send("Image not found.");
  }
});

export default router;