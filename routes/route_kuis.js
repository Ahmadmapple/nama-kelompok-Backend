import express from 'express';
import { createKuis, getKuis, submitKuisResult, getUserCompletedQuizzes, getUserQuizHistory, updateKuisMetadata, deleteMyKuis } from '../controllers/controller_kuis.js';
import { authenticate } from '../middleware/auth.js';
import { optionalAuth } from '../middleware/optionalAuth.js';
import upload from '../services/multerUpload.js';
const router = express.Router();

router.post(
  '/create-kuis',
  authenticate,
  upload.single('gambar'),
  createKuis
);

router.get("/", getKuis);

// Submit kuis - optionalAuth agar guest juga bisa submit (tapi tidak disimpan)
router.post('/submit', optionalAuth, submitKuisResult);

router.get('/completed', authenticate, getUserCompletedQuizzes);

router.get('/history', authenticate, getUserQuizHistory);

router.put('/:id', authenticate, updateKuisMetadata);

router.delete('/:id', authenticate, deleteMyKuis);

export default router;