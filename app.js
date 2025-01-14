import express from "express";
import fileRouter from "./routes/file.route.js";
import mediaRouter from "./routes/media.route.js";
import cors from "cors"


const app = express();

app.use(
  cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true,
  })
);


app.use((req, res, next) => {
  console.log(req.method, req.url);
  next();
});

app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));

app.use("/api/v1/file", fileRouter);
app.use("/media", mediaRouter);

export { app };
