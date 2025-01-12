import { Router } from "express";
import fs from "fs";
import { upload } from "../utils/multer.js";
import { IndexFacesCommand } from "@aws-sdk/client-rekognition";
import { rekognitionClient } from "../utils/rekognition.js";
import path from "path";
import { saveFaceMetadata } from "../utils/helper.js";
import sharp from "sharp";
import Queue from "bull";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

// Initialize Queue for background image processing
const imageProcessingQueue = new Queue("image-processing", {
  redis: { host: "localhost", port: 6379 },
});

// Directory to store uploaded files
const storageDirectory = path.join(process.cwd(), "media_storage");

// Compress image using sharp with progressive quality adjustment
const compressImage = async (inputPath, outputPath) => {
  let quality = 80;
  let compressed = await sharp(inputPath)
    .toFormat("jpeg")
    .jpeg({ quality })
    .toBuffer();

  let size = compressed.length / 1024; // Size in KB
  while (size > 500 && quality > 10) {
    quality -= 10;
    compressed = await sharp(inputPath)
      .toFormat("jpeg")
      .jpeg({ quality })
      .toBuffer();
    size = compressed.length / 1024;
  }

  fs.writeFileSync(outputPath, compressed);
  return outputPath;
};

router.route("/upload").post(upload.array("images"), async (req, res) => {
  const albumPin = req.body.albumPin;
  const files = req.files;

  if (!files || files.length === 0) {
    return res.status(400).json({ error: "No images uploaded." });
  }

  try {
    const savedFileNames = [];

    if (!fs.existsSync(storageDirectory)) {
      fs.mkdirSync(storageDirectory, { recursive: true });
    }

    files.forEach((file) => {
      savedFileNames.push(`compressed-${file.filename}`);
    });

    for (const file of files) {
      const temporaryPath = file.path;
      const compressedFilePath = path.join(
        storageDirectory,
        `compressed-${file.filename}`
      );

      await compressImage(temporaryPath, compressedFilePath);

      fs.unlinkSync(temporaryPath);

      imageProcessingQueue.add({
        albumPin,
        file: compressedFilePath,
        originalFileName: file.originalname,
      });
    }

    res.json({
      message: "Images uploaded and compressed successfully",
      data: savedFileNames,
      albumPin,
    });
  } catch (error) {
    console.error("Error processing the images:", error);
    res.status(500).json({ error: "Error processing the images" });
  }
});

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

imageProcessingQueue.process(async (job) => {
  const { albumPin, file, originalFileName } = job.data;

  const params = {
    Image: {
      Bytes: fs.readFileSync(file),
    },
    CollectionId: "global-album-collection",
    ExternalImageId: albumPin,
    MaxFaces: 5,
    QualityFilter: "AUTO",
    DetectionAttributes: ["ALL"],
  };

  const command = new IndexFacesCommand(params);
  const response = await rekognitionClient.send(command);

  console.log(`Indexed image: ${originalFileName}`, response);

  // Save metadata for each detected face in the image
  response.FaceRecords.forEach((faceRecord) => {
    const faceId = faceRecord.Face.FaceId;
    saveFaceMetadata(faceId, albumPin, file);
  });
});

export default router;
