import dotenv from "dotenv";
import { app } from "./app.js";

dotenv.config({
  path: "./env",
});

app.listen(8082, () => {
  console.log("Server running on port 8082");
});
