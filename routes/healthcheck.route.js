import { Router } from "express";

const router = Router();

router.route("/").get((_, res) => {
  return res.status(200).json({ message: "Media server is healthy" });
});

export default router;
