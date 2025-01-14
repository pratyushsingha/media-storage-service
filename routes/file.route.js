import { Router } from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import sharp from "sharp";
import { upload } from "../utils/multer.js";

const router = Router();

const mediaStoragePath = path.join(process.cwd(), "media");

if (!fs.existsSync(mediaStoragePath)) {
  fs.mkdirSync(mediaStoragePath);
}

const MAX_FILE_SIZE = 600 * 1024; // 500 KB
const MIN_QUALITY = 10; 

// Compress image function
async function compressImage(inputPath, outputPath) {
  let quality = 20;

  while (quality >= MIN_QUALITY) {
    try {
      await sharp(inputPath).jpeg({ quality }).toFile(outputPath);

      const fileSize = fs.statSync(outputPath).size;

      if (fileSize <= MAX_FILE_SIZE) {
        console.log(
          `Image compressed to ${fileSize} bytes with quality ${quality}`
        );
        return outputPath; 
      }

      quality -= 10;
    } catch (error) {
      console.error("Error during compression:", error);
      throw new Error("Image compression failed");
    }
  }

  throw new Error(
    "Unable to compress image under 500 KB with minimum quality."
  );
}

router.post("/upload", upload.array("files", 2), async (req, res) => {
  const albumPin = req.body.albumPin;

  if (!albumPin) {
    throw new Error("Album pin is required");
  }
  try {
    const fileLinks = [];

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
        console.error("Error compressing image:", err);
        if (fs.existsSync(outputFilePath)) {
          fs.unlinkSync(outputFilePath);
        }
        fs.unlinkSync(file.path);
        return res.status(500).json({ error: "Failed to compress image" });
      }
    }

    return res
      .status(200)
      .json({ message: "Files uploaded successfully", fileLinks });
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
