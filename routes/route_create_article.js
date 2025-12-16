import express from 'express';
import { createArticle } from '../controllers/controller_create_article.js';
import { authenticate } from '../middleware/auth.js';
import { getArticles, getArticleById, addLike, addView } from '../controllers/controller_article.js';
import upload from '../services/multerUpload.js';
import { optionalAuth } from '../middleware/optionalAuth.js';
const router = express.Router();

router.post(
  '/create-article',
  authenticate,
  upload.single('gambar'),
  createArticle
);

router.get("/", getArticles);

router.get('/:id', optionalAuth, getArticleById);

router.post('/:id/view', addView);

// Add like
router.post('/:id/like', authenticate, addLike);

export default router;