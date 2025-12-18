import express from 'express';
import { 
  createWeeklyTarget,
  getAllWeeklyTargets,
  deleteWeeklyTarget,
  getCurrentWeekTarget,
  updateProgress,
  getMyProgressHistory
} from '../controllers/controller_weekly_target.js';
import { authenticateToken, isAdmin } from '../middleware/auth.js';

const router = express.Router();

// Admin: Create weekly target (once per week)
router.post('/admin/create', authenticateToken, isAdmin, createWeeklyTarget);

// Admin: Get all weekly targets
router.get('/admin/all', authenticateToken, isAdmin, getAllWeeklyTargets);

// Admin: Delete weekly target by start date
router.delete('/admin/:startDate', authenticateToken, isAdmin, deleteWeeklyTarget);

// User: Get current week target
router.get('/current', authenticateToken, getCurrentWeekTarget);

// User: Mark quiz as completed
router.post('/progress/quiz', authenticateToken, async (req, res) => {
  req.body.type = 'quiz';
  return updateProgress(req, res);
});

// User: Mark article as read
router.post('/progress/article', authenticateToken, async (req, res) => {
  req.body.type = 'article';
  return updateProgress(req, res);
});

// User: Update reading hours
router.post('/progress/hours', authenticateToken, async (req, res) => {
  req.body.type = 'hours';
  return updateProgress(req, res);
});

// User: Get my weekly progress history
router.get('/my-progress', authenticateToken, getMyProgressHistory);

export default router;
