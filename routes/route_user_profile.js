import express from "express";
import {
  editProfile,
  getBasicProfile,
  getExtendedProfile,
} from "../controllers/controller_user_profile.js";
import upload from "../services/multerUpload.js";
import { authenticate } from "../middleware/auth.js";
import multer from "multer";

const router = express.Router();

// Edit profile (with avatar upload)
router.put(
  "/edit-profile",
  authenticate,
  upload.single("avatar"),
  (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ message: "file harus berukuran < 2mb" });
      }
      return res.status(400).json({ message: err.message });
    }

    if (err) {
      return res.status(400).json({ message: err.message });
    }

    return next();
  },
  editProfile
);

// Get basic profile (fast)
router.get("/profile/basic", authenticate, getBasicProfile);

// Get extended profile (lazy-loaded)
router.get("/profile/extended", authenticate, getExtendedProfile);

export default router;
