import express from "express";
import {
  registerUser,
  loginUser,
  forgotPasswordController,
  resetPassword,
} from "../../controllers/authorisation/controller_register.js";
const router = express.Router();

router.post("/register", registerUser); //create new user

router.post("/login", loginUser); //login user

router.post("/forgot-password", forgotPasswordController);

router.post("/reset-password", resetPassword);

export default router;
