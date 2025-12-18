import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import sql from "../config/db.js";

dotenv.config();

/**
 * FIXED: This function now uses Brevo's HTTP API instead of SMTP.
 * This bypasses Railway's port blocks.
 */
const sendEmail = async ({ to, subject, html }) => {
  const BREVO_API_KEY = process.env.BREVO_API_KEY;
  const SENDER_EMAIL = process.env.EMAIL_USER;

  if (!BREVO_API_KEY) {
    throw new Error("BREVO_API_KEY is missing in environment variables.");
  }

  const payload = {
    sender: { email: SENDER_EMAIL, name: "My App" },
    to: [{ email: to }],
    subject: subject,
    htmlContent: html,
  };

  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "accept": "application/json",
        "api-key": BREVO_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error("Brevo API error details:", result);
      throw new Error(result.message || "Failed to send email via Brevo API");
    }

    console.log(`Email sent successfully to ${to}. Message ID: ${result.messageId}`);
    return true;
  } catch (error) {
    console.error("Critical Email Failure:", error.message);
    throw new Error(`Email Service Error: ${error.message}`);
  }
};

// --- OTP & Logic Functions ---

export const sendOTPService = async (email) => {
  const user = await sql`SELECT id_pengguna FROM pengguna WHERE email_pengguna = ${email} LIMIT 1`;
  if (!user.length) throw new Error("User not found");

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const token = jwt.sign(
    { email, otp },
    process.env.OTP_SECRET,
    { expiresIn: "10m" }
  );

  await sendEmail({
    to: email,
    subject: "Kode Verifikasi Anda",
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h3>Kode OTP Anda:</h3>
        <h1 style="color: #4A90E2; letter-spacing: 5px;">${otp}</h1>
        <p>Kode ini berlaku selama <b>10 menit</b>.</p>
        <p>Jika Anda tidak merasa meminta kode ini, abaikan email ini.</p>
      </div>
    `,
  });

  return token;
};

export const verifiedOTPService = async (email, otp, token) => {
  if (!token) throw new Error("Token OTP tidak ditemukan");

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.OTP_SECRET);
  } catch (err) {
    throw new Error("Token OTP kedaluwarsa atau tidak valid");
  }

  if (decoded.email.toLowerCase().trim() !== email.toLowerCase().trim()) {
    throw new Error("Email tidak cocok");
  }

  if (decoded.otp.toString().trim() !== otp.toString().trim()) {
    throw new Error("Kode OTP salah");
  }

  return true;
};

export const sendResetLink = async (email) => {
  const user = await sql`SELECT id_pengguna FROM pengguna WHERE email_pengguna = ${email} LIMIT 1`;
  if (!user.length) throw new Error("User not found");

  const token = jwt.sign(
    { id: user[0].id_pengguna, purpose: "reset-password" },
    process.env.JWT_SECRET,
    { expiresIn: "10m" }
  );

  const resetLink = `${process.env.FRONTEND_URL}/reset-password/${token}`;

  await sendEmail({
    to: email,
    subject: "Reset Password",
    html: `
      <p>Klik link berikut untuk reset password.</p>
      <p>Link berlaku selama <b>10 menit</b>.</p>
      <a href="${resetLink}" style="padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">Reset Password</a>
    `,
  });
};
