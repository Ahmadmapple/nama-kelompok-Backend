import express from "express";
import { getPublicStats } from "../controllers/controller_public.js";

const router = express.Router();

router.get("/stats", getPublicStats);

export default router;
