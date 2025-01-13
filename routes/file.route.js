import { Router } from "express";
import fs from "fs";
import { upload } from "../utils/multer.js";
import { IndexFacesCommand } from "@aws-sdk/client-rekognition";
import { rekognitionClient } from "../utils/rekognition.js";
import path from "path";
import Queue from "bull";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const router = Router();

const imageProcessingQueue = new Queue("image-processing", {
  redis: { host: "localhost", port: 6379 },
});

const storageDirectory = path.join(process.cwd(), "media_storage");

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

    const savedFilePath = path.join(storageDirectory, file.filename);

    fs.renameSync(file.path, savedFilePath);

    imageProcessingQueue.add({
      albumPin,
      file: savedFilePath,
      originalFileName: file.originalname,
    });

    const imageUrl = `${process.env.BASE_URL}/media/${file.filename}`; 

    res.json({
      message: "Image uploaded and queued successfully",
      imageUrl,
      albumPin,
    });
  } catch (error) {
    console.error("Error processing the image:", error);
    res.status(500).json({ error: "Error processing the image" });
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
  // response.FaceRecords.forEach((faceRecord) => {
  //   const faceId = faceRecord.Face.FaceId;
  //   saveFaceMetadata(faceId, albumPin, file);
  // });
});

export default router;
