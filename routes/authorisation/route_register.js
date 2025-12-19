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
  
  console.log('Send OTP - Request for:', email);
  
  try {
    const otpToken = await sendOTPService(email);
    console.log('Send OTP - Success, token generated');
    res.status(200).json({ 
      message: "OTP berhasil dikirim ke email Anda", 
      verificationToken: otpToken 
    });
  } catch (error) {
    const errorMessage = error?.message || "";
    console.error("OTP gagal kirim:", errorMessage);

    if (errorMessage.includes("Resend API failed: 403")) {
      return res.status(503).json({
        error:
          "Layanan email belum aktif untuk kirim ke penerima lain. Jika pakai Resend, verifikasi domain di Resend dan set EMAIL_FROM menggunakan domain tersebut.",
      });
    }

    return res.status(500).json({ error: "Gagal mengirim OTP" });
  }
});

router.post("/verify-otp", async (req, res) => {
  const { email, otp, token } = req.body;

  console.log('Verify OTP - Request:', { 
    email, 
    otp, 
    tokenReceived: !!token,
    tokenLength: token?.length 
  });

  try {
    const isVerified = await verifiedOTPService(email, otp, token);

    // mark user as verified in DB
    await sql`UPDATE pengguna SET is_verified = true WHERE email_pengguna = ${email}`;

    console.log('Verify OTP - Success for:', email);
    res.status(200).json({ message: "OTP Verified Successfully", isVerified });
  } catch (error) {
    console.error("OTP verification failed:", error.message);
    res.status(400).json({ error: error.message });
  }
});

router.post("/forgot-password", forgotPasswordController);

router.post("/reset-password", resetPassword);

export default router;
