import express from 'express';
import { createKuis, getKuis } from '../controllers/controller_kuis.js';
import { authenticate } from '../middleware/auth.js';
import upload from '../services/multerUpload.js';
const router = express.Router();

router.post(
  '/create-kuis',
  authenticate,
  upload.single('gambar'),
  createKuis
);

router.get("/", getKuis);

export default router;