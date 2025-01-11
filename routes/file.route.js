import { Router } from "express";
import fs from "fs";
import { upload } from "../utils/multer.js";
import { IndexFacesCommand } from "@aws-sdk/client-rekognition";
import { rekognitionClient } from "../utils/rekognition.js";
import path from "path";
import { saveFaceMetadata } from "../utils/helper.js";

const router = Router();

const storageDirectory = path.join(process.cwd(), "media_storage");

router.route("/upload").post(upload.single("image"), async (req, res) => {
  const albumPin = req.body.albumPin;
  const imagePath = req.file.path;

  try {
    const permanentPath = path.join(storageDirectory, req.file.filename);
    if (!fs.existsSync(storageDirectory)) {
      fs.mkdirSync(storageDirectory, { recursive: true });
    }
    fs.renameSync(imagePath, permanentPath);

    const params = {
      Image: {
        Bytes: fs.readFileSync(permanentPath),
      },
      CollectionId: "global-album-collection",
      ExternalImageId: albumPin,
      MaxFaces: 5,
      QualityFilter: "AUTO",
      DetectionAttributes: ["ALL"],
    };

    const command = new IndexFacesCommand(params);
    const response = await rekognitionClient.send(command);

    console.log(response);

    response.FaceRecords.forEach((faceRecord) => {
      const faceId = faceRecord.Face.FaceId;
      saveFaceMetadata(faceId, albumPin, permanentPath);
    });

    res.json({ message: "Image uploaded and indexed", response });
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
export default router;
