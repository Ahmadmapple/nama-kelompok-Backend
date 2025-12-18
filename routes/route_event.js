import express from 'express';
import { createEvent, getEvent, registerEvent, getUserRegisteredEvents } from '../controllers/controller_event.js';
import { authenticate } from '../middleware/auth.js';
import upload from '../services/multerUpload.js';
const router = express.Router();

router.post(
  '/create-event',
  authenticate,
  upload.single('gambar'),
  createEvent
);

router.get("/", getEvent);

router.post('/:id_event/register', authenticate, registerEvent);

router.get('/my-events', authenticate, getUserRegisteredEvents);

export default router;