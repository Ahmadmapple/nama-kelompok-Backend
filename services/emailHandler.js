import nodemailer from "nodemailer";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import sql from "../config/db.js";
import https from "https";

dotenv.config();

/**
 * =========================================================
 * CONFIG
 * =========================================================
 */
const USE_RESEND = Boolean(process.env.RESEND_API_KEY);

/**
 * =========================================================
 * SMTP TRANSPORTER (HANYA AKTIF JIKA TIDAK PAKAI RESEND)
 * =========================================================
 */
let transporter = null;

if (!USE_RESEND) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: 587,            // SAFE PORT
    secure: false,        // WAJIB false untuk 587
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD, // APP PASSWORD
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}

/**
 * =========================================================
 * SEND EMAIL (RESEND / SMTP)
 * =========================================================
 */
const sendEmail = async ({ to, subject, html }) => {
  /**
   * ======================
   * RESEND (RAILWAY SAFE)
   * ======================
   */
  if (USE_RESEND) {
    const payload = JSON.stringify({
      from: process.env.EMAIL_FROM || "No Reply <onboarding@resend.dev>",
      to: [to],
      subject,
      html,
    });

    return await new Promise((resolve, reject) => {
      const req = https.request(
        {
          method: "POST",
          hostname: "api.resend.com",
          path: "/emails",
          headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
          },
          timeout: 10000,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(true);
            } else {
              reject(
                new Error(
                  `Resend error: ${res.statusCode} ${res.statusMessage} ${data}`
                )
              );
            }
          });
        }
      );

      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy(new Error("Resend request timeout"));
      });

      req.write(payload);
      req.end();
    });
  }

  /**
   * ======================
   * SMTP (LOCAL / VPS)
   * ======================
   */
  if (!transporter) {
    throw new Error("SMTP transporter not initialized");
  }

  await transporter.sendMail({
    from: `"No Reply" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html,
  });

  return true;
};

/**
 * =========================================================
 * SEND OTP
 * =========================================================
 */
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

/**
 * =========================================================
 * VERIFY OTP
 * =========================================================
 */
export const verifiedOTPService = async (email, otp, token) => {
  if (!token) throw new Error("Token OTP tidak ditemukan");

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.OTP_SECRET);
  } catch {
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

/**
 * =========================================================
 * SEND RESET PASSWORD LINK
 * =========================================================
 */
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
