import express from "express";
import fileRouter from "./routes/file.route.js";
import mediaRouter from "./routes/media.route.js";
import healthcheckRouter from "./routes/healthcheck.route.js";
import cors from "cors";

const app = express();

const allowedOrigins = process.env.CORS_ORIGIN?.split(",") || [];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      } else {
        return callback(new Error("Not allowed by CORS"));
      }
    },
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
app.use("/api/v1/healthcheck", healthcheckRouter);

export { app };
