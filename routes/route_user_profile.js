import express from "express";
import {
  editProfile,
  getBasicProfile,
  getExtendedProfile,
} from "../controllers/controller_user_profile.js";
import upload from "../services/multerUpload.js";
import { authenticate } from "../middleware/auth.js";

const router = express.Router();

// Edit profile (with avatar upload)
router.put(
  "/edit-profile",
  authenticate,
  upload.single("avatar"),
  editProfile
);

// Get basic profile (fast)
router.get("/profile/basic", authenticate, getBasicProfile);

// Get extended profile (lazy-loaded)
router.get("/profile/extended", authenticate, getExtendedProfile);

export default router;
