import nodemailer from "nodemailer";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import sql from "../config/db.js";

dotenv.config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT || 465),
  secure: String(process.env.SMTP_SECURE || "true") === "true",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
  connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT || 15000),
  greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT || 15000),
  socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT || 20000),
});

if (process.env.NODE_ENV !== "production") {
  transporter.verify((error) => {
    if (error) {
      console.error("Transporter verification failed:", error);
    } else {
      console.log("Transporter verification successful");
    }
  });
}

export const sendOTPService = async (email) => {
  const user =
    await sql`SELECT id_pengguna FROM pengguna WHERE email_pengguna = ${email} LIMIT 1`;

  if (!user.length) throw new Error("User not found");

  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  const token = jwt.sign(
    { email, otp },
    process.env.OTP_SECRET,
    { expiresIn: "10m" }
  );

  await transporter.sendMail({
    from: `"No Reply" <${process.env.EMAIL_USER}>`,
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

  // Normalize email untuk perbandingan
  const normalizedEmail = email.toLowerCase().trim();
  const decodedEmail = decoded.email.toLowerCase().trim();

  if (decodedEmail !== normalizedEmail) {
    throw new Error("Email tidak cocok");
  }

  // Normalize OTP untuk perbandingan (hapus whitespace dan convert ke string)
  const inputOTP = otp.toString().trim();
  const decodedOTP = decoded.otp.toString().trim();

  console.log('OTP Verification Debug:', {
    inputOTP,
    decodedOTP,
    match: inputOTP === decodedOTP
  });

  if (decodedOTP !== inputOTP) {
    throw new Error("Kode OTP salah");
  }

  return true;
};


export const sendResetLink = async (email) => {
  const user =
    await sql`
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

  await transporter.sendMail({
    from: `"No Reply" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Reset Password",
    html: `
      <p>Klik link berikut untuk reset password.</p>
      <p>Link berlaku selama <b>10 menit</b>.</p>
      <a href="${resetLink}">${resetLink}</a>
    `,
  });
};
