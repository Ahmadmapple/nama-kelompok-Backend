import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import cors from "cors";
import dotenv from "dotenv";
import authRouter from "./routes/authorisation/route_register.js";
import userRouter from "./routes/route_user_profile.js";
import createRouter from "./routes/route_create_article.js";
import kuisRouter from "./routes/route_kuis.js";
import eventRouter from "./routes/route_event.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(helmet());
app.use(morgan("dev"));

app.use("/api/auth", authRouter);
app.use("/api/user", userRouter);
app.use("/api/article", createRouter);
app.use("/api/kuis", kuisRouter);
app.use("/api/event", eventRouter)

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log("Server Running on port " + port);
});
