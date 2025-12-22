import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

// 1. Setup Nodemailer Transporter (Specifically for Gmail)
const transporter = nodemailer.createTransport({
  service: "gmail", // specific service setting helps avoid port issues
  auth: {
    user: process.env.EMAIL_USER, // Your Gmail address
    pass: process.env.EMAIL_PASSWORD, // Your 16-char App Password (NOT your login password)
  },
  connectionTimeout: Number(process.env.EMAIL_CONNECTION_TIMEOUT || 5000),
  greetingTimeout: Number(process.env.EMAIL_GREETING_TIMEOUT || 5000),
  socketTimeout: Number(process.env.EMAIL_SOCKET_TIMEOUT || 8000),
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
