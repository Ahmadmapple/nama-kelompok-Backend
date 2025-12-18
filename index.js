import dotenv from "dotenv";
dotenv.config();
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import cors from "cors";
import authRouter from "./routes/authorisation/route_register.js";



const app = express();
app.use(cors());
app.use(express.json());
app.use(helmet());
app.use(morgan("dev"));

app.use("/api/auth", authRouter);

const port = process.env.PORT || 3000; 

app.listen(port, () => {
    console.log("Server Running on port " + port);
})

