import nodemailer from "nodemailer";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import sql from "../config/db.js";

dotenv.config();

// 1. Setup Nodemailer Transporter (Specifically for Gmail)
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false, // Must be false for port 587
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD, // 16-character App Password
  },
  tls: {
    rejectUnauthorized: false // Helps bypass potential certificate issues in containers
  }
});

// 2. Simplified sendEmail function
const sendEmail = async ({ to, subject, html }) => {
  try {
    // We use 'await' to ensure Vercel doesn't kill the process before sending
    await transporter.sendMail({
      from: `"No Reply" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html,
    });
    console.log(`Email sent successfully to ${to}`);
    return true;
  } catch (error) {
    console.error("Email send failed:", error);
    throw new Error(`Failed to send email: ${error.message}`);
  }
};

// 3. Optional: Verify connection on startup (skip in production to save boot time)
if (process.env.NODE_ENV !== "production") {
  transporter.verify((error) => {
    if (error) {
      console.error("Transporter verification failed:", error);
    } else {
      console.log("Transporter verification successful");
    }
  });
}

// ... The rest of your logic (OTP Service, Verification, Reset Link) remains exactly the same ...

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
      <p>Kode OTP Anda:</p>
      <h2>${otp}</h2>
      <p>Berlaku selama <b>10 menit</b>.</p>
    `,
  });

  return token;
};

export const verifiedOTPService = async (email, otp, token) => {
  if (!token) {
    throw new Error("Token OTP tidak ditemukan");
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.OTP_SECRET);
  } catch (err) {
    throw new Error("Token OTP kedaluwarsa atau tidak valid");
  }

  const normalizedEmail = email.toLowerCase().trim();
  const decodedEmail = decoded.email.toLowerCase().trim();

  if (decodedEmail !== normalizedEmail) {
    throw new Error("Email tidak cocok");
  }

  const inputOTP = otp.toString().trim();
  const decodedOTP = decoded.otp.toString().trim();

  if (decodedOTP !== inputOTP) {
    throw new Error("Kode OTP salah");
  }

  return true;
};

export const sendResetLink = async (email) => {
  const user = await sql`
      SELECT id_pengguna 
      FROM pengguna 
      WHERE email_pengguna = ${email} 
      LIMIT 1
    `;

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
      <a href="${resetLink}">${resetLink}</a>
    `,
  });
};
