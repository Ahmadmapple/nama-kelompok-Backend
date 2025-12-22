import sql from "../../config/db.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();

const registerUser = async (req, res) => {
  const {
    email,
    name,
    role,
    password,
    confirmPassword,
    agreeToTerms,
    newsletter,
  } = req.body;

  const newsletterOptIn = newsletter === true;

  if (!email || !name || !role || !password || !confirmPassword) {
    return res.status(400).json({
      message: "Semua field harus diisi",
    });
  }

  if (password.length < 8) {
    return res.status(400).json({
      message: "Password minimal 8 digit",
    });
  }

  if (!/(?=.*[a-z])/.test(password)) {
    return res.status(400).json({
      message: "Password harus mengandung minimal 1 huruf kecil",
    });
  }

  if (!/(?=.*[A-Z])/.test(password)) {
    return res.status(400).json({
      message: "Password harus mengandung minimal 1 huruf besar",
    });
  }

  if (!/(?=.*\d)/.test(password)) {
    return res.status(400).json({
      message: "Password harus mengandung minimal 1 angka",
    });
  }

  if (agreeToTerms !== true) {
    return res.status(400).json({
      message: "Anda harus setuju dengan syarat dan ketentuan",
    });
  }

  if (password !== confirmPassword) {
    return res.status(400).json({
      message: "Password dan Confirm Password tidak sesuai",
    });
  }

  const normalizedEmail = email.toLowerCase().trim();

  try {
    const existedUser = await sql`
      SELECT email_pengguna
      FROM pengguna
      WHERE email_pengguna = ${normalizedEmail}
      LIMIT 1
    `;

    if (existedUser.length > 0) {
      return res.status(400).json({
        message: "Email sudah terdaftar, silakan login",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await sql`
      INSERT INTO pengguna (
        nama_pengguna,
        email_pengguna,
        password_hash_pengguna,
        status_pengguna,
        setuju_newsletter,
        is_verified
      )
      VALUES (
        ${name},
        ${normalizedEmail},
        ${hashedPassword},
        ${role},
        ${newsletterOptIn},
        ${true}
      )
    `;

    return res.status(201).json({
      message: "User berhasil didaftarkan. Silakan login.",
    });
  } catch (error) {
    console.error("Error during user registration:", error);
    return res.status(500).json({
      message: "Terjadi kesalahan pada server",
    });
  }
};

const loginUser = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "Email dan password harus diisi" });
  }

  const normalizedEmail = email.toLowerCase().trim();

  try {
    const user = await sql`
      SELECT id_pengguna, nama_pengguna, email_pengguna, password_hash_pengguna, role_pengguna, status_pengguna, is_verified
      FROM pengguna
      WHERE email_pengguna = ${normalizedEmail}
      LIMIT 1
    `;
    if (user.length === 0) {
      return res.status(400).json({ message: "Email atau password salah" });
    }
    const isPasswordValid = await bcrypt.compare(
      password,
      user[0].password_hash_pengguna
    );
    if (!isPasswordValid) {
      return res.status(400).json({ message: "Email atau password salah" });
    }

    const payload = {
      id: user[0].id_pengguna,
      email: user[0].email_pengguna,
      name: user[0].nama_pengguna,
      role: user[0].role_pengguna,
    };

    const JWTtoken = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    return res.status(200).json({
      message: "Login berhasil",
      user: {
        id: user[0].id_pengguna,
        name: user[0].nama_pengguna,
        email: user[0].email_pengguna,
        role: user[0].role_pengguna,
        status: user[0].status_pengguna,
        is_verified: user[0].is_verified,
      },
      token: JWTtoken,
    });
  } catch (error) {
    console.error("Error during user login:", error);
    return res.status(500).json({ message: "Terjadi kesalahan pada server" });
  }
};

const forgotPasswordController = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await sql`
      SELECT id_pengguna
      FROM pengguna
      WHERE email_pengguna = ${normalizedEmail}
      LIMIT 1
    `;

    if (!user.length) {
      return res.status(404).json({ message: "Email tidak terdaftar" });
    }

    return res.status(200).json({
      message: "Email valid. Silakan lanjut reset password.",
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Internal server error" });
  }
};

const resetPassword = async (req, res) => {
  const { email, newPassword, confirmPassword } = req.body;

  if (!email) {
    return res.status(400).json({
      message: "Email harus diisi",
    });
  }

  if (!newPassword || !confirmPassword) {
    return res.status(400).json({
      message: "Isi Semua Field",
    });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({
      message: "Minimal Panjang password 8",
    });
  }

  if (!/(?=.*[a-z])/.test(newPassword)) {
    return res.status(400).json({
      message: "Password harus mengandung minimal 1 huruf kecil",
    });
  }

  if (!/(?=.*[A-Z])/.test(newPassword)) {
    return res.status(400).json({
      message: "Password harus mengandung minimal 1 huruf besar",
    });
  }

  if (!/(?=.*\d)/.test(newPassword)) {
    return res.status(400).json({
      message: "Password harus mengandung minimal 1 angka",
    });
  }

  if (newPassword !== confirmPassword) {
    return res.status(400).json({
      message: "Konfirmasi Password tidak cocok",
    });
  }

  try {
    const normalizedEmail = email.toLowerCase().trim();
    const user = await sql`
      SELECT id_pengguna
      FROM pengguna
      WHERE email_pengguna = ${normalizedEmail}
      LIMIT 1
    `;

    if (!user.length) {
      return res.status(404).json({ message: "Email tidak terdaftar" });
    }

    const userId = user[0].id_pengguna;
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await sql`Update pengguna set password_hash_pengguna = ${hashedPassword} where id_pengguna = ${userId}`;

    return res.status(200).json({
      message: "Password berhasil direset. silahkan login",
    });
  } catch (error) {
    console.error("Reset password error:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

export { registerUser, loginUser, forgotPasswordController, resetPassword };
