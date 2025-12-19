import nodemailer from "nodemailer";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import sql from "../config/db.js";
import https from "https";

dotenv.config();

// 1. Setup Nodemailer Transporter (Specifically for Gmail)
const transporter = nodemailer.createTransport({
  service: "gmail", // specific service setting helps avoid port issues
  auth: {
    user: process.env.EMAIL_USER, // Your Gmail address
    pass: process.env.EMAIL_PASSWORD, // Your 16-char App Password (NOT your login password)
  },
});

// 2. Simplified sendEmail function
const sendEmail = async ({ to, subject, html }) => {
  const gatewayUrl = process.env.EMAIL_GATEWAY_URL;
  const gatewayApiKey = process.env.EMAIL_GATEWAY_API_KEY;

  if (gatewayUrl) {
    const payload = JSON.stringify({ to, subject, html });
    const url = new URL(gatewayUrl);

    return await new Promise((resolve, reject) => {
      const req = https.request(
        {
          method: "POST",
          hostname: url.hostname,
          path: `${url.pathname}${url.search}`,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
            "x-api-key": gatewayApiKey || "",
          },
          timeout: Number(process.env.EMAIL_GATEWAY_TIMEOUT || 15000),
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              return resolve(true);
            }
            return reject(
              new Error(
                `Email gateway failed: ${res.statusCode} ${res.statusMessage} ${data}`
              )
            );
          });
        }
      );

      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy(new Error("Email gateway request timeout"));
      });

      req.write(payload);
      req.end();
    });
  }

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
