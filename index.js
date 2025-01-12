import dotenv from "dotenv";
import { app } from "./app.js";

dotenv.config({
  path: "./env",
});

const PORT_ = process.env.PORT;

app.listen(PORT_, () => {
  console.log(`Server running on port ${PORT_}`);
});
