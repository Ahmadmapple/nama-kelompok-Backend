import express from 'express';
import { 
  getAdminStats,
  getAllUsers, 
  getAllArticles, 
  getAllQuizzes,
  getAllEvents,
  deleteUser,
  deleteArticle,
  deleteQuiz,
  deleteEvent
} from '../controllers/controller_admin.js';
import { authenticateToken, isAdmin } from '../middleware/auth.js';

const router = express.Router();

router.get('/stats', authenticateToken, isAdmin, getAdminStats);
router.get('/users', authenticateToken, isAdmin, getAllUsers);
router.get('/articles', authenticateToken, isAdmin, getAllArticles);
router.get('/quizzes', authenticateToken, isAdmin, getAllQuizzes);
router.get('/events', authenticateToken, isAdmin, getAllEvents);

router.delete('/users/:id', authenticateToken, isAdmin, deleteUser);
router.delete('/articles/:id', authenticateToken, isAdmin, deleteArticle);
router.delete('/quizzes/:id', authenticateToken, isAdmin, deleteQuiz);
router.delete('/events/:id', authenticateToken, isAdmin, deleteEvent);

export default router;
