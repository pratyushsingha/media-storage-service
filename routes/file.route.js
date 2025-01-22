import { Router } from "express";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { upload } from "../utils/multer.js";
import Queue from "bull";
import { rekognitionClient } from "../utils/rekognition.js";
import { IndexFacesCommand } from "@aws-sdk/client-rekognition";

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
  const { inputPath, outputPath, albumPin } = job.data;
  if (!fs.existsSync(inputPath)) {
    return { success: false, error: "Input file not found" };
  }
  try {
    const params = {
      Image: {
        Bytes: fs.readFileSync(inputPath),
      },
      CollectionId: "global-album-collection",
      ExternalImageId: albumPin,
      MaxFaces: 5,
      QualityFilter: "AUTO",
      DetectionAttributes: ["ALL"],
    };

    const command = new IndexFacesCommand(params);
    const response = await rekognitionClient.send(command);
    console.log(`Indexed image: ${inputPath}`, response);

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
          albumPin,
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
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const outputFileName = req.file.filename;
  const outputFilePath = path.join(mediaStoragePath, outputFileName);

  try {
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

router
  .route("/portfolio-images")
  .post(upload.array("images", 50), async (req, res) => {
    try {
      const fileLinks = [];
      const errors = [];

      for (const file of req.files) {
        const timestamp = Date.now();
        const outputFileName = `${timestamp}.webp`;
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

router.route("/album/:albumPin").get(async (req, res) => {
  const { albumPin } = req.params;
  const { page = 1, limit = 10 } = req.query;

  try {
    if (!fs.existsSync(mediaStoragePath)) {
      return res.status(404).json({ error: "Media folder not found" });
    }

    const files = fs.readdirSync(mediaStoragePath);
    const images = files
      .filter((file) => file.startsWith(albumPin))
      .map((file) => ({
        url: `${req.protocol}://${req.get("host")}/media/${file}`,
      }));

    if (images.length === 0) {
      return res
        .status(404)
        .json({ message: "No images found for this album" });
    }

    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    const paginatedImages = images.slice(startIndex, endIndex);

    const totalImages = images.length;
    const totalPages = Math.ceil(totalImages / limit);

    return res.json({
      status: 200,
      data: {
        images: paginatedImages,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalImages,
        },
      },
      message: "Images retrieved successfully",
    });
  } catch (error) {
    console.error("Error retrieving album images:", error);
    return res.status(500).json({
      error: "An error occurred while retrieving album images",
      details: error.message,
    });
  }
});

export default router;
