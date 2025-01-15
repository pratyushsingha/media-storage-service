import { Router } from "express";
import { __dirname } from "../utils/multer.js";
import path from "path";

const router = Router();

router.route("/:fileName").get((req, res) => {
  const { fileName } = req.params;
  const imagePath = path.join(__dirname, "..", "media", fileName);

  res.sendFile(imagePath, (err) => {
    if (err) {
      res.status(404).send("Image not found");
    }
  });
});

router.route("/").get((req, res) => {
  res.status(200).send("Media route");
});
export default router;
