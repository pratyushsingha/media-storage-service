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

const MAX_FILE_SIZE = 1024 * 1024;
const MIN_QUALITY = 40;
const MAX_RETRIES = 3;

async function compressImage(inputPath, outputPath, attempt = 1) {
  let quality = 80;
  const qualityStep = 10;

  while (quality >= MIN_QUALITY) {
    try {
      await sharp(inputPath).jpeg({ quality }).toFile(outputPath);

      const fileSize = fs.statSync(outputPath).size;

      if (fileSize <= MAX_FILE_SIZE) {
        console.log(
          `Image compressed to ${fileSize} bytes with quality ${quality} (attempt ${attempt})`
        );
        return outputPath;
      }

      quality -= qualityStep;
    } catch (error) {
      console.error(`Compression attempt ${attempt} failed:`, error);

      if (attempt < MAX_RETRIES) {
        console.log(`Retrying compression (attempt ${attempt + 1})`);
        return compressImage(inputPath, outputPath, attempt + 1);
      }

      throw new Error(`Image compression failed after ${MAX_RETRIES} attempts`);
    }
  }

  // If we can't compress to 1MB even with minimum quality, throw error
  throw new Error(
    `Unable to compress image under 1 MB with minimum quality of ${MIN_QUALITY}%`
  );
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
        await compressImage(file.path, outputFilePath);

        const fileUrl = `${req.protocol}://${req.get(
          "host"
        )}/media/${path.basename(outputFilePath)}`;
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
