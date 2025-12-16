import express from 'express';
import { createKuis, getKuis, getKuisById } from '../controllers/controller_kuis.js';
import { authenticate } from '../middleware/auth.js';
import upload from '../services/multerUpload.js';
import { optionalAuth } from '../middleware/optionalAuth.js';
const router = express.Router();

router.post(
  '/create-kuis',
  authenticate,
  upload.single('gambar'),
  createKuis
);

router.get("/", getKuis);

router.get('/:id', optionalAuth, getKuisById);

export default router;