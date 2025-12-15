import express from "express";
import {
  registerUser,
  loginUser,
  forgotPasswordController,
  resetPassword,
} from "../../controllers/authorisation/controller_register.js";
import {
  verifiedOTPService,
  sendOTPService,
} from "../../services/emailHandler.js";
import sql from "../../config/db.js";
const router = express.Router();

router.post("/register", registerUser); //create new user

router.post("/login", loginUser); //login user

router.post("/send-otp", async (req, res) => {
  const { email } = req.body;
  try {
    const otpToken = await sendOTPService(email);
    res.status(200).json({ message: "OTP Dikirim: ", token: otpToken });
  } catch (error) {
    console.error("OTP gagal kirim: ", error);
    res.status(500).json({ error: "OTP gagal kirim:" });
  }
});

router.post("/verify-otp", async (req, res) => {
  const { email, otp, token } = req.body;

  try {
    const isVerified = await verifiedOTPService(email, otp, token);

    // mark user as verified in DB
    await sql`UPDATE pengguna SET is_verified = true WHERE email_pengguna = ${email}`;

    res.status(200).json({ message: "OTP Verified Successfully", isVerified });
  } catch (error) {
    console.error("OTP verification failed:", error);
    res.status(400).json({ error: error.message }); // <-- send real error
  }
});

router.post("/forgot-password", forgotPasswordController);

router.post("/reset-password", resetPassword);

export default router;
